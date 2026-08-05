import * as tf from '@tensorflow/tfjs';
import {safeGetItem, safeSetItem} from './storage';
import type {PreferenceValue} from './types';

export type {PreferenceValue} from './types';

export type EmbeddedTrack = {
  id: number;
  title?: string;
  url?: string;
  artist_name?: string;
  artist?: string;
  embedding: number[];
};

export type PreferenceExample = {
  key: string;
  track: EmbeddedTrack;
  label: 0 | 1;
  embedding: number[];
};

export type Prediction = {
  key: string;
  score: number;
  value: PreferenceValue;
};

export type TrainingOptions = {
  epochs: number;
  batchSize: number;
  hiddenUnits: number;
  dropoutRate: number;
  learningRate: number;
  validationFraction: number;
  randomSeed: number;
};

export type Normalizer = {
  mean: number[];
  std: number[];
};

export type LossPoint = {
  epoch: number;
  loss: number;
  valLoss: number | null;
};

export type Evaluation = {
  count: number;
  positives: number;
  negatives: number;
  accuracy: number | null;
  rocAuc: number | null;
  prAuc: number | null;
  confusion: {tp: number; fp: number; tn: number; fn: number};
};

export type TrainedPreferenceModel = {
  model: tf.LayersModel;
  normalizer: Normalizer;
  dimension: number;
  trainedAt: string;
  options: TrainingOptions;
  lossHistory: LossPoint[];
  evaluation: {train: Evaluation; validation: Evaluation};
};

export const DEFAULT_TRAINING_OPTIONS: TrainingOptions = {
  epochs: 40,
  batchSize: 16,
  hiddenUnits: 1024,
  dropoutRate: 0.3,
  learningRate: 0.001,
  validationFraction: 0.2,
  randomSeed: 1337,
};

const MODEL_META_KEY = 'streetparade-visualizer:preference-model-meta';
const MODEL_URL = 'indexeddb://streetparade-visualizer-preference-model';

export function buildPreferenceDataset(tracks: EmbeddedTrack[], preferences: Record<string, string>) {
  const examples: PreferenceExample[] = [];
  const unlabeled: EmbeddedTrack[] = [];
  for (const track of tracks) {
    if (!Array.isArray(track.embedding) || !track.embedding.length) continue;
    const key = preferenceKeyForTrack(track);
    const value = preferences[key];
    if (value === 'up' || value === 'down') {
      examples.push({key, track, label: value === 'up' ? 1 : 0, embedding: track.embedding});
    } else {
      unlabeled.push(track);
    }
  }
  return {examples, unlabeled};
}

export function preferenceKeyForTrack(track: Pick<EmbeddedTrack, 'id'>) {
  return `track:${track.id}`;
}

export function summarizeExamples(examples: PreferenceExample[], unlabeled: EmbeddedTrack[]) {
  const likes = examples.filter((example) => example.label === 1).length;
  const dislikes = examples.filter((example) => example.label === 0).length;
  return {total: examples.length, likes, dislikes, unlabeled: unlabeled.length, canTrain: likes > 0 && dislikes > 0};
}

export async function trainPreferenceModel(examples: PreferenceExample[], options: TrainingOptions): Promise<TrainedPreferenceModel> {
  const summary = summarizeExamples(examples, []);
  if (!summary.canTrain) throw new Error('Training needs at least one like and one unlike.');
  const split = createTrainValidationSplit(examples, options.validationFraction, options.randomSeed);
  const dimension = split.train[0].embedding.length;
  const trainRows = split.train.map((example) => l2Normalize(example.embedding));
  const normalizer = normalizerFromRows(trainRows);
  const xs = tf.tensor2d(trainRows.map((row) => standardizeRow(row, normalizer)), [split.train.length, dimension]);
  const ys = tf.tensor2d(split.train.map((example) => [example.label]), [split.train.length, 1]);
  const validation = tensorsForExamples(split.validation, normalizer, dimension);
  const model = createModel(dimension, options);
  try {
    const history = await model.fit(xs, ys, {
      epochs: options.epochs,
      batchSize: Math.min(options.batchSize, split.train.length),
      shuffle: false,
      verbose: 0,
      ...(validation ? {validationData: [validation.xs, validation.ys]} : {}),
    });
    return {
      model,
      normalizer,
      dimension,
      trainedAt: new Date().toISOString(),
      options,
      lossHistory: lossHistoryFromTfHistory(history.history),
      evaluation: {
        train: await evaluatePreferenceModel(model, normalizer, split.train),
        validation: await evaluatePreferenceModel(model, normalizer, split.validation),
      },
    };
  } finally {
    xs.dispose();
    ys.dispose();
    validation?.xs.dispose();
    validation?.ys.dispose();
  }
}

export async function predictTrackPreferences(trained: TrainedPreferenceModel, tracks: EmbeddedTrack[]): Promise<Record<string, Prediction>> {
  const candidates = tracks.filter((track) => Array.isArray(track.embedding) && track.embedding.length === trained.dimension);
  if (!candidates.length) return {};
  const xs = tf.tensor2d(
    candidates.map((track) => standardizeRow(l2Normalize(track.embedding), trained.normalizer)),
    [candidates.length, trained.dimension],
  );
  const prediction = trained.model.predict(xs) as tf.Tensor;
  const scores = await prediction.data();
  xs.dispose();
  prediction.dispose();
  return Object.fromEntries(candidates.map((track, index) => {
    const score = Number(scores[index]);
    const value: PreferenceValue = score >= 0.5 ? 'up' : 'down';
    const key = preferenceKeyForTrack(track);
    return [key, {key, score, value}];
  }));
}

