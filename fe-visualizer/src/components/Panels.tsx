import {Heart, Star, ThumbsDown, ThumbsUp, Truck} from 'lucide-react';
import React, {useEffect, useRef, useState} from 'react';
import type {Evaluation, LossPoint, TrainingOptions} from '../preferenceTraining';
import {summarizeExamples} from '../preferenceTraining';
import {parseTimeRange, artistSetRange, truckLabel, truckNumber} from '../loveMobile';
import type {ArtistSummary, LoveMobile, PointLike, PreferenceValue, UserTrack} from '../types';

type PreferenceTrainingPanelProps = {
  options: TrainingOptions;
  setOptions: React.Dispatch<React.SetStateAction<TrainingOptions>>;
  summary: ReturnType<typeof summarizeExamples>;
  status: string;
  busy: boolean;
  lossHistory: LossPoint[];
  evaluation: {train: Evaluation; validation: Evaluation} | null;
  evaluationSplit: 'train' | 'validation';
  setEvaluationSplit: (split: 'train' | 'validation') => void;
  onRefreshPreferences: () => Promise<unknown>;
  onTrain: () => Promise<unknown>;
  onLoadModel: () => Promise<unknown>;
};

export function PreferenceTrainingPanel({options, setOptions, summary, status, busy, lossHistory, evaluation, evaluationSplit, setEvaluationSplit, onRefreshPreferences, onTrain, onLoadModel}: PreferenceTrainingPanelProps) {
  const activeEvaluation = evaluation?.[evaluationSplit] || evaluation?.validation || evaluation?.train;
  return (
    <section className="panel training-panel">
      <h2>Preference training</h2>
      <p className="muted">Train a browser-local TensorFlow.js model from liked/unliked CLAP embeddings, then color remaining songs by predicted preference.</p>
      <div className="training-stats">
        <span>{summary.total} labels</span>
        <span>{summary.likes} liked</span>
        <span>{summary.dislikes} unliked</span>
        <span>{summary.unlabeled} unlabeled</span>
      </div>
      <div className="training-options">
        <label>Epochs<input type="number" min="1" max="300" value={options.epochs} onChange={(event) => setOptions({...options, epochs: Number(event.target.value)})} /></label>
        <label>Hidden units<input type="number" min="8" max="4096" step="8" value={options.hiddenUnits} onChange={(event) => setOptions({...options, hiddenUnits: Number(event.target.value)})} /></label>
        <label>Dropout<input type="number" min="0" max="0.9" step="0.05" value={options.dropoutRate} onChange={(event) => setOptions({...options, dropoutRate: Number(event.target.value)})} /></label>
        <label>Seed<input type="number" min="0" max="999999999" value={options.randomSeed} onChange={(event) => setOptions({...options, randomSeed: Number(event.target.value)})} /></label>
      </div>
      <button type="button" onClick={() => void onTrain()} disabled={busy || !summary.canTrain}>{busy ? 'Working...' : 'Train model'}</button>
      <button type="button" className="secondary" onClick={() => void onRefreshPreferences()} disabled={busy}>Refresh preferences</button>
      <button type="button" className="secondary" onClick={() => void onLoadModel()} disabled={busy}>Load saved model</button>
      <p className="muted">{status}</p>
      {!summary.canTrain && <p className="error-text">Needs at least one liked and one unliked embedded track.</p>}
      <TrainingCurve history={lossHistory} />
      {activeEvaluation && (
        <div className="training-evaluation">
          <div className="training-evaluation-header">
            <strong>Model errors</strong>
            <div className="evaluation-toggle">
              <button type="button" className={evaluationSplit === 'train' ? '' : 'secondary'} onClick={() => setEvaluationSplit('train')}>Train</button>
              <button type="button" className={evaluationSplit === 'validation' ? '' : 'secondary'} onClick={() => setEvaluationSplit('validation')} disabled={!evaluation?.validation?.count}>Val</button>
            </div>
          </div>
          <div className="training-metrics">
            <span>Accuracy <b>{formatMetric(activeEvaluation.accuracy)}</b></span>
            <span>ROC AUC <b>{formatMetric(activeEvaluation.rocAuc)}</b></span>
            <span>PR AUC <b>{formatMetric(activeEvaluation.prAuc)}</b></span>
            <span>Count <b>{activeEvaluation.count}</b></span>
          </div>
          <div className="mini-confusion" aria-label="Confusion matrix at threshold 0.5">
            <span>TP <b>{activeEvaluation.confusion.tp}</b></span>
            <span>FP <b>{activeEvaluation.confusion.fp}</b></span>
            <span>FN <b>{activeEvaluation.confusion.fn}</b></span>
            <span>TN <b>{activeEvaluation.confusion.tn}</b></span>
          </div>
        </div>
      )}
    </section>
  );
}

