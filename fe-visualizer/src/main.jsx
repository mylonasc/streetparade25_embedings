import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as d3 from 'd3';
import {getUserPreferences, request, setUserPreference} from './api.js';
import {DEFAULT_LAYOUT_OPTIONS, layoutPayload, optionalNumber} from './layoutOptions.js';
import {DEFAULT_TRAINING_OPTIONS, buildPreferenceDataset, hasSavedPreferenceModel, loadPreferenceModel, predictTrackPreferences, savePreferenceModel, summarizeExamples, trainPreferenceModel} from './preferenceTraining.ts';
import {buildSearchIndex, searchResults} from './search.js';
import {isMarked, markKey, modelSummary, playlistForPoint, preferenceKeyForPoint, preferenceTarget, visibleMetadataEntries} from './selection.js';
import {MARKS_KEY, USERNAME_KEY, readMarks, safeGetItem, safeSetItem} from './storage.js';
import './styles.css';

const SONG_DOWNLOADS_BUILD_ENABLED = import.meta.env.VITE_ENABLE_SONG_DL_AND_EMBEDINGS !== 'false';
const VISUALIZATION_CACHE_VERSION = 1;
const EMPTY_STATS = {point_count: 0, base_point_count: 0, artist_point_count: 0, user_point_count: 0};

function visualizationCacheKey(username) {
  return `streetparade-visualization-v${VISUALIZATION_CACHE_VERSION}:${username || 'anonymous'}`;
}

function readVisualizationCache(username) {
  try {
    const raw = safeGetItem(visualizationCacheKey(username));
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (cached?.version !== VISUALIZATION_CACHE_VERSION || !cached.payload || !Array.isArray(cached.payload.points)) return null;
    return cached;
  } catch {
    return null;
  }
}

function writeVisualizationCache(username, signature, payload) {
  if (!signature || !payload?.points) return;
  try {
    safeSetItem(visualizationCacheKey(username), JSON.stringify({
      version: VISUALIZATION_CACHE_VERSION,
      signature,
      cachedAt: Date.now(),
      payload,
    }));
  } catch {
    // Browser storage can be full or disabled; the live map still works without caching.
  }
}

