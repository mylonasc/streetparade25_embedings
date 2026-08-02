import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as d3 from 'd3';
import './styles.css';

const API_BASE_URL = resolveApiBaseUrl();
const USERNAME_KEY = 'streetparade.visualizer.username';
const MARKS_KEY = 'streetparade.visualizer.marked';
const DEFAULT_LAYOUT_OPTIONS = {
  pcaEnabled: false,
  pcaComponents: '10',
  tsneInput: 'raw',
  clusterCount: '',
  clusterInput: 'raw',
  tsnePerplexity: '',
  tsneLearningRate: 'auto',
  tsneMetric: 'cosine',
  randomState: '42',
  linkedTrackCount: '5',
  similarityThreshold: '0.3',
  similarityMetric: 'cosine',
};

function resolveApiBaseUrl() {
  const configured = import.meta.env.VITE_API_BASE_URL;
  const browserHost = window.location.hostname;
  if (configured && !(isLoopbackUrl(configured) && !isLoopbackHost(browserHost))) {
    return configured.replace(/\/$/, '');
  }
  return `${window.location.protocol}//${browserHost}:8000`;
}

function isLoopbackUrl(value) {
  try {
    return isLoopbackHost(new URL(value).hostname);
  } catch {
    return false;
  }
}

function isLoopbackHost(hostname) {
  return ['localhost', '127.0.0.1', '::1'].includes(hostname);
}

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {'Content-Type': 'application/json', ...(options.headers || {})},
    ...options,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(data?.detail || response.statusText);
  return data;
}

