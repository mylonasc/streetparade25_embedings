import React, {useEffect, useMemo, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ANNOTATION_API_BASE_URL, API_BASE_URL, getAllEmbeddedTracks, getAnnotationCampaigns, getCampaignLabelSets, getCampaignSamples, getLabelSetLabels, getUserPreferences, request} from './api.js';
import {
  MODEL_SLOTS,
  buildDataset,
  buildGenreDataset,
  canTrain,
  datasetSummary,
  deleteModel,
  loadModel,
  predictGenreTracks,
  predictTracks,
  readModelMetadata,
  saveModel,
  trainGenreModel,
  trainPreferenceModel,
} from './training.js';
import './styles.css';

const RECENT_USERS_KEY = 'streetparade-preference-trainer:recent-users';

function App() {
  const [activeTab, setActiveTab] = useState('preferences');
  const [draftUsername, setDraftUsername] = useState('');
  const [username, setUsername] = useState('');
  const [recentUsers, setRecentUsers] = useState(readRecentUsers);
  const [tracks, setTracks] = useState([]);
  const [preferences, setPreferences] = useState({});
  const [modelMetadata, setModelMetadata] = useState({});
  const [selectedSlot, setSelectedSlot] = useState(MODEL_SLOTS[0]);
  const [options, setOptions] = useState({epochs: 40, batchSize: 16, hiddenUnits: 1024, dropoutRate: 0.3, learningRate: 0.001, validationFraction: 0.2, randomSeed: 1337});
  const [training, setTraining] = useState(false);
  const [epochLog, setEpochLog] = useState([]);
  const [lossHistory, setLossHistory] = useState([]);
  const [evaluation, setEvaluation] = useState(null);
  const [evaluationSplit, setEvaluationSplit] = useState('validation');
  const [predictions, setPredictions] = useState([]);
  const [activeModelLabel, setActiveModelLabel] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [campaigns, setCampaigns] = useState([]);
  const [campaignId, setCampaignId] = useState('');
  const [labelSets, setLabelSets] = useState([]);
  const [labelSetId, setLabelSetId] = useState('');
  const [genreLabels, setGenreLabels] = useState([]);
  const [campaignSamples, setCampaignSamples] = useState([]);
  const [genreTraining, setGenreTraining] = useState(false);
  const [genreEpochLog, setGenreEpochLog] = useState([]);
  const [genreLossHistory, setGenreLossHistory] = useState([]);
  const [genreEvaluation, setGenreEvaluation] = useState(null);
  const [genreEvaluationSplit, setGenreEvaluationSplit] = useState('validation');
  const [genrePredictions, setGenrePredictions] = useState([]);
  const [selectedGenreIndex, setSelectedGenreIndex] = useState(0);

  const dataset = useMemo(() => buildDataset(tracks, preferences), [tracks, preferences]);
  const summary = useMemo(() => datasetSummary(dataset.examples, dataset.unlabeled), [dataset]);
  const genreDataset = useMemo(() => buildGenreDataset(tracks, campaignSamples, genreLabels), [tracks, campaignSamples, genreLabels]);

  useEffect(() => {
    if (username) setModelMetadata(readModelMetadata(username));
  }, [username]);

  async function selectUser(event) {
    event.preventDefault();
    const nextUsername = draftUsername.trim().toLowerCase();
    if (!nextUsername) return;
    setError('');
    setMessage('Loading preferences and embeddings...');
    setPredictions([]);
    setEvaluation(null);
    setLossHistory([]);
    setActiveModelLabel('');
    try {
      await request('/users', {method: 'POST', body: JSON.stringify({username: nextUsername})});
      const [nextPreferences, nextTracks] = await Promise.all([
        getUserPreferences(nextUsername),
        getAllEmbeddedTracks(),
      ]);
      setUsername(nextUsername);
      setPreferences(nextPreferences);
      setTracks(nextTracks);
      setModelMetadata(readModelMetadata(nextUsername));
      const nextRecentUsers = [nextUsername, ...recentUsers.filter((user) => user !== nextUsername)].slice(0, 8);
      localStorage.setItem(RECENT_USERS_KEY, JSON.stringify(nextRecentUsers));
      setRecentUsers(nextRecentUsers);
      setMessage(`Loaded ${nextTracks.length} embedded tracks and ${Object.keys(nextPreferences).length} preferences.`);
    } catch (err) {
      setError(err.message);
      setMessage('');
    }
  }

  async function trainAndSave() {
    setError('');
    setMessage('');
    setEpochLog([]);
    setLossHistory([]);
    setTraining(true);
    try {
      if (!canTrain(summary)) throw new Error('Training needs at least one like and one unlike.');
      const trained = await trainPreferenceModel(dataset.examples, options, (entry) => {
        setEpochLog((existing) => [entry, ...existing].slice(0, 8));
        setLossHistory((existing) => [...existing, {epoch: entry.epoch, loss: Number(entry.logs.loss), valLoss: entry.logs.val_loss === undefined ? null : Number(entry.logs.val_loss)}]);
      });
      const metadata = await saveModel(username, selectedSlot, trained, summary, options);
      const nextPredictions = await predictTracks(trained.model, trained.normalizer, dataset.unlabeled);
      setModelMetadata(metadata);
      setEvaluation(trained.evaluation);
      setLossHistory(trained.lossHistory || []);
      setEvaluationSplit(trained.evaluation.validation.count ? 'validation' : 'train');
      setPredictions(nextPredictions);
      setActiveModelLabel(`${selectedSlot} trained just now`);
      setMessage(`Saved model in ${selectedSlot}. Predicted ${nextPredictions.length} unlabeled songs.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setTraining(false);
    }
  }

  async function loadAndPredict(slot) {
    setError('');
    setMessage('Loading model...');
    try {
      const loaded = await loadModel(username, slot);
      const compatible = dataset.unlabeled.every((example) => example.embedding.length === loaded.metadata.dimension);
      if (!compatible) throw new Error('Saved model embedding dimension does not match the loaded tracks.');
      const nextPredictions = await predictTracks(loaded.model, loaded.metadata.normalizer, dataset.unlabeled);
      setSelectedSlot(slot);
      setEvaluation(loaded.metadata.evaluation || null);
      setLossHistory(loaded.metadata.lossHistory || []);
      setEvaluationSplit(loaded.metadata.evaluation?.validation?.count ? 'validation' : 'train');
      setPredictions(nextPredictions);
      setActiveModelLabel(`${slot} from ${formatDate(loaded.metadata.createdAt)}`);
      setMessage(`Predicted ${nextPredictions.length} unlabeled songs.`);
    } catch (err) {
      setError(err.message);
      setMessage('');
    }
  }

  async function removeModel(slot) {
    setError('');
    try {
      setModelMetadata(await deleteModel(username, slot));
      if (selectedSlot === slot) {
        setPredictions([]);
        setEvaluation(null);
        setLossHistory([]);
        setActiveModelLabel('');
      }
      setMessage(`Cleared ${slot}.`);
    } catch (err) {
      setError(err.message);
    }
  }

  async function loadGenreBase() {
    setError('');
    setMessage('Loading annotation campaigns and embeddings...');
    try {
      const [nextCampaigns, nextTracks] = await Promise.all([
        getAnnotationCampaigns(),
        tracks.length ? Promise.resolve(tracks) : getAllEmbeddedTracks(),
      ]);
      setCampaigns(nextCampaigns);
      setTracks(nextTracks);
      const nextCampaignId = campaignId || String(nextCampaigns[0]?.id || '');
      setCampaignId(nextCampaignId);
      if (nextCampaignId) await loadGenreCampaign(nextCampaignId);
      setMessage(`Loaded ${nextCampaigns.length} campaigns and ${nextTracks.length} embedded tracks.`);
    } catch (err) {
      setError(err.message);
      setMessage('');
    }
  }

  async function loadGenreCampaign(nextCampaignId) {
    if (!nextCampaignId) return;
    const [sets, samples] = await Promise.all([
      getCampaignLabelSets(nextCampaignId),
      getCampaignSamples(nextCampaignId),
    ]);
    setLabelSets(sets);
    setCampaignSamples(samples);
    const nextLabelSetId = String(sets[0]?.id || '');
    setLabelSetId(nextLabelSetId);
    setGenreLabels(nextLabelSetId ? await getLabelSetLabels(nextLabelSetId) : []);
    setGenreEvaluation(null);
    setGenrePredictions([]);
  }

  async function selectGenreCampaign(nextCampaignId) {
    setCampaignId(nextCampaignId);
    setError('');
    try {
      await loadGenreCampaign(nextCampaignId);
    } catch (err) {
      setError(err.message);
    }
  }

  async function selectGenreLabelSet(nextLabelSetId) {
    setLabelSetId(nextLabelSetId);
    setError('');
    try {
      setGenreLabels(nextLabelSetId ? await getLabelSetLabels(nextLabelSetId) : []);
      setSelectedGenreIndex(0);
      setGenreEvaluation(null);
      setGenrePredictions([]);
    } catch (err) {
      setError(err.message);
    }
  }

  async function trainGenres() {
    setError('');
    setMessage('');
    setGenreEpochLog([]);
    setGenreLossHistory([]);
    setGenreTraining(true);
    try {
      if (!genreLabels.length) throw new Error('Select a label set with genre labels.');
      if (!genreDataset.examples.length) throw new Error('No embedded tracks have assignments for this label set.');
      const trained = await trainGenreModel(genreDataset.examples, genreLabels, options, (entry) => {
        setGenreEpochLog((existing) => [entry, ...existing].slice(0, 8));
        setGenreLossHistory((existing) => [...existing, {epoch: entry.epoch, loss: Number(entry.logs.loss), valLoss: entry.logs.val_loss === undefined ? null : Number(entry.logs.val_loss)}]);
      });
      setGenreEvaluation(trained.evaluation);
      setGenreEvaluationSplit(trained.evaluation.validation.count ? 'validation' : 'train');
      setGenreLossHistory(trained.lossHistory || []);
      setGenrePredictions(await predictGenreTracks(trained.model, trained.normalizer, genreDataset.unlabeled, genreLabels));
      setMessage(`Trained genre model on ${trained.split.train.length} train / ${trained.split.validation.length} validation tracks.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setGenreTraining(false);
    }
  }

  return (
    <main className="shell">
      <header className="hero">
        <p className="eyebrow">Browser-only PoC</p>
        <h1>Preference model trainer</h1>
        <p>Train a TensorFlow.js classifier from CLAP embeddings and a user’s like/unlike preferences. Models are saved in this browser’s IndexedDB, two slots per username.</p>
        <span className="api-pill">API: {API_BASE_URL}</span>
        <span className="api-pill">Annotation API: {ANNOTATION_API_BASE_URL}</span>
      </header>

      <nav className="tabs" aria-label="Trainer tabs">
        <button type="button" className={activeTab === 'preferences' ? '' : 'secondary'} onClick={() => setActiveTab('preferences')}>User preferences</button>
        <button type="button" className={activeTab === 'genres' ? '' : 'secondary'} onClick={() => setActiveTab('genres')}>Genre labels</button>
      </nav>

      {activeTab === 'preferences' && (
        <section className="panel user-panel">
          <form onSubmit={selectUser}>
            <label>
              User
              <input list="recent-users" value={draftUsername} onChange={(event) => setDraftUsername(event.target.value)} placeholder="username" />
            </label>
            <datalist id="recent-users">
              {recentUsers.map((user) => <option key={user} value={user} />)}
            </datalist>
            <button type="submit">Load user dataset</button>
          </form>
        </section>
      )}

      {(message || error) && <section className={`notice ${error ? 'error' : ''}`}>{error || message}</section>}

      {activeTab === 'preferences' ? (
        <>
          <section className="grid">
            <DatasetCard username={username} tracks={tracks} summary={summary} />
            <TrainingCard disabled={!username || !canTrain(summary) || training} options={options} setOptions={setOptions} selectedSlot={selectedSlot} setSelectedSlot={setSelectedSlot} onTrain={trainAndSave} training={training} epochLog={epochLog} lossHistory={lossHistory} canTrain={canTrain(summary)} />
            <ModelSlots username={username} metadata={modelMetadata} onLoad={loadAndPredict} onDelete={removeModel} />
          </section>
          <EvaluationPanel evaluation={evaluation} split={evaluationSplit} setSplit={setEvaluationSplit} />
          <Predictions activeModelLabel={activeModelLabel} predictions={predictions} />
        </>
      ) : (
        <GenreTrainer campaigns={campaigns} campaignId={campaignId} labelSets={labelSets} labelSetId={labelSetId} labels={genreLabels} dataset={genreDataset} tracks={tracks} options={options} setOptions={setOptions} training={genreTraining} epochLog={genreEpochLog} lossHistory={genreLossHistory} evaluation={genreEvaluation} evaluationSplit={genreEvaluationSplit} setEvaluationSplit={setGenreEvaluationSplit} selectedGenreIndex={selectedGenreIndex} setSelectedGenreIndex={setSelectedGenreIndex} predictions={genrePredictions} onLoad={loadGenreBase} onCampaign={selectGenreCampaign} onLabelSet={selectGenreLabelSet} onTrain={trainGenres} />
      )}
    </main>
  );
}

function DatasetCard({username, tracks, summary}) {
  return (
    <section className="panel metric-card">
      <p className="eyebrow">Dataset</p>
      <h2>{username || 'No user selected'}</h2>
      <div className="metrics">
        <Metric label="embedded tracks" value={tracks.length} />
        <Metric label="labeled" value={summary.total} />
        <Metric label="likes" value={summary.likes} tone="good" />
        <Metric label="unlikes" value={summary.dislikes} tone="bad" />
        <Metric label="to predict" value={summary.unlabeled} />
      </div>
      {username && !canTrain(summary) && <p className="hint">Add at least one like and one unlike in the visualizer before training.</p>}
    </section>
  );
}

function TrainingCard({disabled, options, setOptions, selectedSlot, setSelectedSlot, onTrain, training, epochLog, lossHistory, canTrain}) {
  const validationPercent = Math.round((options.validationFraction ?? 0.2) * 100);
  const trainingPercent = 100 - validationPercent;
  return (
    <section className="panel training-card">
      <p className="eyebrow">Train</p>
      <h2>GELU dense classifier</h2>
      <div className="form-grid">
        <NumberInput label="epochs" value={options.epochs} min={1} max={300} onChange={(value) => setOptions({...options, epochs: value})} />
        <NumberInput label="batch" value={options.batchSize} min={1} max={128} onChange={(value) => setOptions({...options, batchSize: value})} />
        <NumberInput label="GELU units" value={options.hiddenUnits} min={4} max={4096} onChange={(value) => setOptions({...options, hiddenUnits: value})} />
        <label>
          dropout
          <input type="number" step="0.05" min="0" max="0.9" value={options.dropoutRate} onChange={(event) => setOptions({...options, dropoutRate: Number(event.target.value)})} />
        </label>
        <NumberInput label="random seed" value={options.randomSeed} min={0} max={999999999} onChange={(value) => setOptions({...options, randomSeed: value})} />
        <label>
          validation split %
          <input type="number" min="5" max="50" value={validationPercent} onChange={(event) => setOptions({...options, validationFraction: clamp(Number(event.target.value), 5, 50) / 100})} />
        </label>
        <label>
          learning rate
          <input type="number" step="0.0001" min="0.0001" max="0.1" value={options.learningRate} onChange={(event) => setOptions({...options, learningRate: Number(event.target.value)})} />
        </label>
        <label>
          save slot
          <select value={selectedSlot} onChange={(event) => setSelectedSlot(event.target.value)}>
            {MODEL_SLOTS.map((slot) => <option key={slot} value={slot}>{slot}</option>)}
          </select>
        </label>
      </div>
      <button type="button" disabled={disabled} onClick={onTrain}>{training ? 'Training...' : `Train and save to ${selectedSlot}`}</button>
      <p className="hint">Preprocessing: L2-normalize each CLAP embedding, then z-score standardize with train-set mean/std. Architecture: Dense GELU({options.hiddenUnits}) {'->'} Dropout({options.dropoutRate}) {'->'} Dense sigmoid(1). Split: {trainingPercent}% train / {validationPercent}% validation. Seed: {options.randomSeed}.</p>
      {!canTrain && <p className="hint">Needs both classes to avoid a one-class classifier.</p>}
      <LossChart history={lossHistory} />
      {epochLog.length > 0 && (
        <div className="log">
          {epochLog.map((entry) => <span key={entry.epoch}>epoch {entry.epoch}: loss {entry.logs.loss}{entry.logs.acc ? `, acc ${entry.logs.acc}` : ''}{entry.logs.val_loss ? `, val_loss ${entry.logs.val_loss}` : ''}</span>)}
        </div>
      )}
    </section>
  );
}

function LossChart({history}) {
  if (!history.length) return null;
  const width = 680;
  const height = 220;
  const padding = {top: 18, right: 18, bottom: 34, left: 48};
  const losses = history.flatMap((point) => [point.loss, point.valLoss]).filter((value) => Number.isFinite(value));
  const maxLoss = Math.max(...losses, 1);
  const minLoss = Math.min(...losses, 0);
  const x = (epoch) => padding.left + ((epoch - 1) / Math.max(1, history.length - 1)) * (width - padding.left - padding.right);
  const y = (loss) => height - padding.bottom - ((loss - minLoss) / Math.max(0.000001, maxLoss - minLoss)) * (height - padding.top - padding.bottom);
  const linePath = (key) => history
    .filter((point) => Number.isFinite(point[key]))
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(point.epoch).toFixed(2)} ${y(point[key]).toFixed(2)}`)
    .join(' ');
  return (
    <div className="loss-chart" aria-label="Training and validation loss chart">
      <div className="chart-legend">
        <span><i className="train-line" /> train loss</span>
        <span><i className="val-line" /> validation loss</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img">
        <line x1={padding.left} y1={height - padding.bottom} x2={width - padding.right} y2={height - padding.bottom} />
        <line x1={padding.left} y1={padding.top} x2={padding.left} y2={height - padding.bottom} />
        <text x={padding.left} y={height - 8}>epoch 1</text>
        <text x={width - padding.right - 68} y={height - 8}>epoch {history.at(-1)?.epoch}</text>
        <text x={8} y={padding.top + 4}>{maxLoss.toFixed(3)}</text>
        <text x={8} y={height - padding.bottom}>{minLoss.toFixed(3)}</text>
        <path className="train-loss" d={linePath('loss')} />
        <path className="val-loss" d={linePath('valLoss')} />
      </svg>
    </div>
  );
}

function ModelSlots({username, metadata, onLoad, onDelete}) {
  return (
    <section className="panel slots-card">
      <p className="eyebrow">Stored models</p>
      <h2>Two local slots</h2>
      <div className="slots">
        {MODEL_SLOTS.map((slot) => {
          const item = metadata[slot];
          return (
            <article key={slot} className="slot">
              <strong>{slot}</strong>
              {item ? (
                <>
                  <span>{formatDate(item.createdAt)}</span>
                  <span>{item.summary.likes} likes / {item.summary.dislikes} unlikes</span>
                  {item.options && <span>seed {item.options.randomSeed ?? item.randomSeed ?? 'n/a'} · {Math.round((1 - (item.options.validationFraction ?? 0.2)) * 100)}/{Math.round((item.options.validationFraction ?? 0.2) * 100)} split</span>}
                  {item.preprocessing && <span>{item.preprocessing}</span>}
                  {item.evaluation?.validation && <span>val ROC {formatMetric(item.evaluation.validation.rocAuc)} / PR {formatMetric(item.evaluation.validation.prAuc)}</span>}
                  <div className="slot-actions">
                    <button type="button" disabled={!username} onClick={() => onLoad(slot)}>Predict</button>
                    <button type="button" className="secondary" disabled={!username} onClick={() => onDelete(slot)}>Delete</button>
                  </div>
                </>
              ) : <span>empty</span>}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function GenreTrainer({campaigns, campaignId, labelSets, labelSetId, labels, dataset, tracks, options, setOptions, training, epochLog, lossHistory, evaluation, evaluationSplit, setEvaluationSplit, selectedGenreIndex, setSelectedGenreIndex, predictions, onLoad, onCampaign, onLabelSet, onTrain}) {
  const labelCounts = labels.map((label, index) => ({label, count: dataset.examples.filter((example) => example.labels[index] === 1).length}));
  return (
    <>
      <section className="panel genre-controls">
        <div>
          <p className="eyebrow">Label source</p>
          <h2>Annotation campaigns</h2>
        </div>
        <button type="button" onClick={onLoad}>Load annotation data</button>
        <label>
          campaign
          <select value={campaignId} onChange={(event) => onCampaign(event.target.value)}>
            <option value="">Select campaign</option>
            {campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}
          </select>
        </label>
        <label>
          label set
          <select value={labelSetId} onChange={(event) => onLabelSet(event.target.value)}>
            <option value="">Select label set</option>
            {labelSets.map((set) => <option key={set.id} value={set.id}>{set.name}</option>)}
          </select>
        </label>
      </section>

      <section className="grid">
        <section className="panel metric-card">
          <p className="eyebrow">Genre dataset</p>
          <h2>{labels.length ? `${labels.length} labels` : 'No label set selected'}</h2>
          <div className="metrics">
            <Metric label="embedded tracks" value={tracks.length} />
            <Metric label="labeled tracks" value={dataset.examples.length} />
            <Metric label="to predict" value={dataset.unlabeled.length} />
            <Metric label="label set" value={labels.length} />
          </div>
          <div className="label-counts">
            {labelCounts.map((item) => <span key={item.label.id} style={{borderColor: item.label.color || undefined}}>{item.label.name}: {item.count}</span>)}
          </div>
          <p className="hint">Sample-level assignments are aggregated to track-level labels because this trainer currently uses track-level CLAP embeddings.</p>
        </section>

        <section className="panel training-card">
          <p className="eyebrow">Train</p>
          <h2>Multi-label genre classifier</h2>
          <div className="form-grid">
            <NumberInput label="epochs" value={options.epochs} min={1} max={300} onChange={(value) => setOptions({...options, epochs: value})} />
            <NumberInput label="batch" value={options.batchSize} min={1} max={128} onChange={(value) => setOptions({...options, batchSize: value})} />
            <NumberInput label="GELU units" value={options.hiddenUnits} min={4} max={4096} onChange={(value) => setOptions({...options, hiddenUnits: value})} />
            <label>dropout<input type="number" step="0.05" min="0" max="0.9" value={options.dropoutRate} onChange={(event) => setOptions({...options, dropoutRate: Number(event.target.value)})} /></label>
            <NumberInput label="random seed" value={options.randomSeed} min={0} max={999999999} onChange={(value) => setOptions({...options, randomSeed: value})} />
            <label>validation split %<input type="number" min="5" max="50" value={Math.round((options.validationFraction ?? 0.2) * 100)} onChange={(event) => setOptions({...options, validationFraction: clamp(Number(event.target.value), 5, 50) / 100})} /></label>
            <label>learning rate<input type="number" step="0.0001" min="0.0001" max="0.1" value={options.learningRate} onChange={(event) => setOptions({...options, learningRate: Number(event.target.value)})} /></label>
          </div>
          <button type="button" disabled={training || !labels.length || !dataset.examples.length} onClick={onTrain}>{training ? 'Training...' : 'Train genre model'}</button>
          <p className="hint">Output layer has one sigmoid unit per label in the selected label set.</p>
          <LossChart history={lossHistory} />
          {epochLog.length > 0 && <div className="log">{epochLog.map((entry) => <span key={entry.epoch}>epoch {entry.epoch}: loss {entry.logs.loss}{entry.logs.val_loss ? `, val_loss ${entry.logs.val_loss}` : ''}</span>)}</div>}
        </section>

        <GenrePredictions labels={labels} predictions={predictions} />
      </section>

      <GenreEvaluationPanel evaluation={evaluation} split={evaluationSplit} setSplit={setEvaluationSplit} labels={labels} selectedGenreIndex={selectedGenreIndex} setSelectedGenreIndex={setSelectedGenreIndex} />
    </>
  );
}

function GenreEvaluationPanel({evaluation, split, setSplit, labels, selectedGenreIndex, setSelectedGenreIndex}) {
  if (!evaluation) return <section className="panel evaluation-panel"><p className="eyebrow">Genre evaluation</p><h2>No trained model yet</h2><p className="hint">Train a genre model to show macro ROC/PR AUC and per-label confusion matrices.</p></section>;
  const active = evaluation[split] || evaluation.validation || evaluation.train;
  const perLabel = active.labels?.[selectedGenreIndex] || active.labels?.[0];
  return (
    <section className="panel evaluation-panel">
      <div className="predictions-header">
        <div><p className="eyebrow">Genre evaluation</p><h2>{split === 'validation' ? 'Validation set' : 'Training set'}</h2></div>
        <div className="toggle-group">
          <button type="button" className={split === 'train' ? '' : 'secondary'} onClick={() => setSplit('train')}>Training</button>
          <button type="button" className={split === 'validation' ? '' : 'secondary'} onClick={() => setSplit('validation')} disabled={!evaluation.validation?.count}>Validation</button>
        </div>
      </div>
      <div className="metrics evaluation-metrics">
        <Metric label="tracks" value={active.count} />
        <Metric label="macro ROC AUC" value={formatMetric(active.rocAuc)} />
        <Metric label="macro PR AUC" value={formatMetric(active.prAuc)} />
        <Metric label="labels" value={active.labels?.length || labels.length} />
      </div>
      <label className="genre-select">confusion matrix label<select value={selectedGenreIndex} onChange={(event) => setSelectedGenreIndex(Number(event.target.value))}>{labels.map((label, index) => <option key={label.id} value={index}>{label.name}</option>)}</select></label>
      {perLabel && <><div className="metrics evaluation-metrics"><Metric label="label ROC AUC" value={formatMetric(perLabel.rocAuc)} /><Metric label="label PR AUC" value={formatMetric(perLabel.prAuc)} /><Metric label="positives / negatives" value={`${perLabel.positives}/${perLabel.negatives}`} /><Metric label="threshold" value="0.5" /></div><ConfusionMatrix confusion={perLabel.confusion} /></>}
    </section>
  );
}

function GenrePredictions({labels, predictions}) {
  const rows = predictions.slice(0, 50).map((item) => ({...item, top: [...item.scores].sort((a, b) => b.score - a.score).slice(0, 3)}));
  return (
    <section className="panel slots-card">
      <p className="eyebrow">Genre predictions</p>
      <h2>{predictions.length ? `${predictions.length} unlabeled tracks` : 'No predictions yet'}</h2>
      {!predictions.length ? <p className="hint">Train a genre model to label remaining songs.</p> : <div className="genre-predictions">{rows.map((item) => <article key={item.key}><strong>{item.track.title || item.track.url || `Track ${item.track.id}`}</strong><span>{item.track.artist_name || item.track.artist || 'Unknown artist'}</span><div>{item.top.map((score) => <b key={score.label.id}>{score.label.name}: {Math.round(score.score * 100)}%</b>)}</div></article>)}</div>}
      {!labels.length && <p className="hint">Load a campaign and label set first.</p>}
    </section>
  );
}

function EvaluationPanel({evaluation, split, setSplit}) {
  if (!evaluation) {
    return (
      <section className="panel evaluation-panel">
        <p className="eyebrow">Evaluation</p>
        <h2>No trained model yet</h2>
        <p className="hint">Train or load a model to show ROC AUC, PR AUC, and confusion matrix.</p>
      </section>
    );
  }
  const active = evaluation[split] || evaluation.validation || evaluation.train;
  return (
    <section className="panel evaluation-panel">
      <div className="predictions-header">
        <div>
          <p className="eyebrow">Evaluation</p>
          <h2>{split === 'validation' ? 'Validation set' : 'Training set'}</h2>
        </div>
        <div className="toggle-group">
          <button type="button" className={split === 'train' ? '' : 'secondary'} onClick={() => setSplit('train')}>Training</button>
          <button type="button" className={split === 'validation' ? '' : 'secondary'} onClick={() => setSplit('validation')} disabled={!evaluation.validation?.count}>Validation</button>
        </div>
      </div>
      <div className="metrics evaluation-metrics">
        <Metric label="examples" value={active.count} />
        <Metric label="ROC AUC" value={formatMetric(active.rocAuc)} />
        <Metric label="PR AUC" value={formatMetric(active.prAuc)} />
        <Metric label="positives / negatives" value={`${active.positives}/${active.negatives}`} />
      </div>
      <ConfusionMatrix confusion={active.confusion} />
    </section>
  );
}

function ConfusionMatrix({confusion}) {
  return (
    <div className="confusion-wrap" aria-label="Confusion matrix at threshold 0.5">
      <div />
      <div className="matrix-heading">Pred like</div>
      <div className="matrix-heading">Pred unlike</div>
      <div className="matrix-heading">Actual like</div>
      <div className="matrix-cell good"><strong>{confusion.tp}</strong><span>TP</span></div>
      <div className="matrix-cell bad"><strong>{confusion.fn}</strong><span>FN</span></div>
      <div className="matrix-heading">Actual unlike</div>
      <div className="matrix-cell bad"><strong>{confusion.fp}</strong><span>FP</span></div>
      <div className="matrix-cell good"><strong>{confusion.tn}</strong><span>TN</span></div>
    </div>
  );
}

function Predictions({activeModelLabel, predictions}) {
  const likes = predictions.filter((item) => item.predictedLabel === 'like');
  const unlikes = predictions.filter((item) => item.predictedLabel === 'unlike');
  return (
    <section className="panel predictions-panel">
      <div className="predictions-header">
        <div>
          <p className="eyebrow">Predictions</p>
          <h2>{activeModelLabel || 'No active model'}</h2>
        </div>
        <span>{likes.length} predicted likes / {unlikes.length} predicted unlikes</span>
      </div>
      {predictions.length === 0 ? (
        <p className="hint">Train or load a model to classify the remaining unlabeled songs.</p>
      ) : (
        <div className="prediction-list">
          {predictions.slice(0, 80).map((item) => <PredictionRow key={item.key} item={item} />)}
        </div>
      )}
    </section>
  );
}

function PredictionRow({item}) {
  const confidence = item.predictedLabel === 'like' ? item.score : 1 - item.score;
  return (
    <article className={`prediction ${item.predictedLabel}`}>
      <div>
        <strong>{item.track.title || item.track.url || `Track ${item.track.id}`}</strong>
        <span>{item.track.artist_name || item.track.artist || 'Unknown artist'}</span>
      </div>
      <div className="score">
        <b>{item.predictedLabel}</b>
        <span>{Math.round(confidence * 100)}% confidence</span>
      </div>
    </article>
  );
}

function Metric({label, value, tone = ''}) {
  return <div className={`metric ${tone}`}><strong>{value}</strong><span>{label}</span></div>;
}

function NumberInput({label, value, min, max, onChange}) {
  return (
    <label>
      {label}
      <input type="number" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function readRecentUsers() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_USERS_KEY) || '[]');
  } catch {
    return [];
  }
}

function formatDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleString();
}

function formatMetric(value) {
  return value === null || value === undefined ? 'n/a' : Number(value).toFixed(3);
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

createRoot(document.getElementById('root')).render(<App />);