export function TrainingCurve({history}: {history: LossPoint[]}) {
  if (!history?.length) return null;
  const width = 340;
  const height = 150;
  const pad = {top: 12, right: 10, bottom: 24, left: 38};
  const values = history.flatMap((point) => [point.loss, point.valLoss]).filter((value): value is number => Number.isFinite(value));
  const minLoss = Math.min(...values, 0);
  const maxLoss = Math.max(...values, 1);
  const x = (epoch: number) => pad.left + ((epoch - 1) / Math.max(1, history.length - 1)) * (width - pad.left - pad.right);
  const y = (loss: number) => height - pad.bottom - ((loss - minLoss) / Math.max(0.000001, maxLoss - minLoss)) * (height - pad.top - pad.bottom);
  const linePath = (key: 'loss' | 'valLoss') => history
    .filter((point) => Number.isFinite(point[key]))
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(point.epoch).toFixed(1)} ${y(Number(point[key])).toFixed(1)}`)
    .join(' ');
  return (
    <div className="training-curve">
      <div className="curve-legend"><span><i className="train" /> train loss</span><span><i className="val" /> val loss</span></div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Training and validation loss curve">
        <line x1={pad.left} y1={height - pad.bottom} x2={width - pad.right} y2={height - pad.bottom} />
        <line x1={pad.left} y1={pad.top} x2={pad.left} y2={height - pad.bottom} />
        <text x="3" y={pad.top + 4}>{maxLoss.toFixed(2)}</text>
        <text x="3" y={height - pad.bottom}>{minLoss.toFixed(2)}</text>
        <text x={pad.left} y={height - 5}>1</text>
        <text x={width - pad.right - 24} y={height - 5}>{history.at(-1)?.epoch}</text>
        <path className="train-loss" d={linePath('loss')} />
        <path className="val-loss" d={linePath('valLoss')} />
      </svg>
    </div>
  );
}

export function ArtistFavoritesPanel({artists, onPreference, onSelect, modelAvailable, onShowLoveMobile, onShowLikedTrucks, onTrain, trainingBusy}: {
  artists: ArtistSummary[];
  onPreference: (point: PointLike, value: PreferenceValue) => void;
  onSelect: (point: PointLike) => void;
  modelAvailable: boolean;
  onShowLoveMobile: (loveMobile: LoveMobile) => void;
  onShowLikedTrucks: () => void;
  onTrain: () => void;
  trainingBusy: boolean;
}) {
  const [filter, setFilter] = useState(modelAvailable ? 'likely' : 'liked');
  const modelJustAppeared = useRef(false);
  useEffect(() => {
    if (modelAvailable && !modelJustAppeared.current) {
      modelJustAppeared.current = true;
      setFilter('likely');
    }
  }, [modelAvailable]);
  const visibleArtists = artists.filter((artist) => {
    if (filter === 'likely') return artist.likeScore > 0;
    if (filter === 'unliked') return artist.unlikeScore > 0;
    if (filter === 'liked') return artist.artistPreference === 'up';
    if (filter === 'manual') return Boolean(artist.artistPreference);
    return true;
  });
  const showTrainingEmptyState = filter === 'likely' && visibleArtists.length === 0 && !modelAvailable;
  return (
    <section className="panel artist-favorites-panel">
      <div className="panel-title-row">
        <h2>Artist favorites</h2>
        <button type="button" className="secondary truck-heart-button" aria-label="Show loved trucks" onClick={onShowLikedTrucks} title="Show the love mobiles of liked and likely-liked acts">
          <Heart size={16} aria-hidden="true" />
          <Truck size={16} aria-hidden="true" />
          <span>View</span>
        </button>
      </div>
      <p className="muted">Rank artists by actual and predicted song preferences, then mark artists liked or unliked.</p>
      <select value={filter} onChange={(event) => setFilter(event.target.value)}>
        <option value="all">All artists</option>
        <option value="liked">Liked</option>
        <option value="likely">Likely liked</option>
        <option value="unliked">Likely unliked</option>
        <option value="manual">Manually marked</option>
      </select>
      <div className="artist-favorites-list">
        {visibleArtists.map((artist) => (
          <article className="artist-favorite-row" key={artist.key}>
            <div className="artist-favorite-header">
              <button type="button" className="artist-title" onClick={() => onSelect(artist.point)}>{artist.name}</button>
              <div className="artist-favorite-actions">
                <button type="button" className={`secondary thumb-button thumb-up ${artist.artistPreference === 'up' ? 'active' : ''}`} onClick={() => onPreference(artist.point, 'up')} aria-pressed={artist.artistPreference === 'up'}><ThumbsUp size={18} aria-hidden="true" /></button>
                <button type="button" className={`secondary thumb-button thumb-down ${artist.artistPreference === 'down' ? 'active' : ''}`} onClick={() => onPreference(artist.point, 'down')} aria-pressed={artist.artistPreference === 'down'}><ThumbsDown size={18} aria-hidden="true" /></button>
              </div>
            </div>
            {artist.loveMobiles.length > 0 && (
              <div className="artist-love-mobiles" aria-label="Love mobiles">
                {artist.loveMobiles.map((loveMobile) => {
                  const setRange = artistSetRange(loveMobile);
                  const range = setRange || parseTimeRange(loveMobile.time);
                  return (
                    <button type="button" className="love-mobile-chip" key={loveMobile.uuid ?? `${loveMobile.number ?? 'lm'}-${loveMobile.name ?? ''}`} onClick={() => onShowLoveMobile(loveMobile)} title={loveMobile.name || loveMobile.title} aria-label={`Love mobile ${truckLabel(loveMobile)} info`}>
                      <Truck size={16} aria-hidden="true" />
                      <span className="love-mobile-chip-number">#{truckNumber(loveMobile)}</span>
                      {setRange
                        ? <span className="time-shield" aria-label="Set time">{setRange.start}–{setRange.end}</span>
                        : range && <span className="love-mobile-chip-time">{range.start}–{range.end}</span>}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="artist-score-grid">
              <span>Like <b>{artist.likeScore.toFixed(2)}</b></span>
              <span className="artist-score-unlike">Unlike <b>{artist.unlikeScore.toFixed(2)}</b></span>
              <span>Pred +{artist.predictedUp} / -{artist.predictedDown}</span>
              <span>{artist.trackCount} songs</span>
            </div>
          </article>
        ))}
      </div>
      {!visibleArtists.length && (
        showTrainingEmptyState ? (
          <div className="artist-favorites-empty">
            <p>No likely-liked artists yet. The preference model has not been trained in this browser, so there are no predicted favorites to show.</p>
            <button type="button" onClick={onTrain} disabled={trainingBusy}>{trainingBusy ? 'Working...' : 'Train model'}</button>
          </div>
        ) : (
          <p className="muted">No artists match this filter.</p>
        )
      )}
    </section>
  );
}

export function TrackRow({track, active, onSelect}: {track: UserTrack; active: boolean; onSelect: () => void}) {
  return (
    <button type="button" className={`track-row ${active ? 'active' : ''}`} onClick={onSelect}>
      <span className="track-star" aria-hidden="true"><Star size={18} /></span>
      <strong>{track.title || track.source_url}</strong>
      <span>{track.source_type} · {track.status}</span>
      {track.last_error && <small>{track.last_error}</small>}
    </button>
  );
}

export function UsernameGate({draftUsername, setDraftUsername, saveUsername, error}: {
  draftUsername: string;
  setDraftUsername: (value: string) => void;
  saveUsername: (event: React.FormEvent<HTMLFormElement>) => void;
  error: string;
}) {
  return (
    <main className="gate">
      <form onSubmit={saveUsername} className="gate-card">
        <p className="eyebrow">Public username</p>
        <h1>Choose a username</h1>
        <p>This is public for now. Anyone using the same username can see that username’s submitted songs.</p>
        <input value={draftUsername} onChange={(event) => setDraftUsername(event.target.value)} placeholder="e.g. nina-zurich" required />
        <button type="submit">Enter visualizer</button>
        {error && <p className="error-text">{error}</p>}
      </form>
    </main>
  );
}

function formatMetric(value: number | null | undefined): string {
  return value === null || value === undefined ? 'n/a' : Number(value).toFixed(3);
}