function readMarks() {
  try {
    return new Set(JSON.parse(localStorage.getItem(MARKS_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

function App() {
  const [username, setUsername] = useState(localStorage.getItem(USERNAME_KEY) || '');
  const [draftUsername, setDraftUsername] = useState(username);
  const [points, setPoints] = useState([]);
  const [userTracks, setUserTracks] = useState([]);
  const [selected, setSelected] = useState(null);
  const [playbackPoint, setPlaybackPoint] = useState(null);
  const [selectionUndoStack, setSelectionUndoStack] = useState([]);
  const [selectionRedoStack, setSelectionRedoStack] = useState([]);
  const [marks, setMarks] = useState(readMarks);
  const [url, setUrl] = useState('');
  const [jobs, setJobs] = useState([]);
  const [layoutJob, setLayoutJob] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [shareUrl, setShareUrl] = useState('');
  const [stats, setStats] = useState({point_count: 0, base_point_count: 0, artist_point_count: 0, user_point_count: 0});
  const [layoutOptions, setLayoutOptions] = useState(DEFAULT_LAYOUT_OPTIONS);
  const [showLayoutModal, setShowLayoutModal] = useState(false);
  const [linkedTrackIds, setLinkedTrackIds] = useState(new Set());
  const [similarityEdges, setSimilarityEdges] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCluster, setSelectedCluster] = useState(null);
  const [showArtists, setShowArtists] = useState(true);
  const [showSongs, setShowSongs] = useState(true);
  const [showHelp, setShowHelp] = useState(false);
  const [focusRequest, setFocusRequest] = useState(null);

  async function loadAll(activeUsername = username) {
    if (!activeUsername) return;
    const [viz, tracks] = await Promise.all([
      request(`/visualization?username=${encodeURIComponent(activeUsername)}`),
      request(`/users/${encodeURIComponent(activeUsername)}/tracks`),
    ]);
    setPoints(viz.points || []);
    setStats({
      point_count: viz.point_count || 0,
      base_point_count: viz.base_point_count || 0,
      artist_point_count: viz.artist_point_count || 0,
      user_point_count: viz.user_point_count || 0,
    });
    setUserTracks(tracks || []);
  }

  async function saveUsername(event) {
    event.preventDefault();
    setError('');
    try {
      const user = await request('/users', {method: 'POST', body: JSON.stringify({username: draftUsername})});
      localStorage.setItem(USERNAME_KEY, user.username);
      setUsername(user.username);
      await loadAll(user.username);
    } catch (err) {
      setError(err.message);
    }
  }

  async function submitTrack(event) {
    event.preventDefault();
    setError('');
    setMessage('');
    try {
      const result = await request(`/users/${encodeURIComponent(username)}/tracks`, {method: 'POST', body: JSON.stringify({url})});
      setJobs((existing) => [result.job, ...existing]);
      setUrl('');
      setMessage(`Queued ${result.track.source_type} analysis`);
      await loadAll();
    } catch (err) {
      setError(err.message);
    }
  }

  async function recomputeLayout(event) {
    event.preventDefault();
    setError('');
    try {
      const job = await request('/layouts/recompute', {method: 'POST', body: JSON.stringify(layoutPayload(username, layoutOptions))});
      setLayoutJob(job);
      setMessage(`Queued layout job ${job.id.slice(0, 8)}`);
      setShowLayoutModal(false);
    } catch (err) {
      setError(err.message);
    }
  }

  async function createShare() {
    setError('');
    try {
      const share = await request('/shares', {
        method: 'POST',
        body: JSON.stringify({username, marked: Array.from(marks)}),
      });
      setShareUrl(`${window.location.origin}${window.location.pathname}?share=${share.token}`);
    } catch (err) {
      setError(err.message);
    }
  }

  function toggleMark(point) {
    const key = `${point.kind}:${point.metadata?.artist_name || point.metadata?.artist || point.label}`;
    const next = new Set(marks);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    localStorage.setItem(MARKS_KEY, JSON.stringify(Array.from(next)));
    setMarks(next);
  }

  function resolveSelection(point) {
    return points.find((candidate) => candidate.id === point?.id) || point;
  }

  function selectPoint(point, options = {}) {
    if (!point || selected?.id === point.id) return;
    if (selected) setSelectionUndoStack((stack) => [...stack, selected].slice(-50));
    setSelectionRedoStack([]);
    setSelected(point);
    setPlaybackPoint(point);
    if (options.focus) setFocusRequest({pointId: point.id, nonce: Date.now()});
  }

  function resetSelection() {
    if (!selected) return;
    setSelectionUndoStack((stack) => [...stack, selected].slice(-50));
    setSelectionRedoStack([]);
    setSelected(null);
  }

  function selectRandomSong(focus = false) {
    const songs = points.filter((point) => point.kind === 'track' || point.kind === 'user_track');
    if (!songs.length) return;
    const candidates = selected ? songs.filter((point) => point.id !== selected.id) : songs;
    selectPoint(candidates[Math.floor(Math.random() * candidates.length)] || songs[0], {focus});
  }

  function undoSelection() {
    if (!selectionUndoStack.length) return;
    const previous = resolveSelection(selectionUndoStack[selectionUndoStack.length - 1]);
    setSelectionUndoStack((stack) => stack.slice(0, -1));
    if (selected) setSelectionRedoStack((stack) => [...stack, selected].slice(-50));
    setSelected(previous);
    setPlaybackPoint(previous);
  }

  function redoSelection() {
    if (!selectionRedoStack.length) return;
    const next = resolveSelection(selectionRedoStack[selectionRedoStack.length - 1]);
    setSelectionRedoStack((stack) => stack.slice(0, -1));
    if (selected) setSelectionUndoStack((stack) => [...stack, selected].slice(-50));
    setSelected(next);
    setPlaybackPoint(next);
  }

  function selectUserTrack(track) {
    const pointId = `user-track-${track.id}`;
    const point = points.find((candidate) => candidate.id === pointId) || {
      id: pointId,
      kind: 'user_track',
      label: track.title || track.source_url,
      x: track.x || 0,
      y: track.y || 0,
      cluster: -1,
      metadata: track,
    };
    selectPoint(point);
  }

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('share');
    if (!token) return;
    request(`/shares/${token}`).then((share) => {
      const payload = share.payload || {};
      if (payload.username) {
        localStorage.setItem(USERNAME_KEY, payload.username);
        setUsername(payload.username);
        setDraftUsername(payload.username);
      }
      if (Array.isArray(payload.marked)) {
        const next = new Set(payload.marked);
        localStorage.setItem(MARKS_KEY, JSON.stringify(Array.from(next)));
        setMarks(next);
      }
    }).catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    if (username) loadAll().catch((err) => setError(err.message));
  }, [username]);

  useEffect(() => {
    function handleKeyDown(event) {
      if (!event.ctrlKey || event.metaKey || event.altKey || isEditingTarget(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === 'z') {
        event.preventDefault();
        undoSelection();
      }
      if (key === 'r') {
        event.preventDefault();
        redoSelection();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selected, selectionUndoStack, selectionRedoStack, points]);

  useEffect(() => {
    let cancelled = false;

    async function loadLinkedTracks() {
      const links = linksForSelection(selected, points);
      if (!selected || selected.kind === 'artist' || !selectedVectorId(selected)) {
        setSimilarityEdges(links);
        setLinkedTrackIds(new Set(links.flatMap((edge) => [edge.source, edge.target])));
        return;
      }
      try {
        const count = optionalNumber(layoutOptions.linkedTrackCount) || 5;
        const threshold = optionalNumber(layoutOptions.similarityThreshold);
        const payload = {vector_ids: [selectedVectorId(selected)], n_results: Math.min(100, count + 8), metric: layoutOptions.similarityMetric};
        const data = await request('/similarity/track-embeddings', {method: 'POST', body: JSON.stringify(payload)});
        if (cancelled) return;
        const byTrackId = pointsByTrackId(points);
        const edges = (data.results || [])
          .filter((item) => item.vector_id !== selectedVectorId(selected))
          .filter((item) => threshold === null || (item.similarity !== null && item.similarity >= threshold))
          .map((item) => {
            const trackId = item.track_embedding?.track_id || item.metadata?.track_id;
            const target = byTrackId.get(String(trackId));
            if (!target || target.id === selected.id) return null;
            return {source: selected.id, target: target.id, similarity: item.similarity, distance: item.distance, metric: layoutOptions.similarityMetric};
          })
          .filter(Boolean)
          .slice(0, count);
        setSimilarityEdges(edges);
        setLinkedTrackIds(new Set(edges.flatMap((edge) => [edge.source, edge.target])));
      } catch (err) {
        if (!cancelled) {
          setSimilarityEdges(links);
          setLinkedTrackIds(new Set(links.flatMap((edge) => [edge.source, edge.target])));
        }
      }
    }

    loadLinkedTracks();
    return () => { cancelled = true; };
  }, [selected, points, layoutOptions.linkedTrackCount, layoutOptions.similarityThreshold, layoutOptions.similarityMetric]);

  useEffect(() => {
    if (!username) return;
    const timer = setInterval(async () => {
      try {
        const refreshedJobs = await Promise.all(jobs.filter((job) => ['queued', 'running'].includes(job.status)).map((job) => request(`/user-track-jobs/${job.id}`)));
        if (refreshedJobs.length) setJobs((old) => old.map((job) => refreshedJobs.find((item) => item.id === job.id) || job));
        if (refreshedJobs.some((job) => ['completed', 'failed'].includes(job.status))) await loadAll();
        if (layoutJob && ['queued', 'running'].includes(layoutJob.status)) {
          const next = await request(`/layout-jobs/${layoutJob.id}`);
          setLayoutJob(next);
          if (next.status === 'completed') await loadAll();
        }
      } catch {
        // Polling should not disrupt interaction.
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [username, jobs, layoutJob]);

  const searchIndex = useMemo(() => buildSearchIndex(points), [points]);
  const visibleSearchResults = useMemo(() => searchResults(points, searchIndex, searchQuery), [points, searchIndex, searchQuery]);
  const searchMatchIds = useMemo(() => new Set(visibleSearchResults.map((point) => point.id)), [visibleSearchResults]);
  const clusterOptions = useMemo(
    () => Array.from(new Set(points.map((point) => point.cluster).filter((cluster) => cluster !== null && cluster !== undefined))).sort((a, b) => Number(a) - Number(b)),
    [points],
  );

  if (!username) {
    return <UsernameGate draftUsername={draftUsername} setDraftUsername={setDraftUsername} saveUsername={saveUsername} error={error} />;
  }

  return (
    <main className="shell">
      {(message || error) && <section className={`notice ${error ? 'error' : 'success'}`}>{error || message}</section>}

      <section className="workspace">
        <section className="main-column">
          <section className="map-card">
            <div className="map-search">
              <div className="search-input-row">
                <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search artists, tracks, URLs..." />
                {searchQuery && <button type="button" className="secondary icon-button" aria-label="Clear search" onClick={() => setSearchQuery('')}>×</button>}
              </div>
              <div className="cluster-select-row">
                <select value={selectedCluster ?? ''} onChange={(event) => setSelectedCluster(event.target.value === '' ? null : Number(event.target.value))}>
                  <option value="">All clusters</option>
                  {clusterOptions.map((cluster) => <option key={cluster} value={cluster}>Cluster {cluster}</option>)}
                </select>
                {selectedCluster !== null && <button type="button" className="secondary" onClick={() => setSelectedCluster(null)}>Clear</button>}
              </div>
              {searchQuery.trim() && (
                <div className="search-results">
                  {visibleSearchResults.slice(0, 8).map((point) => <button type="button" key={point.id} onClick={() => selectPoint(point)}>{point.label}</button>)}
                  {!visibleSearchResults.length && <span>No matches</span>}
                </div>
              )}
            </div>
            <div className="map-toolbar">
              <button type="button" className="secondary" onClick={resetSelection} disabled={!selected}>Reset selection</button>
              <button type="button" className="secondary icon-button" aria-label="Undo selection" onClick={undoSelection} disabled={!selectionUndoStack.length}>↶</button>
              <button type="button" className="secondary icon-button" aria-label="Redo selection" onClick={redoSelection} disabled={!selectionRedoStack.length}>↷</button>
              <button type="button" className="secondary icon-button" aria-label="Toggle preference mark" onClick={() => selected && toggleMark(selected)} disabled={!selected}>★</button>
              <button type="button" className={`secondary toggle-button ${showSongs ? 'active' : ''}`} onClick={() => setShowSongs((value) => !value)}>Songs</button>
              <button type="button" className={`secondary toggle-button ${showArtists ? 'active' : ''}`} onClick={() => setShowArtists((value) => !value)}>Artists</button>
              <button type="button" className="secondary icon-button" aria-label="Help" onClick={() => setShowHelp(true)}>?</button>
            </div>
            {stats.base_point_count === 0 && (
              <div className="empty-warning">
                No Street Parade vectors loaded. Check that the API can access the Chroma vector store, especially `./chroma` when using Docker.
              </div>
            )}
            <Visualizer points={points} selected={selected} setSelected={selectPoint} marks={marks} edges={similarityEdges} linkedPointIds={linkedTrackIds} hasSearch={Boolean(searchQuery.trim())} searchMatchIds={searchMatchIds} selectedCluster={selectedCluster} showArtists={showArtists} showSongs={showSongs} focusRequest={focusRequest} onPlaySimilar={() => similarityEdges[0]?.target && selectPoint(points.find((point) => point.id === similarityEdges[0].target), {focus: true})} onRandomSong={() => selectRandomSong(true)} />
          </section>

          <section className="panel selection-panel">
            <h2>Selection</h2>
            {(selected || playbackPoint) ? <Selection point={selected || playbackPoint} onMark={() => toggleMark(selected || playbackPoint)} onUndo={undoSelection} onRedo={redoSelection} canUndo={selectionUndoStack.length > 0} canRedo={selectionRedoStack.length > 0} onSelectCluster={() => setSelectedCluster((selected || playbackPoint).cluster)} isFocused={Boolean(selected)} /> : <p className="muted">Click a point on the map.</p>}
          </section>
        </section>

        <aside className="side">
          <form className="panel" onSubmit={submitTrack}>
            <h2>Add a track</h2>
            <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="SoundCloud or YouTube URL" required />
            <button type="submit">Analyze Track</button>
          </form>

          <section className="panel">
            <h2>My songs</h2>
            <div className="song-list">
              {userTracks.map((track) => (
                <TrackRow
                  key={track.id}
                  track={track}
                  active={selected?.id === `user-track-${track.id}`}
                  onSelect={() => selectUserTrack(track)}
                />
              ))}
            </div>
            {!userTracks.length && <p className="muted">No submitted songs yet.</p>}
          </section>

          <section className="panel actions">
            <h2>Map layout</h2>
            <button onClick={() => setShowLayoutModal(true)}>Configure and recompute</button>
            {layoutJob && <p className="muted">Layout job: {layoutJob.status}</p>}
            <button className="secondary" onClick={createShare}>Create share link</button>
            {shareUrl && <input readOnly value={shareUrl} onFocus={(event) => event.target.select()} />}
          </section>
        </aside>
      </section>
      {showLayoutModal && (
        <LayoutModal
          layoutOptions={layoutOptions}
          setLayoutOptions={setLayoutOptions}
          recomputeLayout={recomputeLayout}
          onClose={() => setShowLayoutModal(false)}
        />
      )}
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
    </main>
  );
}

function updateLayoutOption(setLayoutOptions, key, value) {
  setLayoutOptions((existing) => ({...existing, [key]: value}));
}

function layoutPayload(username, options) {
  const pcaEnabled = Boolean(options.pcaEnabled);
  return {
    username,
    pca_enabled: pcaEnabled,
    pca_components: optionalNumber(options.pcaComponents) || 10,
    tsne_input: pcaEnabled ? options.tsneInput : 'raw',
    cluster_count: optionalNumber(options.clusterCount),
    cluster_input: pcaEnabled ? options.clusterInput : 'raw',
    tsne_perplexity: optionalNumber(options.tsnePerplexity),
    tsne_learning_rate: optionalLearningRate(options.tsneLearningRate),
    tsne_metric: options.tsneMetric,
    random_state: Number(options.randomState) || 42,
  };
}

function optionalNumber(value) {
  if (String(value).trim() === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function optionalLearningRate(value) {
  const cleaned = String(value).trim();
  if (!cleaned || cleaned.toLowerCase() === 'auto') return 'auto';
  const numeric = Number(cleaned);
  return Number.isFinite(numeric) ? numeric : 'auto';
}

function isEditingTarget(target) {
  const tagName = target?.tagName?.toLowerCase();
  return target?.isContentEditable || tagName === 'input' || tagName === 'textarea' || tagName === 'select';
}

function selectedVectorId(point) {
  return point?.metadata?.vector_id || null;
}

function pointsByTrackId(points) {
  const map = new Map();
  for (const point of points) {
    const trackId = point.metadata?.track_id;
    if (trackId !== undefined && trackId !== null) map.set(String(trackId), point);
  }
  return map;
}

function linksForSelection(selected, points) {
  if (!selected || selected.kind !== 'artist') return [];
  const byTrackId = pointsByTrackId(points);
  return (selected.metadata?.tracks || [])
    .map((track) => byTrackId.get(String(track.track_id)))
    .filter(Boolean)
    .map((trackPoint) => ({source: selected.id, target: trackPoint.id, similarity: null}));
}

function pointSearchText(point) {
  const metadata = point.metadata || {};
  const flat = Object.entries(metadata)
    .filter(([, value]) => value !== null && value !== undefined && typeof value !== 'object')
    .map(([key, value]) => `${key} ${value}`)
    .join(' ');
  const artistTracks = (metadata.tracks || []).map((track) => `${track.title || ''} ${track.label || ''} ${track.url || ''}`).join(' ');
  return `${point.kind} ${point.label} ${flat} ${artistTracks}`.toLowerCase();
}

function buildSearchIndex(points) {
  return new Map(points.map((point) => [point.id, pointSearchText(point)]));
}

function searchResults(points, searchIndex, query) {
  const cleaned = query.trim().toLowerCase();
  if (!cleaned) return [];
  return points.filter((point) => searchIndex.get(point.id)?.includes(cleaned));
}

function pointTooltipHtml(point) {
  const metadata = point.metadata || {};
  if (point.kind === 'track' || point.kind === 'user_track') {
    const rows = [
      ['Artist', metadata.artist_name || metadata.artist || 'Unknown'],
      ['Song', metadata.title || point.label],
      ['Cluster', point.cluster],
    ];
    return `<strong>${escapeHtml(metadata.title || point.label)}</strong>${rows.map(([key, value]) => `<span>${escapeHtml(key)}: ${escapeHtml(value)}</span>`).join('')}<div class="tooltip-actions"><button type="button" data-tooltip-action="play-similar">▶</button><button type="button" data-tooltip-action="random-song">⏭</button></div>`;
  }
  const rows = [];
  if (metadata.artist_name || metadata.artist) rows.push(['Artist', metadata.artist_name || metadata.artist]);
  if (metadata.title) rows.push(['Title', metadata.title]);
  if (metadata.track_count) rows.push(['Tracks', metadata.track_count]);
  if (metadata.source_type) rows.push(['Source', metadata.source_type]);
  if (metadata.cluster !== undefined || point.cluster !== undefined) rows.push(['Cluster', point.cluster]);
  if (metadata.url || metadata.source_url) rows.push(['URL', metadata.url || metadata.source_url]);
  return `<strong>${escapeHtml(point.label)}</strong><span>${escapeHtml(point.kind)}</span>${rows.map(([key, value]) => `<span>${escapeHtml(key)}: ${escapeHtml(value)}</span>`).join('')}`;
}

function edgeTooltipHtml(edge, byId) {
  const source = byId.get(edge.source);
  const target = byId.get(edge.target);
  const rows = [
    ['From', source?.label || edge.source],
    ['To', target?.label || edge.target],
  ];
  if (edge.metric) rows.push(['Metric', edge.metric]);
  if (edge.similarity !== null && edge.similarity !== undefined) rows.push(['Similarity', Number(edge.similarity).toFixed(4)]);
  if (edge.distance !== null && edge.distance !== undefined) rows.push(['Distance', Number(edge.distance).toFixed(4)]);
  return `<strong>Similarity edge</strong>${rows.map(([key, value]) => `<span>${escapeHtml(key)}: ${escapeHtml(value)}</span>`).join('')}`;
}

function showTooltip(tooltip, event, html) {
  const container = tooltip.offsetParent?.getBoundingClientRect() || {left: 0, top: 0};
  tooltip.hidden = false;
  tooltip.innerHTML = html;
  tooltip.style.left = `${event.clientX - container.left + 14}px`;
  tooltip.style.top = `${event.clientY - container.top + 14}px`;
}

function roundedRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

function distanceToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function visibleMetadataEntries(metadata) {
  const hidden = new Set(['url', 'source_url', 'path', 'vector_id', 'embedding_model', 'embedding_backend', 'model_name']);
  return Object.entries(metadata)
    .filter(([key, value]) => !hidden.has(key) && value !== null && value !== undefined && typeof value !== 'object');
}

function modelSummary(metadata) {
  const model = metadata.embedding_model || metadata.model_name;
  const backend = metadata.embedding_backend;
  if (!model && !backend) return null;
  return [backend, model].filter(Boolean).join(' / ');
}

function LayoutModal({layoutOptions, setLayoutOptions, recomputeLayout, onClose}) {
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

function HelpModal({onClose}) {
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
          <p>Use the search box to find artists, songs, URLs, or other visible metadata. Use the Songs and Artists buttons to hide or show each type.</p>

          <h3>Select And Listen</h3>
          <p>Click a song or artist to focus it. The selected item stays highlighted and unrelated points dim so you can see its context.</p>
          <p>When a song is selected, playback appears below the canvas. Reset selection clears the focus but keeps the current song playing.</p>
          <p>The toolbar arrows undo and redo selection history. The star marks the selected song or artist as a preference.</p>

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

function UsernameGate({draftUsername, setDraftUsername, saveUsername, error}) {
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

function Visualizer({points, selected, setSelected, marks, edges, linkedPointIds, hasSearch, searchMatchIds, selectedCluster, showArtists, showSongs, focusRequest, onPlaySimilar, onRandomSong}) {
  const ref = useRef(null);
  const tooltipRef = useRef(null);
  const transformRef = useRef(d3.zoomIdentity);
  const handledFocusRef = useRef(null);

  useEffect(() => {
    if (!ref.current) return;
    const canvas = ref.current;
    const context = canvas.getContext('2d');
    const parent = canvas.parentElement;
    const bounds = parent.getBoundingClientRect();
    const parentStyle = window.getComputedStyle(parent);
    const horizontalPadding = parseFloat(parentStyle.paddingLeft) + parseFloat(parentStyle.paddingRight);
    const width = Math.max(280, bounds.width - horizontalPadding);
    const height = Math.max(520, Math.round(width * 0.62));
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    if (!points.length) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    const x = d3.scaleLinear().domain(d3.extent(points, (point) => point.x)).nice().range([36, width - 36]);
    const y = d3.scaleLinear().domain(d3.extent(points, (point) => point.y)).nice().range([height - 36, 36]);
    const color = d3.scaleOrdinal(d3.schemeTableau10.concat(d3.schemeSet3));
    const byId = new Map(points.map((point) => [point.id, point]));
    const isVisible = (point) => point && (point.kind === 'artist' ? showArtists : showSongs);
    const markerScale = (scale) => Math.max(0.45, 1 / Math.sqrt(Math.max(1, scale)));
    const symbol = d3.symbol().context(context);
    const screenPoint = (point) => [transformRef.current.applyX(x(point.x)), transformRef.current.applyY(y(point.y))];
    let hitPoints = [];
    let hitEdges = [];
    let quadtree = null;
    let frame = null;

    function pointState(point) {
      const isSelected = selected?.id === point.id;
      let alpha = 1;
      if (hasSearch && !searchMatchIds?.has(point.id)) alpha = Math.min(alpha, 0.22);
      if (selectedCluster !== null && point.cluster !== selectedCluster) alpha = Math.min(alpha, 0.18);
      if (selected?.id && !isSelected) alpha = Math.min(alpha, 0.24);
      return {
        isSelected,
        isMarked: isMarked(point, marks),
        isLinked: linkedPointIds?.has(point.id),
        isSearchMatch: hasSearch && searchMatchIds?.has(point.id),
        isClusterMatch: selectedCluster !== null && point.cluster === selectedCluster,
        alpha: isSelected ? 1 : alpha,
      };
    }

    function drawSymbol(point, state) {
      const [sx, sy] = screenPoint(point);
      const scale = markerScale(transformRef.current.k);
      const size = point.kind === 'user_track'
        ? state.isSelected ? 280 : 180
        : point.kind === 'artist'
          ? state.isSelected ? 180 : 120
          : state.isSelected ? 105 : 58;
      context.save();
      context.translate(sx * pixelRatio, sy * pixelRatio);
      context.scale(scale * pixelRatio, scale * pixelRatio);
      context.beginPath();
      symbol.type(point.kind === 'user_track' ? d3.symbolStar : point.kind === 'artist' ? d3.symbolDiamond : d3.symbolCircle).size(size)();
      context.globalAlpha = state.alpha;
      context.fillStyle = point.kind === 'user_track' ? '#ff5c35' : point.kind === 'artist' ? '#85f5c4' : color(point.cluster);
      context.fill();
      context.lineWidth = state.isSelected ? 4 : state.isLinked || state.isSearchMatch || state.isClusterMatch ? 3 : 1.2;
      context.strokeStyle = state.isSelected ? '#fff' : state.isSearchMatch || state.isClusterMatch ? '#ffd166' : state.isLinked || state.isMarked ? '#85f5c4' : 'rgba(255,255,255,0.85)';
      context.stroke();
      context.restore();
      return {point, x: sx, y: sy, radius: Math.max(8, Math.sqrt(size) * scale)};
    }

    function draw() {
      context.save();
      context.scale(pixelRatio, pixelRatio);
      context.clearRect(0, 0, width, height);
      context.fillStyle = 'rgba(255, 255, 255, 0.035)';
      roundedRect(context, 0, 0, width, height, 24);
      context.fill();
      context.restore();

      hitEdges = [];
      for (const edge of edges || []) {
        const source = byId.get(edge.source);
        const target = byId.get(edge.target);
        if (!isVisible(source) || !isVisible(target)) continue;
        if (!source || !target) continue;
        const [x1, y1] = screenPoint(source);
        const [x2, y2] = screenPoint(target);
        context.save();
        context.scale(pixelRatio, pixelRatio);
        context.beginPath();
        context.moveTo(x1, y1);
        context.lineTo(x2, y2);
        context.strokeStyle = '#85f5c4';
        context.globalAlpha = edge.similarity === null || edge.similarity === undefined ? 0.72 : Math.max(0.28, Math.min(0.9, edge.similarity));
        context.lineWidth = 2.4;
        context.lineCap = 'round';
        context.stroke();
        context.restore();
        hitEdges.push({edge, x1, y1, x2, y2});
      }

      hitPoints = points.filter(isVisible).map((point) => drawSymbol(point, pointState(point)));
      quadtree = d3.quadtree(hitPoints, (item) => item.x, (item) => item.y);
    }

    function scheduleDraw() {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        draw();
        frame = null;
      });
    }

    function pointerPosition(event) {
      const rect = canvas.getBoundingClientRect();
      return [event.clientX - rect.left, event.clientY - rect.top];
    }

    function nearestPoint(event) {
      if (!quadtree) return null;
      const [px, py] = pointerPosition(event);
      const candidate = quadtree.find(px, py, 18);
      if (!candidate) return null;
      return Math.hypot(candidate.x - px, candidate.y - py) <= candidate.radius + 6 ? candidate.point : null;
    }

    function nearestEdge(event) {
      const [px, py] = pointerPosition(event);
      return hitEdges.find((item) => distanceToSegment(px, py, item.x1, item.y1, item.x2, item.y2) <= 8)?.edge || null;
    }

    function handlePointerMove(event) {
      const point = nearestPoint(event);
      if (point) {
        canvas.style.cursor = 'pointer';
        showTooltip(tooltipRef.current, event, pointTooltipHtml(point));
        return;
      }
      const edge = nearestEdge(event);
      if (edge) {
        canvas.style.cursor = 'pointer';
        showTooltip(tooltipRef.current, event, edgeTooltipHtml(edge, byId));
        return;
      }
      canvas.style.cursor = 'grab';
      tooltipRef.current.hidden = true;
    }

    function handleClick(event) {
      const point = nearestPoint(event);
      if (point) setSelected(point);
    };

    function handleMouseLeave(event) {
      if (tooltipRef.current?.contains(event.relatedTarget)) return;
      tooltipRef.current.hidden = true;
    }

    function handleTooltipLeave() {
      tooltipRef.current.hidden = true;
    }

    function handleTooltipClick(event) {
      const action = event.target?.dataset?.tooltipAction;
      if (action === 'play-similar') onPlaySimilar?.();
      if (action === 'random-song') onRandomSong?.();
    }

    function showPointTooltip(point) {
      const [sx, sy] = screenPoint(point);
      const rect = canvas.getBoundingClientRect();
      showTooltip(tooltipRef.current, {clientX: rect.left + sx, clientY: rect.top + sy}, pointTooltipHtml(point));
    }

    const zoom = d3.zoom()
      .scaleExtent([0.45, 18])
      .on('zoom', (event) => {
        transformRef.current = event.transform;
        scheduleDraw();
      });
    const selection = d3.select(canvas);
    selection.call(zoom).on('dblclick.zoom', null);
    selection.on('dblclick', () => {
      transformRef.current = d3.zoomIdentity;
      selection.transition().duration(220).call(zoom.transform, d3.zoomIdentity);
    });
    selection.call(zoom.transform, transformRef.current);
    canvas.addEventListener('mousemove', handlePointerMove);
    canvas.addEventListener('click', handleClick);
    canvas.addEventListener('mouseleave', handleMouseLeave);
    tooltipRef.current.addEventListener('click', handleTooltipClick);
    tooltipRef.current.addEventListener('mouseleave', handleTooltipLeave);
    draw();
    if (focusRequest?.pointId && handledFocusRef.current !== focusRequest.nonce) {
      handledFocusRef.current = focusRequest.nonce;
      const focusPoint = byId.get(focusRequest.pointId);
      if (isVisible(focusPoint)) {
        const scale = transformRef.current.k || 1;
        const nextTransform = d3.zoomIdentity
          .translate(width / 2 - scale * x(focusPoint.x), height / 2 - scale * y(focusPoint.y))
          .scale(scale);
        transformRef.current = nextTransform;
        selection.call(zoom.transform, nextTransform);
        requestAnimationFrame(() => {
          draw();
          showPointTooltip(focusPoint);
        });
      }
    }

    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      canvas.removeEventListener('mousemove', handlePointerMove);
      canvas.removeEventListener('click', handleClick);
      canvas.removeEventListener('mouseleave', handleMouseLeave);
      tooltipRef.current?.removeEventListener('click', handleTooltipClick);
      tooltipRef.current?.removeEventListener('mouseleave', handleTooltipLeave);
      selection.on('.zoom', null);
    };
  }, [points, selected, marks, edges, linkedPointIds, hasSearch, searchMatchIds, selectedCluster, showArtists, showSongs, focusRequest, onPlaySimilar, onRandomSong]);

  return <><canvas ref={ref} className="plot" /><div ref={tooltipRef} className="tooltip" hidden /></>;
}

function Selection({point, onMark, onUndo, onRedo, canUndo, canRedo, onSelectCluster}) {
  const metadata = point.metadata || {};
  const model = modelSummary(metadata);
  const playlist = playlistForPoint(point);
  const [activeIndex, setActiveIndex] = useState(0);
  const activeTrack = playlist[activeIndex] || null;

  useEffect(() => {
    setActiveIndex(0);
  }, [point.id]);

  return (
    <div>
      <p className="eyebrow">{point.kind}</p>
      <h3>{point.label}</h3>
      <div className="selection-history">
        <button type="button" className="secondary" onClick={onUndo} disabled={!canUndo}>Undo selection</button>
        <button type="button" className="secondary" onClick={onRedo} disabled={!canRedo}>Redo selection</button>
      </div>
      <p className="shortcut-hint">Shortcuts: Ctrl+Z undo, Ctrl+R redo.</p>
      <div className="selection-actions">
        <button type="button" onClick={onMark}>Toggle preference mark</button>
        <button type="button" className="secondary" onClick={onSelectCluster}>Highlight cluster {point.cluster}</button>
      </div>
      {activeTrack?.soundcloudUrl && <SoundCloudPlayer key={activeTrack.soundcloudUrl} url={activeTrack.soundcloudUrl} />}
      {activeTrack?.localUrl && <audio key={activeTrack.localUrl} src={activeTrack.localUrl} controls autoPlay />}
      {point.kind === 'artist' && (
        <div className="playlist">
          <div className="playlist-header">Artist playlist · {playlist.length} songs</div>
          {playlist.map((track, index) => (
            <button
              type="button"
              className={`playlist-track ${index === activeIndex ? 'active' : ''}`}
              key={`${track.title}-${track.soundcloudUrl || track.localUrl || index}`}
              onClick={() => setActiveIndex(index)}
            >
              <span>{index + 1}</span>
              <strong>{track.title}</strong>
            </button>
          ))}
        </div>
      )}
      <dl>{visibleMetadataEntries(metadata).map(([key, value]) => <React.Fragment key={key}><dt>{key.replaceAll('_', ' ')}</dt><dd>{String(value)}</dd></React.Fragment>)}</dl>
      {model && <p className="model-note">Embedding model: {model}</p>}
    </div>
  );
}

function SoundCloudPlayer({url}) {
  const iframeRef = useRef(null);
  const widgetRef = useRef(null);
  const [needsTap, setNeedsTap] = useState(false);

  useEffect(() => {
    setNeedsTap(false);
    widgetRef.current = null;
    const iframe = iframeRef.current;
    if (!iframe || !window.SC?.Widget) {
      setNeedsTap(true);
      return;
    }
    const widget = window.SC.Widget(iframe);
    widgetRef.current = widget;
    widget.bind(window.SC.Widget.Events.READY, () => {
      widget.play(() => setNeedsTap(false));
      window.setTimeout(() => {
        widget.isPaused((paused) => setNeedsTap(Boolean(paused)));
      }, 700);
    });
  }, [url]);

  function playInPage() {
    const widget = widgetRef.current;
    if (!widget) return;
    widget.play(() => setNeedsTap(false));
  }

  return (
    <div className="soundcloud-player">
      <iframe
        ref={iframeRef}
        title="SoundCloud"
        width="100%"
        height="166"
        scrolling="no"
        frameBorder="no"
        allow="autoplay"
        src={`https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&auto_play=false&show_artwork=false&visual=false&buying=false&sharing=false&download=false&show_comments=false`}
      />
      {needsTap && (
        <button type="button" className="inline-play" onClick={playInPage}>
          Tap to play embedded track
        </button>
      )}
    </div>
  );
}

function playlistForPoint(point) {
  const metadata = point.metadata || {};
  if (point.kind === 'artist') {
    return (metadata.tracks || [])
      .map((track) => playlistTrack(track.title || track.label || `Track ${track.track_id || ''}`, track.url, null))
      .filter(Boolean);
  }
  const sourceUrl = metadata.url || metadata.source_url;
  const localUrl = point.kind === 'user_track' && metadata.source_type === 'youtube' && metadata.username
    ? `${API_BASE_URL}/users/${encodeURIComponent(metadata.username)}/tracks/${metadata.id}/audio`
    : null;
  return [playlistTrack(metadata.title || point.label, sourceUrl, localUrl)].filter(Boolean);
}

function playlistTrack(title, sourceUrl, localUrl) {
  const soundcloudUrl = sourceUrl && sourceUrl.includes('soundcloud.com') ? sourceUrl : null;
  if (!soundcloudUrl && !localUrl) return null;
  return {title: title || 'Untitled track', soundcloudUrl, localUrl};
}

function TrackRow({track, active, onSelect}) {
  return (
    <button type="button" className={`track-row ${active ? 'active' : ''}`} onClick={onSelect}>
      <span className="track-star">★</span>
      <strong>{track.title || track.source_url}</strong>
      <span>{track.source_type} · {track.status}</span>
      {track.last_error && <small>{track.last_error}</small>}
    </button>
  );
}

function isMarked(point, marks) {
  return marks.has(`${point.kind}:${point.metadata?.artist_name || point.metadata?.artist || point.label}`);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'}[char]));
}

createRoot(document.getElementById('root')).render(<App />);