export async function savePreferenceModel(trained: TrainedPreferenceModel) {
  await trained.model.save(MODEL_URL);
  safeSetItem(MODEL_META_KEY, JSON.stringify({
    normalizer: trained.normalizer,
    dimension: trained.dimension,
    trainedAt: trained.trainedAt,
    options: trained.options,
    lossHistory: trained.lossHistory,
    evaluation: trained.evaluation,
  }));
}

export async function loadPreferenceModel(): Promise<TrainedPreferenceModel | null> {
  const raw = safeGetItem(MODEL_META_KEY);
  if (!raw) return null;
  const metadata = JSON.parse(raw);
  const model = await tf.loadLayersModel(MODEL_URL);
  return {...metadata, model};
}

export function hasSavedPreferenceModel() {
  return Boolean(safeGetItem(MODEL_META_KEY));
}

function createModel(dimension: number, options: TrainingOptions) {
  const model = tf.sequential();
  model.add(tf.layers.dense({
    inputShape: [dimension],
    units: options.hiddenUnits,
    activation: 'gelu',
    kernelInitializer: tf.initializers.glorotUniform({seed: options.randomSeed}),
    biasInitializer: tf.initializers.zeros(),
  }));
  model.add(tf.layers.dropout({rate: options.dropoutRate, seed: options.randomSeed + 1}));
  model.add(tf.layers.dense({
    units: 1,
    activation: 'sigmoid',
    kernelInitializer: tf.initializers.glorotUniform({seed: options.randomSeed + 2}),
    biasInitializer: tf.initializers.zeros(),
  }));
  model.compile({optimizer: tf.train.adam(options.learningRate), loss: 'binaryCrossentropy', metrics: ['accuracy']});
  return model;
}

function createTrainValidationSplit(examples: PreferenceExample[], validationFraction: number, seed: number) {
  const positives = seededShuffle(examples.filter((example) => example.label === 1), seed);
  const negatives = seededShuffle(examples.filter((example) => example.label === 0), seed + 1);
  const splitClass = (items: PreferenceExample[]) => {
    if (items.length < 2) return {train: items, validation: [] as PreferenceExample[]};
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

function tensorsForExamples(examples: PreferenceExample[], normalizer: Normalizer, dimension: number) {
  if (!examples.length) return null;
  return {
    xs: tf.tensor2d(examples.map((example) => standardizeRow(l2Normalize(example.embedding), normalizer)), [examples.length, dimension]),
    ys: tf.tensor2d(examples.map((example) => [example.label]), [examples.length, 1]),
  };
}

async function evaluatePreferenceModel(model: tf.LayersModel, normalizer: Normalizer, examples: PreferenceExample[]): Promise<Evaluation> {
  if (!examples.length) return emptyEvaluation();
  const dimension = examples[0].embedding.length;
  const xs = tf.tensor2d(examples.map((example) => standardizeRow(l2Normalize(example.embedding), normalizer)), [examples.length, dimension]);
  const prediction = model.predict(xs) as tf.Tensor;
  const scores = await prediction.data();
  xs.dispose();
  prediction.dispose();
  return metricsForPredictions(examples.map((example, index) => ({label: example.label, score: Number(scores[index])})));
}

function lossHistoryFromTfHistory(history: tf.History['history']): LossPoint[] {
  return (history.loss || []).map((loss, index) => ({
    epoch: index + 1,
    loss: Number(loss),
    valLoss: history.val_loss?.[index] === undefined ? null : Number(history.val_loss[index]),
  }));
}

function metricsForPredictions(predictions: Array<{label: 0 | 1; score: number}>): Evaluation {
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
    accuracy: predictions.length ? (confusion.tp + confusion.tn) / predictions.length : null,
    rocAuc: rocAuc(predictions),
    prAuc: prAuc(predictions),
    confusion,
  };
}

function emptyEvaluation(): Evaluation {
  return {count: 0, positives: 0, negatives: 0, accuracy: null, rocAuc: null, prAuc: null, confusion: {tp: 0, fp: 0, tn: 0, fn: 0}};
}

function rocAuc(predictions: Array<{label: 0 | 1; score: number}>) {
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

function prAuc(predictions: Array<{label: 0 | 1; score: number}>) {
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

function seededShuffle<T extends {key: string}>(items: T[], seed: number) {
  return [...items]
    .map((item) => ({item, rank: hashString(`${seed}:${item.key}`)}))
    .sort((a, b) => a.rank - b.rank)
    .map(({item}) => item);
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalizerFromRows(rows: number[][]): Normalizer {
  const dimension = rows[0].length;
  const mean = new Array(dimension).fill(0);
  const variance = new Array(dimension).fill(0);
  for (const row of rows) for (let index = 0; index < dimension; index += 1) mean[index] += row[index];
  for (let index = 0; index < dimension; index += 1) mean[index] /= rows.length;
  for (const row of rows) for (let index = 0; index < dimension; index += 1) variance[index] += (row[index] - mean[index]) ** 2;
  return {mean, std: variance.map((value) => Math.sqrt(value / rows.length) || 1)};
}

function standardizeRow(row: number[], normalizer: Normalizer) {
  return row.map((value, index) => (value - normalizer.mean[index]) / normalizer.std[index]);
}

function l2Normalize(row: number[]) {
  const norm = Math.sqrt(row.reduce((sum, value) => sum + value * value, 0));
  if (!norm) return row.map(() => 0);
  return row.map((value) => value / norm);
}
