import * as tf from '@tensorflow/tfjs';

export const MODEL_SLOTS = ['slot-1', 'slot-2'];

export function preferenceKeyForTrack(track) {
  return `track:${track.id}`;
}

export function buildDataset(tracks, preferences) {
  const examples = [];
  const unlabeled = [];
  for (const track of tracks) {
    const value = preferences[preferenceKeyForTrack(track)];
    const example = {
      track,
      key: preferenceKeyForTrack(track),
      label: value === 'up' ? 1 : value === 'down' ? 0 : null,
      embedding: track.embedding,
    };
    if (example.label === null) unlabeled.push(example);
    else examples.push(example);
  }
  return {examples, unlabeled};
}

export function buildGenreDataset(tracks, campaignSamples, labels) {
  const tracksById = new Map(tracks.map((track) => [Number(track.id), track]));
  const labelIndex = new Map(labels.map((label, index) => [Number(label.id), index]));
  const byTrack = new Map();
  for (const sample of campaignSamples) {
    const track = tracksById.get(Number(sample.track_id));
    if (!track) continue;
    const vector = byTrack.get(Number(sample.track_id)) || new Array(labels.length).fill(0);
    for (const assignment of sample.assignments || []) {
      const index = labelIndex.get(Number(assignment.label_id));
      if (index !== undefined) vector[index] = 1;
    }
    if ((sample.assignments || []).some((assignment) => labelIndex.has(Number(assignment.label_id)))) {
      byTrack.set(Number(sample.track_id), vector);
    }
  }
  const examples = [...byTrack.entries()].map(([trackId, labelVector]) => {
    const track = tracksById.get(trackId);
    return {track, key: `track:${trackId}`, labels: labelVector, embedding: track.embedding};
  });
  const labeledIds = new Set(examples.map((example) => Number(example.track.id)));
  const unlabeled = tracks
    .filter((track) => !labeledIds.has(Number(track.id)))
    .map((track) => ({track, key: `track:${track.id}`, embedding: track.embedding}));
  return {examples, unlabeled};
}

export function datasetSummary(examples, unlabeled) {
  const likes = examples.filter((example) => example.label === 1).length;
  const dislikes = examples.filter((example) => example.label === 0).length;
  return {total: examples.length, likes, dislikes, unlabeled: unlabeled.length};
}

export function canTrain(summary) {
  return summary.likes > 0 && summary.dislikes > 0;
}

export async function trainPreferenceModel(examples, options, onEpoch) {
  if (!examples.length) throw new Error('No labeled examples available.');
  const seed = seedToInt(options.randomSeed ?? 1337);
  const split = createTrainValidationSplit(examples, options.validationFraction ?? 0.2, seed);
  const dimension = split.train[0].embedding.length;
  const trainRows = split.train.map((example) => preprocessEmbedding(example.embedding));
  const trainLabels = split.train.map((example) => [example.label]);
  const normalizer = normalizerFromRows(trainRows);

  const xs = tf.tensor2d(trainRows.map((row) => normalizeRow(row, normalizer)), [split.train.length, dimension]);
  const ys = tf.tensor2d(trainLabels, [split.train.length, 1]);
  const validation = tensorsForExamples(split.validation, normalizer, dimension);
  const model = createModel(dimension, options.hiddenUnits, options.dropoutRate, options.learningRate, seed);
  try {
    const history = await model.fit(xs, ys, {
      epochs: options.epochs,
      batchSize: Math.min(options.batchSize, split.train.length),
      shuffle: false,
      ...(validation ? {validationData: [validation.xs, validation.ys]} : {}),
      callbacks: {
        onEpochEnd: async (epoch, logs) => {
          onEpoch?.({epoch: epoch + 1, logs: cleanLogs(logs)});
          await tf.nextFrame();
        },
      },
    });
    const lossHistory = lossHistoryFromTfHistory(history.history);
    const evaluation = {
      train: await evaluateModel(model, normalizer, split.train),
      validation: await evaluateModel(model, normalizer, split.validation),
    };
    return {model, normalizer, history: history.history, lossHistory, dimension, split, evaluation, seed};
  } finally {
    xs.dispose();
    ys.dispose();
    validation?.xs.dispose();
    validation?.ys.dispose();
  }
}