function App() {
  const [username, setUsername] = useState(safeGetItem(USERNAME_KEY) || '');
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
  const [stats, setStats] = useState(EMPTY_STATS);
  const [songDownloadsEnabled, setSongDownloadsEnabled] = useState(true);
  const [layoutOptions, setLayoutOptions] = useState(DEFAULT_LAYOUT_OPTIONS);
  const [showLayoutModal, setShowLayoutModal] = useState(false);
  const [showSavedModelPrompt, setShowSavedModelPrompt] = useState(false);
  const [linkedTrackIds, setLinkedTrackIds] = useState(new Set());
  const [similarityEdges, setSimilarityEdges] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCluster, setSelectedCluster] = useState(null);
  const [colorByPreference, setColorByPreference] = useState(false);
  const [showArtists, setShowArtists] = useState(true);
  const [showSongs, setShowSongs] = useState(true);
  const [showHelp, setShowHelp] = useState(false);
  const [focusRequest, setFocusRequest] = useState(null);
  const [selectionMinimized, setSelectionMinimized] = useState(false);
  const [thumbPreferences, setThumbPreferences] = useState({});
  const [sideTab, setSideTab] = useState('songs');
  const [embeddedTracks, setEmbeddedTracks] = useState([]);
  const [preferenceTrainingOptions, setPreferenceTrainingOptions] = useState(DEFAULT_TRAINING_OPTIONS);
  const [preferenceTrainingStatus, setPreferenceTrainingStatus] = useState('No model trained in this browser yet.');
  const [preferenceTrainingBusy, setPreferenceTrainingBusy] = useState(false);
  const [preferenceLossHistory, setPreferenceLossHistory] = useState([]);
  const [preferenceEvaluation, setPreferenceEvaluation] = useState(null);
  const [preferenceEvaluationSplit, setPreferenceEvaluationSplit] = useState('validation');
  const [predictedPreferences, setPredictedPreferences] = useState({});
  const [colorByPredictedPreference, setColorByPredictedPreference] = useState(false);
  const [visualizationLoading, setVisualizationLoading] = useState(false);

  async function loadAll(activeUsername = username) {
    if (!activeUsername) return;
    const cached = readVisualizationCache(activeUsername);
    if (cached?.payload) applyVisualizationPayload(cached.payload);
    setVisualizationLoading(!cached?.payload);
    try {
      const status = await request(`/visualization/status?username=${encodeURIComponent(activeUsername)}`);
      let payload = cached?.payload || null;
      if (!cached || cached.signature !== status.signature) {
        setVisualizationLoading(true);
        payload = await request(`/visualization?username=${encodeURIComponent(activeUsername)}`);
        writeVisualizationCache(activeUsername, status.signature || payload.signature, payload);
        applyVisualizationPayload(payload);
      }
      const userSongDownloadsEnabled = SONG_DOWNLOADS_BUILD_ENABLED && Boolean((payload || status).features?.song_downloads_and_embeddings);
      const [tracks, preferences] = await Promise.all([
        userSongDownloadsEnabled ? request(`/users/${encodeURIComponent(activeUsername)}/tracks`) : Promise.resolve([]),
        getUserPreferences(activeUsername),
      ]);
      setSongDownloadsEnabled(userSongDownloadsEnabled);
      setUserTracks(tracks || []);
      setThumbPreferences(preferences || {});
    } finally {
      setVisualizationLoading(false);
    }
  }

  function applyVisualizationPayload(viz) {
    setSongDownloadsEnabled(SONG_DOWNLOADS_BUILD_ENABLED && Boolean(viz.features?.song_downloads_and_embeddings));
    setPoints(viz.points || []);
    setStats({
      point_count: viz.point_count || 0,
      base_point_count: viz.base_point_count || 0,
      artist_point_count: viz.artist_point_count || 0,
      user_point_count: viz.user_point_count || 0,
    });
  }

  async function saveUsername(event) {
    event.preventDefault();
    setError('');
    try {
      const user = await request('/users', {method: 'POST', body: JSON.stringify({username: draftUsername})});
      safeSetItem(USERNAME_KEY, user.username);
      setUsername(user.username);
      await loadAll(user.username);
    } catch (err) {
      setError(err.message);
    }
  }

  async function submitTrack(event) {
    event.preventDefault();
    if (!songDownloadsEnabled) return;
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
    const key = markKey(point);
    const next = new Set(marks);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    safeSetItem(MARKS_KEY, JSON.stringify(Array.from(next)));
    setMarks(next);
  }

  async function toggleThumb(point, value) {
    const target = preferenceTarget(point);
    const key = preferenceKeyForPoint(point);
    if (!target || !key || !username) return;
    const nextValue = thumbPreferences[key] === value ? null : value;
    setThumbPreferences((existing) => {
      const next = {...existing};
      if (nextValue) next[key] = nextValue;
      else delete next[key];
      return next;
    });
    try {
      setThumbPreferences(await setUserPreference(username, target, nextValue || 'clear'));
    } catch (err) {
      setError(err.message);
      await loadAll();
    }
  }

  async function setArtistPreference(artistPoint, value) {
    const target = preferenceTarget(artistPoint);
    const key = preferenceKeyForPoint(artistPoint);
    if (!target || !key || !username) return;
    const nextValue = thumbPreferences[key] === value ? null : value;
    setThumbPreferences((existing) => {
      const next = {...existing};
      if (nextValue) next[key] = nextValue;
      else delete next[key];
      return next;
    });
    try {
      setThumbPreferences(await setUserPreference(username, target, nextValue || 'clear'));
    } catch (err) {
      setError(err.message);
      await loadAll();
    }
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

  function selectArtistForSong(point) {
    const artistName = point?.metadata?.artist_name || point?.metadata?.artist;
    if (!artistName) return;
    const artistPoint = points.find((candidate) => candidate.kind === 'artist' && (candidate.metadata?.artist_name || candidate.label) === artistName);
    if (artistPoint) selectPoint(artistPoint, {focus: true});
  }

  function selectRandomArtistSong(point) {
    const tracks = point?.metadata?.tracks || [];
    const ids = tracks.map((track) => track.id).filter(Boolean);
    const songs = ids
      .map((id) => points.find((candidate) => candidate.id === id))
      .filter((candidate) => candidate && (candidate.kind === 'track' || candidate.kind === 'user_track'));
    if (!songs.length) return;
    selectPoint(songs[Math.floor(Math.random() * songs.length)], {focus: true});
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
    if (!songDownloadsEnabled) return;
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

  function handleSelectionSheetPointerDown(event) {
    if (event.target?.closest?.('button')) return;
    const target = event.currentTarget;
    const startY = event.clientY;
    target.setPointerCapture?.(event.pointerId);

    function handlePointerUp(nextEvent) {
      const deltaY = nextEvent.clientY - startY;
      if (Math.abs(deltaY) > 34) {
        setSelectionMinimized(deltaY > 0);
      } else {
        setSelectionMinimized(true);
      }
      target.removeEventListener('pointerup', handlePointerUp);
      target.removeEventListener('pointercancel', handlePointerCancel);
      target.releasePointerCapture?.(event.pointerId);
    }

    function handlePointerCancel() {
      target.removeEventListener('pointerup', handlePointerUp);
      target.removeEventListener('pointercancel', handlePointerCancel);
      target.releasePointerCapture?.(event.pointerId);
    }

    target.addEventListener('pointerup', handlePointerUp);
    target.addEventListener('pointercancel', handlePointerCancel);
  }

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('share');
    if (!token) return;
    request(`/shares/${token}`).then((share) => {
      const payload = share.payload || {};
      if (payload.username) {
        safeSetItem(USERNAME_KEY, payload.username);
        setUsername(payload.username);
        setDraftUsername(payload.username);
      }
      if (Array.isArray(payload.marked)) {
        const next = new Set(payload.marked);
        safeSetItem(MARKS_KEY, JSON.stringify(Array.from(next)));
        setMarks(next);
      }
    }).catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    if (username) loadAll().catch((err) => setError(err.message));
  }, [username]);

  useEffect(() => {
    if (!username || !hasSavedPreferenceModel()) return;
    setShowSavedModelPrompt(true);
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
        const refreshedJobs = songDownloadsEnabled
          ? await Promise.all(jobs.filter((job) => ['queued', 'running'].includes(job.status)).map((job) => request(`/user-track-jobs/${job.id}`)))
          : [];
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
  }, [username, jobs, layoutJob, songDownloadsEnabled]);

  const searchIndex = useMemo(() => buildSearchIndex(points), [points]);
  const visibleSearchResults = useMemo(() => searchResults(points, searchIndex, searchQuery), [points, searchIndex, searchQuery]);
  const searchMatchIds = useMemo(() => new Set(visibleSearchResults.map((point) => point.id)), [visibleSearchResults]);
  const clusterOptions = useMemo(
    () => Array.from(new Set(points.map((point) => point.cluster).filter((cluster) => cluster !== null && cluster !== undefined))).sort((a, b) => Number(a) - Number(b)),
    [points],
  );
  const preferenceTrainingDataset = useMemo(() => buildPreferenceDataset(embeddedTracks, thumbPreferences), [embeddedTracks, thumbPreferences]);
  const preferenceTrainingSummary = useMemo(() => summarizeExamples(preferenceTrainingDataset.examples, preferenceTrainingDataset.unlabeled), [preferenceTrainingDataset]);
  const artistSummaries = useMemo(() => buildArtistSummaries(points, thumbPreferences, predictedPreferences), [points, thumbPreferences, predictedPreferences]);

  async function loadEmbeddedTracks() {
    const tracks = [];
    let page = 1;
    while (true) {
      const data = await request(`/tracks?page=${page}&page_size=500&include_embedding=true`);
      tracks.push(...(data.tracks || []).filter((track) => Array.isArray(track.embedding) && track.embedding.length));
      if (!data.has_next) break;
      page += 1;
    }
    setEmbeddedTracks(tracks);
    return tracks;
  }

  async function trainPreferenceColorModel() {
    setError('');
    setPreferenceTrainingBusy(true);
    try {
      const tracks = embeddedTracks.length ? embeddedTracks : await loadEmbeddedTracks();
      const dataset = buildPreferenceDataset(tracks, thumbPreferences);
      const summary = summarizeExamples(dataset.examples, dataset.unlabeled);
      if (!summary.canTrain) throw new Error('Train needs at least one liked and one unliked embedded track.');
      const trained = await trainPreferenceModel(dataset.examples, preferenceTrainingOptions);
      await savePreferenceModel(trained);
      setPreferenceLossHistory(trained.lossHistory || []);
      setPreferenceEvaluation(trained.evaluation || null);
      setPreferenceEvaluationSplit(trained.evaluation?.validation?.count ? 'validation' : 'train');
      setPredictedPreferences(await predictTrackPreferences(trained, dataset.unlabeled));
      setColorByPredictedPreference(true);
      setPreferenceTrainingStatus(`Trained ${summary.total} labels (${summary.likes} liked / ${summary.dislikes} unliked), predicted ${summary.unlabeled} songs.`);
    } catch (err) {
      setError(err.message);
      setPreferenceTrainingStatus(err.message);
    } finally {
      setPreferenceTrainingBusy(false);
    }
  }

  async function loadPreferenceColorModel() {
    setError('');
    setPreferenceTrainingBusy(true);
    try {
      const [trained, tracks] = await Promise.all([loadPreferenceModel(), embeddedTracks.length ? Promise.resolve(embeddedTracks) : loadEmbeddedTracks()]);
      if (!trained) throw new Error('No saved preference model found in this browser.');
      const dataset = buildPreferenceDataset(tracks, thumbPreferences);
      setPreferenceLossHistory(trained.lossHistory || []);
      setPreferenceEvaluation(trained.evaluation || null);
      setPreferenceEvaluationSplit(trained.evaluation?.validation?.count ? 'validation' : 'train');
      setPredictedPreferences(await predictTrackPreferences(trained, dataset.unlabeled));
      setColorByPredictedPreference(true);
      setShowSavedModelPrompt(false);
      setPreferenceTrainingStatus(`Loaded model from ${new Date(trained.trainedAt).toLocaleString()}, predicted ${dataset.unlabeled.length} songs.`);
    } catch (err) {
      setError(err.message);
      setPreferenceTrainingStatus(err.message);
    } finally {
      setPreferenceTrainingBusy(false);
    }
  }

  if (!username) {
    return <UsernameGate draftUsername={draftUsername} setDraftUsername={setDraftUsername} saveUsername={saveUsername} error={error} />;
  }

  return (
    <main className="shell">
      <header className="app-bar">
        <div>
          <p className="eyebrow">Street Parade map</p>
          <h1>Embedding visualizer</h1>
        </div>
        <div className="app-stats" aria-label="Map statistics">
          <span>{stats.point_count} points</span>
          <span>{stats.user_point_count} uploads</span>
        </div>
      </header>
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
                <button type="button" className={`secondary toggle-button ${colorByPreference ? 'active' : ''}`} onClick={() => setColorByPreference((value) => !value)}>Liked</button>
                <button type="button" className={`secondary toggle-button ${colorByPredictedPreference ? 'active predicted' : ''}`} onClick={() => setColorByPredictedPreference((value) => !value)} disabled={!Object.keys(predictedPreferences).length}>Predicted</button>
                {(selectedCluster !== null || colorByPreference || colorByPredictedPreference) && <button type="button" className="secondary" onClick={() => { setSelectedCluster(null); setColorByPreference(false); setColorByPredictedPreference(false); }}>Clear</button>}
              </div>
              {searchQuery.trim() && (
                <div className="search-results">
                  {visibleSearchResults.slice(0, 8).map((point) => <button type="button" key={point.id} onClick={() => selectPoint(point)}>{point.label}</button>)}
                  {!visibleSearchResults.length && <span>No matches</span>}
                </div>
              )}
            </div>
            <div className="map-toolbar">
              <button type="button" className="secondary toolbar-text-button" onClick={resetSelection} disabled={!selected}>Reset</button>
              <button type="button" className="secondary icon-button" aria-label="Undo selection" onClick={undoSelection} disabled={!selectionUndoStack.length}>↶</button>
              <button type="button" className="secondary icon-button" aria-label="Redo selection" onClick={redoSelection} disabled={!selectionRedoStack.length}>↷</button>
              <button type="button" className="secondary icon-button" aria-label="Toggle preference mark" onClick={() => selected && toggleMark(selected)} disabled={!selected}>★</button>
              <button type="button" className={`secondary toggle-button ${showSongs ? 'active' : ''}`} onClick={() => setShowSongs((value) => !value)}>Songs</button>
              <button type="button" className={`secondary toggle-button ${showArtists ? 'active' : ''}`} onClick={() => setShowArtists((value) => !value)}>Artists</button>
              <button type="button" className="secondary icon-button" aria-label="Help" onClick={() => setShowHelp(true)}>?</button>
            </div>
            {!visualizationLoading && stats.base_point_count === 0 && (
              <div className="empty-warning">
                No Street Parade vectors loaded. Check that the API can access the Chroma vector store, especially `./chroma` when using Docker.
              </div>
            )}
            <Visualizer points={points} loading={visualizationLoading} selected={selected} setSelected={selectPoint} marks={marks} thumbPreferences={thumbPreferences} predictedPreferences={predictedPreferences} colorByPreference={colorByPreference} colorByPredictedPreference={colorByPredictedPreference} onThumb={toggleThumb} edges={similarityEdges} linkedPointIds={linkedTrackIds} hasSearch={Boolean(searchQuery.trim())} searchMatchIds={searchMatchIds} selectedCluster={selectedCluster} showArtists={showArtists} showSongs={showSongs} focusRequest={focusRequest} onCanvasClick={() => setSelectionMinimized(true)} onSelectArtist={selectArtistForSong} onPlayArtistSong={selectRandomArtistSong} onPlaySimilar={() => selectRandomLinkedSong(similarityEdges, points, selected, selectPoint)} onRandomSong={() => selectRandomSong(true)} />
          </section>

          <section className={`panel selection-panel ${(selected || playbackPoint) ? 'has-selection' : ''} ${selectionMinimized ? 'is-minimized' : ''}`} aria-live="polite">
            <div className="sheet-grip" aria-hidden="true" onPointerDown={handleSelectionSheetPointerDown} />
            <div className="selection-panel-header" onPointerDown={handleSelectionSheetPointerDown}>
              <h2>Selection</h2>
              {(selected || playbackPoint) && (
                <button
                  type="button"
                  className="secondary sheet-toggle"
                  aria-expanded={!selectionMinimized}
                  onClick={() => setSelectionMinimized((value) => !value)}
                >
                  {selectionMinimized ? 'Expand' : 'Minimize'}
                </button>
              )}
            </div>
            {(selected || playbackPoint) ? <Selection point={selected || playbackPoint} thumbValue={thumbPreferences[preferenceKeyForPoint(selected || playbackPoint)]} onThumb={(value) => toggleThumb(selected || playbackPoint, value)} onMark={() => toggleMark(selected || playbackPoint)} onUndo={undoSelection} onRedo={redoSelection} canUndo={selectionUndoStack.length > 0} canRedo={selectionRedoStack.length > 0} onSelectCluster={() => setSelectedCluster((selected || playbackPoint).cluster)} isFocused={Boolean(selected)} /> : <p className="muted">Click a point on the map.</p>}
          </section>
        </section>

        <aside className="side">
          <div className="side-tabs">
            <button type="button" className={sideTab === 'songs' ? '' : 'secondary'} onClick={() => setSideTab('songs')}>Songs</button>
            <button type="button" className={sideTab === 'training' ? '' : 'secondary'} onClick={() => setSideTab('training')}>Training</button>
            <button type="button" className={sideTab === 'artists' ? '' : 'secondary'} onClick={() => setSideTab('artists')}>Artists</button>
          </div>
          {sideTab === 'songs' && songDownloadsEnabled && (
            <>
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
            </>
          )}
          {sideTab === 'songs' && !songDownloadsEnabled && <section className="panel"><h2>My songs</h2><p className="muted">Song downloads and embeddings are disabled on this deployment.</p></section>}
          {sideTab === 'training' && <PreferenceTrainingPanel options={preferenceTrainingOptions} setOptions={setPreferenceTrainingOptions} summary={preferenceTrainingSummary} status={preferenceTrainingStatus} busy={preferenceTrainingBusy} lossHistory={preferenceLossHistory} evaluation={preferenceEvaluation} evaluationSplit={preferenceEvaluationSplit} setEvaluationSplit={setPreferenceEvaluationSplit} onLoadTracks={loadEmbeddedTracks} onTrain={trainPreferenceColorModel} onLoadModel={loadPreferenceColorModel} />}
          {sideTab === 'artists' && <ArtistFavoritesPanel artists={artistSummaries} onPreference={setArtistPreference} onSelect={(point) => selectPoint(point, {focus: true})} />}

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
      {showSavedModelPrompt && <SavedModelPrompt onLoad={loadPreferenceColorModel} onClose={() => setShowSavedModelPrompt(false)} busy={preferenceTrainingBusy} />}
    </main>
  );
}

