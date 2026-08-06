import React from 'react';
import type {LayoutOptions} from '../layoutOptions';

type LayoutModalProps = {
  layoutOptions: LayoutOptions;
  setLayoutOptions: React.Dispatch<React.SetStateAction<LayoutOptions>>;
  recomputeLayout: (event: React.FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
};

function updateLayoutOption(setLayoutOptions: React.Dispatch<React.SetStateAction<LayoutOptions>>, key: keyof LayoutOptions, value: string | boolean) {
  setLayoutOptions((existing) => ({...existing, [key]: value}));
}

export function LayoutModal({layoutOptions, setLayoutOptions, recomputeLayout, onClose}: LayoutModalProps) {
  const pcaEnabled = Boolean(layoutOptions.pcaEnabled);
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="layout-modal" role="dialog" aria-modal="true" aria-labelledby="layout-title">
        <div className="modal-header">
          <div>
            <p className="eyebrow">Projection pipeline</p>
            <h2 id="layout-title">Map layout</h2>
            <p>Configure the optional PCA preprocessing stage, then choose what t-SNE and clustering consume.</p>
          </div>
          <button type="button" className="secondary" onClick={onClose}>Close</button>
        </div>
        <form className="layout-controls" onSubmit={recomputeLayout}>
          <details open>
            <summary>PCA preprocessing</summary>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={pcaEnabled}
                onChange={(event) => setLayoutOptions((existing) => ({
                  ...existing,
                  pcaEnabled: event.target.checked,
                  tsneInput: event.target.checked ? existing.tsneInput : 'raw',
                  clusterInput: event.target.checked ? existing.clusterInput : 'raw',
                }))}
              />
              Enable PCA stage
            </label>
            {pcaEnabled && (
              <label>
                PCA components
                <input type="number" min="1" value={layoutOptions.pcaComponents} onChange={(event) => updateLayoutOption(setLayoutOptions, 'pcaComponents', event.target.value)} />
              </label>
            )}
          </details>

          <details open>
            <summary>t-SNE projection</summary>
            <label>
              Input vectors
              <select disabled={!pcaEnabled} value={pcaEnabled ? layoutOptions.tsneInput : 'raw'} onChange={(event) => updateLayoutOption(setLayoutOptions, 'tsneInput', event.target.value)}>
                <option value="raw">Raw embeddings</option>
                <option value="pca">PCA output</option>
              </select>
            </label>
            {!pcaEnabled && <p className="hint">Enable PCA preprocessing to use PCA output for t-SNE.</p>}
            <label>
              Perplexity
              <input type="number" min="0.1" step="0.1" value={layoutOptions.tsnePerplexity} onChange={(event) => updateLayoutOption(setLayoutOptions, 'tsnePerplexity', event.target.value)} placeholder="auto" />
            </label>
            <label>
              Learning rate
              <input value={layoutOptions.tsneLearningRate} onChange={(event) => updateLayoutOption(setLayoutOptions, 'tsneLearningRate', event.target.value)} placeholder="auto" />
            </label>
            <label>
              Distance function
              <select value={layoutOptions.tsneMetric} onChange={(event) => updateLayoutOption(setLayoutOptions, 'tsneMetric', event.target.value)}>
                <option value="cosine">Cosine</option>
                <option value="euclidean">Euclidean</option>
                <option value="manhattan">Manhattan</option>
              </select>
            </label>
          </details>

          <details>
            <summary>Spectral clustering</summary>
            <label>
              Input vectors
              <select disabled={!pcaEnabled} value={pcaEnabled ? layoutOptions.clusterInput : 'raw'} onChange={(event) => updateLayoutOption(setLayoutOptions, 'clusterInput', event.target.value)}>
                <option value="raw">Raw embeddings</option>
                <option value="pca">PCA output</option>
              </select>
            </label>
            {!pcaEnabled && <p className="hint">Enable PCA preprocessing to use PCA output for clustering.</p>}
            <label>
              Clusters
              <input type="number" min="1" value={layoutOptions.clusterCount} onChange={(event) => updateLayoutOption(setLayoutOptions, 'clusterCount', event.target.value)} placeholder="auto" />
            </label>
          </details>

          <details>
            <summary>Graph links</summary>
            <label>
              Similarity metric
              <select value={layoutOptions.similarityMetric} onChange={(event) => updateLayoutOption(setLayoutOptions, 'similarityMetric', event.target.value)}>
                <option value="cosine">Cosine similarity</option>
                <option value="euclidean">Euclidean distance</option>
              </select>
            </label>
            <p className="hint">Similarity links are computed on raw embeddings, not PCA output.</p>
            <label>
              Similar tracks to show
              <input type="number" min="1" max="20" value={layoutOptions.linkedTrackCount} onChange={(event) => updateLayoutOption(setLayoutOptions, 'linkedTrackCount', event.target.value)} />
            </label>
            <label>
              Minimum similarity
              <input type="number" min="-1" max="1" step="0.01" value={layoutOptions.similarityThreshold} onChange={(event) => updateLayoutOption(setLayoutOptions, 'similarityThreshold', event.target.value)} placeholder="none" />
            </label>
          </details>

          <details>
            <summary>Run settings</summary>
            <label>
              Random seed
              <input type="number" value={layoutOptions.randomState} onChange={(event) => updateLayoutOption(setLayoutOptions, 'randomState', event.target.value)} />
            </label>
          </details>

          <div className="modal-actions">
            <button type="submit">Recompute t-SNE map</button>
            <button type="button" className="secondary" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </section>
    </div>
  );
}