export async function trainGenreModel(examples, labels, options, onEpoch) {
  if (!examples.length) throw new Error('No genre-labeled tracks available.');
  const seed = seedToInt(options.randomSeed ?? 1337);
  const split = createGenericTrainValidationSplit(examples, options.validationFraction ?? 0.2, seed);
  const dimension = split.train[0].embedding.length;
  const trainRows = split.train.map((example) => preprocessEmbedding(example.embedding));
  const normalizer = normalizerFromRows(trainRows);
  const xs = tf.tensor2d(trainRows.map((row) => normalizeRow(row, normalizer)), [split.train.length, dimension]);
  const ys = tf.tensor2d(split.train.map((example) => example.labels), [split.train.length, labels.length]);
  const validation = multiLabelTensorsForExamples(split.validation, normalizer, dimension, labels.length);
  const model = createModel(dimension, options.hiddenUnits, options.dropoutRate, options.learningRate, seed, labels.length);
  try {
    const history = await model.fit(xs, ys, {
      epochs: options.epochs,
      batchSize: Math.min(options.batchSize, split.train.length),
      shuffle: false,
      ...(validation ? {validationData: [validation.xs, validation.ys]} : {}),
      callbacks: {
        onEpochEnd: async (epoch, logs) => {
          onEpoch?.({epoch: epoch + 1, logs: cleanLogs(logs)});
          await tf.nextFrame();
        },
      },
    });
    const lossHistory = lossHistoryFromTfHistory(history.history);
    const evaluation = {
      train: await evaluateGenreModel(model, normalizer, split.train, labels),
      validation: await evaluateGenreModel(model, normalizer, split.validation, labels),
    };
    return {model, normalizer, history: history.history, lossHistory, dimension, split, evaluation, seed, labels};
  } finally {
    xs.dispose();
    ys.dispose();
    validation?.xs.dispose();
    validation?.ys.dispose();
  }
}

function createModel(dimension, hiddenUnits, dropoutRate, learningRate, seed, outputUnits = 1) {
  const model = tf.sequential();
  model.add(tf.layers.dense({
    inputShape: [dimension],
    units: hiddenUnits,
    activation: 'gelu',
    kernelInitializer: tf.initializers.glorotUniform({seed}),
    biasInitializer: tf.initializers.zeros(),
  }));
  model.add(tf.layers.dropout({rate: dropoutRate, seed: seed + 1}));
  model.add(tf.layers.dense({
    units: outputUnits,
    activation: 'sigmoid',
    kernelInitializer: tf.initializers.glorotUniform({seed: seed + 2}),
    biasInitializer: tf.initializers.zeros(),
  }));
  model.compile({
    optimizer: tf.train.adam(learningRate),
    loss: 'binaryCrossentropy',
    metrics: ['accuracy'],
  });
  return model;
}

export function createTrainValidationSplit(examples, validationFraction = 0.2, seed = 1337) {
  const positives = seededShuffle(examples.filter((example) => example.label === 1), seed);
  const negatives = seededShuffle(examples.filter((example) => example.label === 0), seed + 1);
  const splitClass = (items) => {
    if (items.length < 2) return {train: items, validation: []};
    const validationCount = Math.min(items.length - 1, Math.max(1, Math.round(items.length * validationFraction)));
    return {validation: items.slice(0, validationCount), train: items.slice(validationCount)};
  };
  const positiveSplit = splitClass(positives);
  const negativeSplit = splitClass(negatives);
  return {
    train: seededShuffle([...positiveSplit.train, ...negativeSplit.train], seed + 2),
    validation: seededShuffle([...positiveSplit.validation, ...negativeSplit.validation], seed + 3),
  };
}

export function createGenericTrainValidationSplit(examples, validationFraction = 0.2, seed = 1337) {
  const shuffled = seededShuffle(examples, seed);
  if (shuffled.length < 2) return {train: shuffled, validation: []};
  const validationCount = Math.min(shuffled.length - 1, Math.max(1, Math.round(shuffled.length * validationFraction)));
  return {
    validation: shuffled.slice(0, validationCount),
    train: shuffled.slice(validationCount),
  };
}

function seededShuffle(items, seed) {
  return [...items]
    .map((item) => ({item, rank: hashString(`${seed}:${item.key || String(item.track?.id || '')}`)}))
    .sort((a, b) => a.rank - b.rank)
    .map(({item}) => item);
}