function PreferenceTrainingPanel({options, setOptions, summary, status, busy, lossHistory, evaluation, evaluationSplit, setEvaluationSplit, onLoadTracks, onTrain, onLoadModel}) {
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
        <label>Seed<input type="number" min="0" max="999999999" value={options.randomSeed} onChange={(event) => setOptions({...options, randomSeed: Number(event.target.value)})} /></label>
      </div>
      <button type="button" className="secondary" onClick={onLoadTracks} disabled={busy}>Refresh embeddings</button>
      <button type="button" onClick={onTrain} disabled={busy || !summary.canTrain}>{busy ? 'Working...' : 'Train model'}</button>
      <button type="button" className="secondary" onClick={onLoadModel} disabled={busy}>Load saved model</button>
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

function SavedModelPrompt({onLoad, onClose, busy}) {
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

function TrainingCurve({history}) {
  if (!history?.length) return null;
  const width = 340;
  const height = 150;
  const pad = {top: 12, right: 10, bottom: 24, left: 38};
  const values = history.flatMap((point) => [point.loss, point.valLoss]).filter((value) => Number.isFinite(value));
  const minLoss = Math.min(...values, 0);
  const maxLoss = Math.max(...values, 1);
  const x = (epoch) => pad.left + ((epoch - 1) / Math.max(1, history.length - 1)) * (width - pad.left - pad.right);
  const y = (loss) => height - pad.bottom - ((loss - minLoss) / Math.max(0.000001, maxLoss - minLoss)) * (height - pad.top - pad.bottom);
  const linePath = (key) => history
    .filter((point) => Number.isFinite(point[key]))
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(point.epoch).toFixed(1)} ${y(point[key]).toFixed(1)}`)
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

function ArtistFavoritesPanel({artists, onPreference, onSelect}) {
  const [filter, setFilter] = useState('all');
  const visibleArtists = artists.filter((artist) => {
    if (filter === 'liked') return artist.artistPreference === 'up' || artist.predictedUp > artist.predictedDown;
    if (filter === 'unliked') return artist.artistPreference === 'down' || artist.predictedDown > artist.predictedUp;
    if (filter === 'manual') return Boolean(artist.artistPreference);
    return true;
  });
  return (
    <section className="panel artist-favorites-panel">
      <h2>Artist favorites</h2>
      <p className="muted">Rank artists by actual and predicted song preferences, then mark artists liked or unliked.</p>
      <select value={filter} onChange={(event) => setFilter(event.target.value)}>
        <option value="all">All artists</option>
        <option value="liked">Likely liked</option>
        <option value="unliked">Likely unliked</option>
        <option value="manual">Manually marked</option>
      </select>
      <div className="artist-favorites-list">
        {visibleArtists.map((artist) => (
          <article className="artist-favorite-row" key={artist.key}>
            <button type="button" className="artist-title" onClick={() => onSelect(artist.point)}>{artist.name}</button>
            <div className="artist-score-grid">
              <span>Actual +{artist.actualUp} / -{artist.actualDown}</span>
              <span>Pred +{artist.predictedUp} / -{artist.predictedDown}</span>
              <span>{artist.trackCount} songs</span>
            </div>
            <div className="artist-favorite-actions">
              <button type="button" className={`secondary thumb-button thumb-up ${artist.artistPreference === 'up' ? 'active' : ''}`} onClick={() => onPreference(artist.point, 'up')} aria-pressed={artist.artistPreference === 'up'}>👍</button>
              <button type="button" className={`secondary thumb-button thumb-down ${artist.artistPreference === 'down' ? 'active' : ''}`} onClick={() => onPreference(artist.point, 'down')} aria-pressed={artist.artistPreference === 'down'}>👎</button>
            </div>
          </article>
        ))}
      </div>
      {!visibleArtists.length && <p className="muted">No artists match this filter.</p>}
    </section>
  );
}

function updateLayoutOption(setLayoutOptions, key, value) {
  setLayoutOptions((existing) => ({...existing, [key]: value}));
}

function isEditingTarget(target) {
  const tagName = target?.tagName?.toLowerCase();
  return target?.isContentEditable || tagName === 'input' || tagName === 'textarea' || tagName === 'select';
}

function buildArtistSummaries(points, thumbPreferences, predictedPreferences) {
  const artistPoints = new Map(points.filter((point) => point.kind === 'artist').map((point) => [point.label, point]));
  const summaries = new Map();
  for (const point of points) {
    if (!['track', 'user_track'].includes(point.kind)) continue;
    const metadata = point.metadata || {};
    const artistName = metadata.artist_name || metadata.artist;
    if (!artistName) continue;
    const artistPoint = artistPoints.get(artistName) || {id: `artist-${slugForKey(artistName)}`, kind: 'artist', label: artistName, metadata: {artist_name: artistName}};
    const summary = summaries.get(artistName) || {
      key: artistPoint.id,
      name: artistName,
      point: artistPoint,
      trackCount: 0,
      actualUp: 0,
      actualDown: 0,
      predictedUp: 0,
      predictedDown: 0,
      artistPreference: thumbPreferences?.[preferenceKeyForPoint(artistPoint)] || null,
    };
    const actual = thumbPreferences?.[preferenceKeyForPoint(point)];
    const predicted = predictedPreferences?.[preferenceKeyForPoint(point)]?.value;
    summary.trackCount += 1;
    if (actual === 'up') summary.actualUp += 1;
    if (actual === 'down') summary.actualDown += 1;
    if (!actual && predicted === 'up') summary.predictedUp += 1;
    if (!actual && predicted === 'down') summary.predictedDown += 1;
    summaries.set(artistName, summary);
  }
  return Array.from(summaries.values()).sort((a, b) => {
    const aStrength = Math.max(a.actualUp + a.predictedUp, a.actualDown + a.predictedDown);
    const bStrength = Math.max(b.actualUp + b.predictedUp, b.actualDown + b.predictedDown);
    return bStrength - aStrength || b.trackCount - a.trackCount || a.name.localeCompare(b.name);
  });
}

function slugForKey(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
}

function formatMetric(value) {
  return value === null || value === undefined ? 'n/a' : Number(value).toFixed(3);
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

function selectRandomLinkedSong(edges, points, selected, selectPoint) {
  const ids = Array.from(new Set((edges || []).flatMap((edge) => [edge.source, edge.target])));
  const songs = ids
    .map((id) => points.find((point) => point.id === id))
    .filter((point) => point && point.id !== selected?.id && (point.kind === 'track' || point.kind === 'user_track'));
  if (!songs.length) return;
  selectPoint(songs[Math.floor(Math.random() * songs.length)], {focus: true});
}

function pointTooltipHtml(point, thumbValue = null) {
  const metadata = point.metadata || {};
  const thumbs = `<button type="button" data-tooltip-action="thumb-up" class="thumb-button thumb-up ${thumbValue === 'up' ? 'active' : ''}" aria-pressed="${thumbValue === 'up'}" aria-label="Thumbs up">👍</button><button type="button" data-tooltip-action="thumb-down" class="thumb-button thumb-down ${thumbValue === 'down' ? 'active' : ''}" aria-pressed="${thumbValue === 'down'}" aria-label="Thumbs down">👎</button>`;
  if (point.kind === 'track' || point.kind === 'user_track') {
    const rows = [
      ['Artist', metadata.artist_name || metadata.artist || 'Unknown'],
      ['Song', metadata.title || point.label],
      ['Cluster', point.cluster],
    ];
    return `<strong>${escapeHtml(metadata.title || point.label)}</strong>${rows.map(([key, value]) => `<span>${escapeHtml(key)}: ${escapeHtml(value)}</span>`).join('')}<div class="tooltip-actions">${thumbs}<button type="button" data-tooltip-action="select-artist" aria-label="Select artist">Artist</button><button type="button" data-tooltip-action="play-similar" aria-label="Play connected song">▶</button><button type="button" data-tooltip-action="random-song" aria-label="Random song">⏭</button></div>`;
  }
  if (point.kind === 'artist') {
    const rows = [
      ['Artist', metadata.artist_name || point.label],
      ['Tracks', metadata.track_count || (metadata.tracks || []).length || 0],
      ['Cluster', point.cluster],
    ];
    return `<strong>${escapeHtml(point.label)}</strong>${rows.map(([key, value]) => `<span>${escapeHtml(key)}: ${escapeHtml(value)}</span>`).join('')}<div class="tooltip-actions">${thumbs}<button type="button" data-tooltip-action="artist-song" aria-label="Select artist song">▶ song</button><button type="button" data-tooltip-action="random-song" aria-label="Random song">⏭</button></div>`;
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

function pointFill(point, clusterColor, thumbPreferences, predictedPreferences, colorByPreference, colorByPredictedPreference) {
  if (colorByPreference) {
    const preference = thumbPreferences?.[preferenceKeyForPoint(point)];
    if (preference === 'up') return '#85f5c4';
    if (preference === 'down') return '#ff5c35';
    return point.kind === 'artist' ? 'rgba(133, 245, 196, 0.42)' : 'rgba(154, 168, 189, 0.46)';
  }
  if (colorByPredictedPreference) {
    const preference = thumbPreferences?.[preferenceKeyForPoint(point)];
    const prediction = predictedPreferences?.[preferenceKeyForPoint(point)];
    if (preference === 'up') return '#85f5c4';
    if (preference === 'down') return '#ff5c35';
    if (prediction?.value === 'up') return '#b7ffd9';
    if (prediction?.value === 'down') return '#ff9a7f';
    return point.kind === 'artist' ? 'rgba(133, 245, 196, 0.42)' : 'rgba(154, 168, 189, 0.38)';
  }
  if (point.kind === 'user_track') return '#ff5c35';
  if (point.kind === 'artist') return '#85f5c4';
  return clusterColor(point.cluster);
}

function showTooltipAt(tooltip, anchorElement, x, y, html) {
  const container = tooltip.offsetParent?.getBoundingClientRect() || {left: 0, top: 0};
  const anchor = anchorElement.getBoundingClientRect();
  tooltip.hidden = false;
  tooltip.innerHTML = html;
  const tooltipWidth = tooltip.offsetWidth || 280;
  const tooltipHeight = tooltip.offsetHeight || 140;
  const gap = 14;
  const padding = 10;
  const baseLeft = anchor.left - container.left + x;
  const baseTop = anchor.top - container.top + y;
  const containerWidth = container.width || window.innerWidth;
  const containerHeight = container.height || window.innerHeight;
  const opensLeft = baseLeft + gap + tooltipWidth > containerWidth - padding;
  const opensUp = baseTop + gap + tooltipHeight > containerHeight - padding;
  const left = clamp(opensLeft ? baseLeft - tooltipWidth - gap : baseLeft + gap, padding, Math.max(padding, containerWidth - tooltipWidth - padding));
  const top = clamp(opensUp ? baseTop - tooltipHeight - gap : baseTop + gap, padding, Math.max(padding, containerHeight - tooltipHeight - padding));
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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

function drawLoadingMap(context, width, height, timestamp) {
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(width, height) * 0.14;
  const phase = timestamp / 840;
  context.save();
  context.lineWidth = 1.3;
  for (let ring = 0; ring < 3; ring += 1) {
    context.beginPath();
    context.arc(centerX, centerY, radius + ring * 23, 0, Math.PI * 2);
    context.strokeStyle = `rgba(133, 245, 196, ${0.15 - ring * 0.035})`;
    context.stroke();
  }
  for (let idx = 0; idx < 22; idx += 1) {
    const angle = phase + idx * (Math.PI * 2 / 22);
    const orbit = radius + Math.sin(phase * 1.6 + idx * 0.9) * 18;
    const x = centerX + Math.cos(angle) * orbit;
    const y = centerY + Math.sin(angle) * orbit * 0.62;
    const pulse = (Math.sin(phase * 2.2 + idx * 0.65) + 1) / 2;
    context.beginPath();
    context.arc(x, y, 2.4 + pulse * 3.6, 0, Math.PI * 2);
    context.fillStyle = `rgba(133, 245, 196, ${0.24 + pulse * 0.58})`;
    context.fill();
  }
  context.fillStyle = '#eff6ff';
  context.font = '800 16px Inter, system-ui, sans-serif';
  context.textAlign = 'center';
  context.fillText('Loading embeddings', centerX, centerY + radius + 68);
  context.fillStyle = 'rgba(239, 246, 255, 0.56)';
  context.font = '700 12px Inter, system-ui, sans-serif';
  context.fillText('Preparing the map', centerX, centerY + radius + 90);
  context.restore();
}

function Visualizer({points, loading, selected, setSelected, marks, thumbPreferences, predictedPreferences, colorByPreference, colorByPredictedPreference, onThumb, edges, linkedPointIds, hasSearch, searchMatchIds, selectedCluster, showArtists, showSongs, focusRequest, onCanvasClick, onSelectArtist, onPlayArtistSong, onPlaySimilar, onRandomSong}) {
  const ref = useRef(null);
  const tooltipRef = useRef(null);
  const transformRef = useRef(d3.zoomIdentity);
  const handledFocusRef = useRef(null);
  const tooltipRevealTimerRef = useRef(null);
  const activeTooltipPointRef = useRef(null);
  const [sizeVersion, setSizeVersion] = useState(0);

  useEffect(() => {
    if (!ref.current) return undefined;
    const parent = ref.current.parentElement;
    const observer = new ResizeObserver(() => setSizeVersion((version) => version + 1));
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!ref.current) return;
    const canvas = ref.current;
    const context = canvas.getContext('2d');
    const bounds = canvas.getBoundingClientRect();
    const width = Math.max(280, Math.round(bounds.width));
    const height = Math.max(320, Math.round(bounds.height || width * 0.68));
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    if (!points.length) {
      let loadingFrame = null;

      function drawEmpty(timestamp = 0) {
        context.save();
        context.scale(pixelRatio, pixelRatio);
        context.clearRect(0, 0, width, height);
        context.fillStyle = 'rgba(255, 255, 255, 0.035)';
        roundedRect(context, 0, 0, width, height, 24);
        context.fill();
        if (loading) drawLoadingMap(context, width, height, timestamp);
        context.restore();
        if (loading) loadingFrame = requestAnimationFrame(drawEmpty);
      }

      canvas.style.cursor = loading ? 'progress' : 'default';
      drawEmpty();
      return () => {
        if (loadingFrame !== null) cancelAnimationFrame(loadingFrame);
      };
    }
    const x = d3.scaleLinear().domain(d3.extent(points, (point) => point.x)).nice().range([36, width - 36]);
    const y = d3.scaleLinear().domain(d3.extent(points, (point) => point.y)).nice().range([height - 36, 36]);
    const color = d3.scaleOrdinal(d3.schemeTableau10.concat(d3.schemeSet3));
    const byId = new Map(points.map((point) => [point.id, point]));
    const isVisible = (point) => point && (point.kind === 'artist' ? showArtists : showSongs);
    const markerScale = (scale) => Math.max(0.65, 1 / Math.sqrt(Math.max(1, scale)));
    const symbol = d3.symbol().context(context);
    const screenPoint = (point) => [transformRef.current.applyX(x(point.x)), transformRef.current.applyY(y(point.y))];
    let hitPoints = [];
    let hitEdges = [];
    let quadtree = null;
    let frame = null;

    function pointState(point) {
      const isSelected = selected?.id === point.id;
      const hasThumbPreference = Boolean(thumbPreferences?.[preferenceKeyForPoint(point)]);
      const hasPredictedPreference = Boolean(predictedPreferences?.[preferenceKeyForPoint(point)]);
      let alpha = 1;
      if (hasSearch && !searchMatchIds?.has(point.id)) alpha = Math.min(alpha, 0.22);
      if (selectedCluster !== null && point.cluster !== selectedCluster) alpha = Math.min(alpha, 0.18);
      if (selected?.id && !isSelected && !(colorByPreference && hasThumbPreference) && !(colorByPredictedPreference && (hasThumbPreference || hasPredictedPreference))) alpha = Math.min(alpha, 0.24);
      if (colorByPreference && !hasThumbPreference) alpha = Math.min(alpha, 0.36);
      if (colorByPredictedPreference && !hasThumbPreference && !hasPredictedPreference) alpha = Math.min(alpha, 0.32);
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
        ? state.isSelected ? 360 : 230
        : point.kind === 'artist'
          ? state.isSelected ? 250 : 165
          : state.isSelected ? 165 : 92;
      context.save();
      context.translate(sx * pixelRatio, sy * pixelRatio);
      context.scale(scale * pixelRatio, scale * pixelRatio);
      context.beginPath();
      symbol.type(point.kind === 'user_track' ? d3.symbolStar : point.kind === 'artist' ? d3.symbolDiamond : d3.symbolCircle).size(size)();
      context.globalAlpha = state.alpha;
      context.fillStyle = pointFill(point, color, thumbPreferences, predictedPreferences, colorByPreference, colorByPredictedPreference);
      context.fill();
      context.lineWidth = state.isSelected ? 4 : state.isLinked || state.isSearchMatch || state.isClusterMatch ? 3 : 1.2;
      context.strokeStyle = state.isSelected ? '#fff' : state.isSearchMatch || state.isClusterMatch ? '#ffd166' : state.isLinked || state.isMarked ? '#85f5c4' : 'rgba(255,255,255,0.85)';
      context.stroke();
      context.restore();
      return {point, x: sx, y: sy, radius: Math.max(11, Math.sqrt(size) * scale)};
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
      const candidate = quadtree.find(px, py, 24);
      if (!candidate) return null;
      return Math.hypot(candidate.x - px, candidate.y - py) <= candidate.radius + 6 ? candidate.point : null;
    }

    function nearestEdge(event) {
      const [px, py] = pointerPosition(event);
      return hitEdges.find((item) => distanceToSegment(px, py, item.x1, item.y1, item.x2, item.y2) <= 8)?.edge || null;
    }

    function showPointTooltip(point) {
      activeTooltipPointRef.current = point;
      const [sx, sy] = screenPoint(point);
      showTooltipAt(tooltipRef.current, canvas, sx, sy, pointTooltipHtml(point, thumbPreferences?.[preferenceKeyForPoint(point)]));
    }

    function showEdgeTooltip(edge) {
      activeTooltipPointRef.current = null;
      const source = byId.get(edge.source);
      const target = byId.get(edge.target);
      if (!source || !target) return;
      const [x1, y1] = screenPoint(source);
      const [x2, y2] = screenPoint(target);
      showTooltipAt(tooltipRef.current, canvas, (x1 + x2) / 2, (y1 + y2) / 2, edgeTooltipHtml(edge, byId));
    }

    function hideTooltipUntilPanStops() {
      if (tooltipRevealTimerRef.current) window.clearTimeout(tooltipRevealTimerRef.current);
      activeTooltipPointRef.current = null;
      tooltipRef.current.hidden = true;
      if (!selected || !isVisible(selected)) return;
      tooltipRevealTimerRef.current = window.setTimeout(() => {
        showPointTooltip(selected);
        tooltipRevealTimerRef.current = null;
      }, 500);
    }

    function ensurePointVisible(point, zoomSelection, zoomBehavior) {
      const [sx, sy] = screenPoint(point);
      const mobile = width < 760;
      const left = mobile ? 28 : 24;
      const right = width - (mobile ? 42 : 24);
      const top = mobile ? 118 : 24;
      const bottom = height - (mobile ? 96 : 24);
      const dx = sx < left ? left - sx : sx > right ? right - sx : 0;
      const dy = sy < top ? top - sy : sy > bottom ? bottom - sy : 0;
      if (!dx && !dy) return false;
      const current = transformRef.current;
      const nextTransform = d3.zoomIdentity.translate(current.x + dx, current.y + dy).scale(current.k);
      transformRef.current = nextTransform;
      zoomSelection.call(zoomBehavior.transform, nextTransform);
      return true;
    }

    function handlePointerMove(event) {
      const point = nearestPoint(event);
      if (point) {
        canvas.style.cursor = 'pointer';
        showPointTooltip(point);
        return;
      }
      const edge = nearestEdge(event);
      if (edge) {
        canvas.style.cursor = 'pointer';
        showEdgeTooltip(edge);
        return;
      }
      canvas.style.cursor = 'grab';
      activeTooltipPointRef.current = null;
      tooltipRef.current.hidden = true;
    }

    function handleClick(event) {
      onCanvasClick?.();
      const point = nearestPoint(event);
      if (point) setSelected(point);
    };

    function handleMouseLeave(event) {
      if (tooltipRef.current?.contains(event.relatedTarget)) return;
      if (selected && isVisible(selected)) {
        showPointTooltip(selected);
        return;
      }
      tooltipRef.current.hidden = true;
    }

    function handleTooltipLeave() {
      if (selected && isVisible(selected)) {
        showPointTooltip(selected);
        return;
      }
      tooltipRef.current.hidden = true;
    }

    function handleTooltipClick(event) {
      const action = event.target?.dataset?.tooltipAction;
      const activePoint = activeTooltipPointRef.current;
      if (action === 'thumb-up' && activePoint) onThumb?.(activePoint, 'up');
      if (action === 'thumb-down' && activePoint) onThumb?.(activePoint, 'down');
      if (action === 'select-artist' && activePoint) onSelectArtist?.(activePoint);
      if (action === 'artist-song' && activePoint) onPlayArtistSong?.(activePoint);
      if (action === 'play-similar') onPlaySimilar?.();
      if (action === 'random-song') onRandomSong?.();
    }

    const zoom = d3.zoom()
      .scaleExtent([0.55, 10])
      .on('zoom', (event) => {
        transformRef.current = event.transform;
        scheduleDraw();
        hideTooltipUntilPanStops();
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
        tooltipRef.current.hidden = true;
        selection
          .transition()
          .duration(520)
          .ease(d3.easeCubicOut)
          .call(zoom.transform, nextTransform)
          .on('end', () => {
            draw();
            showPointTooltip(focusPoint);
          });
      }
    } else if (selected && isVisible(selected)) {
      ensurePointVisible(selected, selection, zoom);
      requestAnimationFrame(() => {
        draw();
        showPointTooltip(selected);
      });
    }

    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      if (tooltipRevealTimerRef.current) window.clearTimeout(tooltipRevealTimerRef.current);
      canvas.removeEventListener('mousemove', handlePointerMove);
      canvas.removeEventListener('click', handleClick);
      canvas.removeEventListener('mouseleave', handleMouseLeave);
      tooltipRef.current?.removeEventListener('click', handleTooltipClick);
      tooltipRef.current?.removeEventListener('mouseleave', handleTooltipLeave);
      selection.on('.zoom', null);
    };
  }, [points, loading, selected, marks, thumbPreferences, predictedPreferences, colorByPreference, colorByPredictedPreference, onThumb, edges, linkedPointIds, hasSearch, searchMatchIds, selectedCluster, showArtists, showSongs, focusRequest, onCanvasClick, onSelectArtist, onPlayArtistSong, onPlaySimilar, onRandomSong, sizeVersion]);

  return <><canvas ref={ref} className="plot" /><div ref={tooltipRef} className="tooltip" hidden /></>;
}

function Selection({point, thumbValue, onThumb, onMark, onUndo, onRedo, canUndo, canRedo, onSelectCluster}) {
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
        {['track', 'user_track', 'artist'].includes(point.kind) && (
          <>
            <button type="button" className={`secondary thumb-button thumb-up ${thumbValue === 'up' ? 'active' : ''}`} onClick={() => onThumb('up')} aria-pressed={thumbValue === 'up'} aria-label="Thumbs up">👍</button>
            <button type="button" className={`secondary thumb-button thumb-down ${thumbValue === 'down' ? 'active' : ''}`} onClick={() => onThumb('down')} aria-pressed={thumbValue === 'down'} aria-label="Thumbs down">👎</button>
          </>
        )}
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

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'}[char]));
}

createRoot(document.getElementById('root')).render(<App />);