export function HelpModal({onClose}: {onClose: () => void}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="layout-modal help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title">
        <div className="modal-header">
          <div>
            <p className="eyebrow">Help</p>
            <h2 id="help-title">Using the map</h2>
          </div>
          <button type="button" className="secondary" onClick={onClose}>Close</button>
        </div>
        <div className="help-content">
          <h3>Navigate</h3>
          <p>Drag the map to pan. Scroll or pinch to zoom. Double-click the canvas to reset the zoom.</p>
          <p>Use the search box to find artists, songs, URLs, or other visible metadata. Use the Tracks and Artists buttons to hide or show each type.</p>

          <h3>Select And Listen</h3>
          <p>Click a song or artist to focus it. The selected item stays highlighted and unrelated points dim so you can see its context.</p>
          <p>When a song is selected, playback appears below the canvas. Reset selection clears the focus but keeps the current song playing.</p>
          <p>The toolbar arrows undo and redo selection history.</p>

          <h3>Similarity And Clusters</h3>
          <p>When you select a song, linked songs show similar tracks. Hover an edge to see similarity details. In song tooltips, the play button selects a similar song and the fast-forward button jumps to a random song.</p>
          <p>Use the cluster dropdown to highlight one cluster. The Selection panel can also highlight the selected item’s cluster.</p>

          <h3>How It Was Made</h3>
          <p>Each track is converted into an audio embedding: a numeric representation of how the model hears the sound.</p>
          <p>The layout can optionally run PCA first, which compresses the embeddings into fewer dimensions while preserving broad structure.</p>
          <p>t-SNE then projects the embeddings into two dimensions for this map. Spectral clustering assigns cluster IDs, which drive the cluster colors.</p>
          <p>The layout settings panel lets you tune PCA, t-SNE, clustering, and similarity-link behavior.</p>
        </div>
      </section>
    </div>
  );
}

export function SavedModelPrompt({onLoad, onClose, busy}: {onLoad: () => void; onClose: () => void; busy: boolean}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="layout-modal saved-model-modal" role="dialog" aria-modal="true" aria-labelledby="saved-model-title">
        <div className="modal-header">
          <div>
            <p className="eyebrow">Preference model</p>
            <h2 id="saved-model-title">Saved model detected</h2>
            <p>Saved preference model was detected. Would you like to load it now?</p>
          </div>
          <button type="button" className="secondary" onClick={onClose}>Not now</button>
        </div>
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose}>Dismiss</button>
          <button type="button" onClick={onLoad} disabled={busy}>{busy ? 'Loading...' : 'Load saved model'}</button>
        </div>
      </section>
    </div>
  );
}

export function TrainModelPrompt({count, onDismiss, onTrain}: {count: number; onDismiss: () => void; onTrain: () => void}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onDismiss(); }}>
      <section className="layout-modal train-model-modal" role="dialog" aria-modal="true" aria-labelledby="train-model-title">
        <div className="modal-header">
          <div>
            <p className="eyebrow">Preference model</p>
            <h2 id="train-model-title">Time to train a new model</h2>
            <p>You have marked {count} preferences. Train a model now to color songs by predicted preference.</p>
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onDismiss}>Dismiss</button>
          <button type="button" onClick={onTrain}>Train model</button>
        </div>
      </section>
    </div>
  );
}