function seedToInt(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return Math.trunc(numeric);
  return hashString(String(value || '1337'));
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function tensorsForExamples(examples, normalizer, dimension) {
  if (!examples.length) return null;
  return {
    xs: tf.tensor2d(examples.map((example) => normalizeRow(example.embedding, normalizer)), [examples.length, dimension]),
    ys: tf.tensor2d(examples.map((example) => [example.label]), [examples.length, 1]),
  };
}

function multiLabelTensorsForExamples(examples, normalizer, dimension, outputUnits) {
  if (!examples.length) return null;
  return {
    xs: tf.tensor2d(examples.map((example) => normalizeRow(example.embedding, normalizer)), [examples.length, dimension]),
    ys: tf.tensor2d(examples.map((example) => example.labels), [examples.length, outputUnits]),
  };
}

function normalizerFromRows(rows) {
  const dimension = rows[0].length;
  const mean = new Array(dimension).fill(0);
  const variance = new Array(dimension).fill(0);
  for (const row of rows) {
    for (let index = 0; index < dimension; index += 1) mean[index] += row[index];
  }
  for (let index = 0; index < dimension; index += 1) mean[index] /= rows.length;
  for (const row of rows) {
    for (let index = 0; index < dimension; index += 1) variance[index] += (row[index] - mean[index]) ** 2;
  }
  const std = variance.map((value) => Math.sqrt(value / rows.length) || 1);
  return {mean, std};
}

export function normalizeRow(row, normalizer) {
  const unitRow = preprocessEmbedding(row);
  return unitRow.map((value, index) => (value - normalizer.mean[index]) / normalizer.std[index]);
}

function preprocessEmbedding(row) {
  return l2Normalize(row);
}

function l2Normalize(row) {
  const norm = Math.sqrt(row.reduce((sum, value) => sum + value * value, 0));
  if (!norm) return row.map(() => 0);
  return row.map((value) => value / norm);
}

function cleanLogs(logs = {}) {
  return Object.fromEntries(Object.entries(logs).map(([key, value]) => [key, Number(value).toFixed(4)]));
}

function lossHistoryFromTfHistory(history) {
  return (history.loss || []).map((loss, index) => ({
    epoch: index + 1,
    loss: Number(loss),
    valLoss: history.val_loss?.[index] === undefined ? null : Number(history.val_loss[index]),
  }));
}

export async function predictTracks(model, normalizer, examples) {
  if (!examples.length) return [];
  return (await predictExamples(model, normalizer, examples))
    .sort((a, b) => Math.abs(b.score - 0.5) - Math.abs(a.score - 0.5));
}

export async function evaluateModel(model, normalizer, examples) {
  if (!examples.length) return emptyEvaluation();
  return metricsForPredictions(await predictExamples(model, normalizer, examples));
}

export async function predictGenreTracks(model, normalizer, examples, labels) {
  if (!examples.length) return [];
  const scores = await predictMultiLabelScores(model, normalizer, examples, labels.length);
  return examples.map((example, index) => ({
    ...example,
    scores: scores[index].map((score, labelIndex) => ({label: labels[labelIndex], score, predicted: score >= 0.5})),
  }));
}

export async function evaluateGenreModel(model, normalizer, examples, labels) {
  if (!examples.length) return emptyGenreEvaluation(labels);
  const scores = await predictMultiLabelScores(model, normalizer, examples, labels.length);
  const perLabel = labels.map((label, labelIndex) => {
    const predictions = examples.map((example, exampleIndex) => ({label: example.labels[labelIndex], score: scores[exampleIndex][labelIndex]}));
    return {label, ...metricsForPredictions(predictions)};
  });
  return {
    count: examples.length,
    labels: perLabel,
    rocAuc: mean(perLabel.map((item) => item.rocAuc).filter((value) => value !== null)),
    prAuc: mean(perLabel.map((item) => item.prAuc).filter((value) => value !== null)),
  };
}

async function predictMultiLabelScores(model, normalizer, examples, outputUnits) {
  const dimension = examples[0].embedding.length;
  const xs = tf.tensor2d(examples.map((example) => normalizeRow(example.embedding, normalizer)), [examples.length, dimension]);
  const prediction = model.predict(xs);
  const data = await prediction.data();
  xs.dispose();
  prediction.dispose();
  const rows = [];
  for (let index = 0; index < examples.length; index += 1) {
    rows.push(Array.from(data.slice(index * outputUnits, (index + 1) * outputUnits), Number));
  }
  return rows;
}

async function predictExamples(model, normalizer, examples) {
  const dimension = examples[0].embedding.length;
  const xs = tf.tensor2d(examples.map((example) => normalizeRow(example.embedding, normalizer)), [examples.length, dimension]);
  const prediction = model.predict(xs);
  const scores = await prediction.data();
  xs.dispose();
  prediction.dispose();
  return examples
    .map((example, index) => ({...example, score: Number(scores[index]), predictedLabel: scores[index] >= 0.5 ? 'like' : 'unlike'}));
}

function metricsForPredictions(predictions) {
  const confusion = {tp: 0, fp: 0, tn: 0, fn: 0};
  for (const item of predictions) {
    if (item.label === 1 && item.score >= 0.5) confusion.tp += 1;
    if (item.label === 0 && item.score >= 0.5) confusion.fp += 1;
    if (item.label === 0 && item.score < 0.5) confusion.tn += 1;
    if (item.label === 1 && item.score < 0.5) confusion.fn += 1;
  }
  const positives = predictions.filter((item) => item.label === 1).length;
  const negatives = predictions.length - positives;
  return {
    count: predictions.length,
    positives,
    negatives,
    rocAuc: rocAuc(predictions),
    prAuc: prAuc(predictions),
    confusion,
  };
}

function emptyEvaluation() {
  return {count: 0, positives: 0, negatives: 0, rocAuc: null, prAuc: null, confusion: {tp: 0, fp: 0, tn: 0, fn: 0}};
}

function emptyGenreEvaluation(labels) {
  return {count: 0, rocAuc: null, prAuc: null, labels: labels.map((label) => ({label, ...emptyEvaluation()}))};
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function rocAuc(predictions) {
  const positives = predictions.filter((item) => item.label === 1);
  const negatives = predictions.filter((item) => item.label === 0);
  if (!positives.length || !negatives.length) return null;
  let wins = 0;
  for (const positive of positives) {
    for (const negative of negatives) {
      if (positive.score > negative.score) wins += 1;
      else if (positive.score === negative.score) wins += 0.5;
    }
  }
  return wins / (positives.length * negatives.length);
}

function prAuc(predictions) {
  const sorted = [...predictions].sort((a, b) => b.score - a.score);
  const positiveCount = sorted.filter((item) => item.label === 1).length;
  if (!positiveCount || positiveCount === sorted.length) return null;
  let tp = 0;
  let fp = 0;
  let previousRecall = 0;
  let area = 0;
  for (const item of sorted) {
    if (item.label === 1) tp += 1;
    else fp += 1;
    const recall = tp / positiveCount;
    const precision = tp / (tp + fp);
    area += (recall - previousRecall) * precision;
    previousRecall = recall;
  }
  return area;
}

export function modelStorageUrl(username, slot) {
  return `indexeddb://streetparade-preference-${safePart(username)}-${slot}`;
}

export function modelMetaKey(username) {
  return `streetparade-preference-models:${safePart(username)}`;
}

export function readModelMetadata(username) {
  if (!username) return {};
  try {
    return JSON.parse(localStorage.getItem(modelMetaKey(username)) || '{}');
  } catch {
    return {};
  }
}

export function writeModelMetadata(username, metadata) {
  localStorage.setItem(modelMetaKey(username), JSON.stringify(metadata));
}

export async function saveModel(username, slot, trained, summary, options) {
  const url = modelStorageUrl(username, slot);
  await trained.model.save(url);
  const existing = readModelMetadata(username);
  existing[slot] = {
    slot,
    url,
    createdAt: new Date().toISOString(),
    dimension: trained.dimension,
    normalizer: trained.normalizer,
    preprocessing: 'l2-normalize + train-set z-score standardize',
    evaluation: trained.evaluation,
    lossHistory: trained.lossHistory,
    randomSeed: trained.seed,
    split: {
      trainCount: trained.split.train.length,
      validationCount: trained.split.validation.length,
    },
    summary,
    options,
  };
  writeModelMetadata(username, existing);
  return existing;
}

export async function loadModel(username, slot) {
  const metadata = readModelMetadata(username)[slot];
  if (!metadata) throw new Error('No model saved in that slot.');
  const model = await tf.loadLayersModel(metadata.url);
  return {model, metadata};
}

export async function deleteModel(username, slot) {
  const metadata = readModelMetadata(username);
  try {
    await tf.io.removeModel(modelStorageUrl(username, slot));
  } catch {
    // IndexedDB remove fails when the slot is already empty; metadata cleanup is still safe.
  }
  delete metadata[slot];
  writeModelMetadata(username, metadata);
  return metadata;
}

function safePart(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, '-');
}
