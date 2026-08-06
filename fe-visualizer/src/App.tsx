import {CircleHelp, Pause, Play, Redo2, ThumbsDown, ThumbsUp, Undo2} from 'lucide-react';
import {useEffect, useMemo, useRef, useState} from 'react';
import {getUserPreferences, request, setUserPreference} from './api';
import {DEFAULT_LAYOUT_OPTIONS, layoutPayload, optionalNumber} from './layoutOptions';
import type {LayoutOptions} from './layoutOptions';
import {
  DEFAULT_TRAINING_OPTIONS, buildPreferenceDataset, hasSavedPreferenceModel, loadPreferenceModel,
  predictTrackPreferences, savePreferenceModel, summarizeExamples, trainPreferenceModel,
} from './preferenceTraining';
import type {EmbeddedTrack, LossPoint, TrainingOptions, TrainedPreferenceModel} from './preferenceTraining';
import {buildSearchIndex, searchResults} from './search';
import {playlistForPoint, preferenceKeyForPoint, preferenceTarget} from './selection';
import {MARKS_KEY, USERNAME_KEY, readMarks, safeGetItem, safeSetItem} from './storage';
import {useMobileViewport} from './responsive';
import {truckNumber} from './loveMobile';
import {BottomSheet} from './BottomSheet';
import {Visualizer} from './components/Visualizer';
import {Selection} from './components/Selection';
import {HelpModal, LayoutModal, LikedTrucksModal, LoveMobileModal, SavedModelPrompt, TrainModelPrompt} from './components/Modals';
import {ArtistFavoritesPanel, PreferenceTrainingPanel, TrackRow, UsernameGate} from './components/Panels';
import {ShareMenu} from './components/ShareMenu';
import type {
  ArtistSummary, Job, LayoutJob, LikedTruck, LoveMobile, Point, PointLike, Prediction, PreferenceValue, SimilarityEdge,
  Stats, UserTrack, VisualizationFeatures, VisualizationPayload,
} from './types';

const SONG_DOWNLOADS_BUILD_ENABLED = import.meta.env.VITE_ENABLE_SONG_DL_AND_EMBEDINGS !== 'false';
const VISUALIZATION_CACHE_VERSION = 1;
const EMPTY_STATS: Stats = {point_count: 0, base_point_count: 0, artist_point_count: 0, user_point_count: 0};

type VisualizationCache = {version: number; signature: string; cachedAt: number; payload: VisualizationPayload};
type FocusRequest = {pointId: string; nonce: number};

function visualizationCacheKey(username: string): string {
  return `streetparade-visualization-v${VISUALIZATION_CACHE_VERSION}:${username || 'anonymous'}`;
}

function readVisualizationCache(username: string): VisualizationCache | null {
  try {
    const raw = safeGetItem(visualizationCacheKey(username));
    if (!raw) return null;
    const cached = JSON.parse(raw) as Partial<VisualizationCache>;
    if (cached?.version !== VISUALIZATION_CACHE_VERSION || !cached.payload || !Array.isArray(cached.payload.points)) return null;
    return cached as VisualizationCache;
  } catch {
    return null;
  }
}

function writeVisualizationCache(username: string, signature: string | undefined, payload: VisualizationPayload) {
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

export function App() {
  const isMobile = useMobileViewport();
  const [username, setUsername] = useState<string>(safeGetItem(USERNAME_KEY) || '');
  const [draftUsername, setDraftUsername] = useState<string>(username);
  const [points, setPoints] = useState<Point[]>([]);
  const [userTracks, setUserTracks] = useState<UserTrack[]>([]);
  const [selected, setSelected] = useState<Point | null>(null);
  const [playbackPoint, setPlaybackPoint] = useState<Point | null>(null);
  const [playing, setPlaying] = useState(true);
  const [selectionUndoStack, setSelectionUndoStack] = useState<Point[]>([]);
  const [selectionRedoStack, setSelectionRedoStack] = useState<Point[]>([]);
  const [marks, setMarks] = useState<Set<string>>(readMarks);
  const [url, setUrl] = useState('');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [layoutJob, setLayoutJob] = useState<LayoutJob | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [shareUrl, setShareUrl] = useState('');
  const [stats, setStats] = useState<Stats>(EMPTY_STATS);
  const [songDownloadsEnabled, setSongDownloadsEnabled] = useState(true);
  const [layoutOptions, setLayoutOptions] = useState<LayoutOptions>(DEFAULT_LAYOUT_OPTIONS);
  const [showLayoutModal, setShowLayoutModal] = useState(false);
  const [showSavedModelPrompt, setShowSavedModelPrompt] = useState(false);
  const [showTrainPrompt, setShowTrainPrompt] = useState(false);
  const [preferenceRegistrationCount, setPreferenceRegistrationCount] = useState(0);
  const preferenceCountRef = useRef(0);
  const [linkedTrackIds, setLinkedTrackIds] = useState<Set<string>>(new Set());
  const [similarityEdges, setSimilarityEdges] = useState<SimilarityEdge[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCluster, setSelectedCluster] = useState<number | null>(null);
  const [colorByPreference, setColorByPreference] = useState(false);
  const [showArtists, setShowArtists] = useState(true);
  const [showSongs, setShowSongs] = useState(true);
  const [showHelp, setShowHelp] = useState(false);
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const [selectionMinimized, setSelectionMinimized] = useState(false);
  const [thumbPreferences, setThumbPreferences] = useState<Record<string, string>>({});
  const [sideTab, setSideTab] = useState<'tracks' | 'training' | 'artists'>('tracks');
  const [embeddedTracks, setEmbeddedTracks] = useState<EmbeddedTrack[]>([]);
  const [preferenceTrainingOptions, setPreferenceTrainingOptions] = useState<TrainingOptions>(DEFAULT_TRAINING_OPTIONS);
  const [preferenceTrainingStatus, setPreferenceTrainingStatus] = useState('No model trained in this browser yet.');
  const [preferenceTrainingBusy, setPreferenceTrainingBusy] = useState(false);
  const [preferenceLossHistory, setPreferenceLossHistory] = useState<LossPoint[]>([]);
  const [preferenceEvaluation, setPreferenceEvaluation] = useState<TrainedPreferenceModel['evaluation'] | null>(null);
  const [preferenceEvaluationSplit, setPreferenceEvaluationSplit] = useState<'train' | 'validation'>('validation');
  const [predictedPreferences, setPredictedPreferences] = useState<Record<string, Prediction>>({});
  const [colorByPredictedPreference, setColorByPredictedPreference] = useState(false);
  const [visualizationLoading, setVisualizationLoading] = useState(false);
  const [activeLoveMobile, setActiveLoveMobile] = useState<LoveMobile | null>(null);
  const [showLikedTrucks, setShowLikedTrucks] = useState(false);

  async function loadAll(activeUsername = username): Promise<void> {
    if (!activeUsername) return;
    const cached = readVisualizationCache(activeUsername);
    if (cached?.payload) applyVisualizationPayload(cached.payload);
    setVisualizationLoading(!cached?.payload);
    try {
      const status = await request<{signature?: string; features?: VisualizationFeatures}>(`/visualization/status?username=${encodeURIComponent(activeUsername)}`);
      let payload: VisualizationPayload | null = cached?.payload || null;
      if (!cached || cached.signature !== status.signature) {
        setVisualizationLoading(true);
        payload = await request<VisualizationPayload>(`/visualization?username=${encodeURIComponent(activeUsername)}`);
        writeVisualizationCache(activeUsername, status.signature || payload.signature, payload);
        applyVisualizationPayload(payload);
      }
      const userSongDownloadsEnabled = SONG_DOWNLOADS_BUILD_ENABLED && Boolean((payload || status).features?.song_downloads_and_embeddings);
      const [tracks, preferences] = await Promise.all([
        userSongDownloadsEnabled ? request<UserTrack[]>(`/users/${encodeURIComponent(activeUsername)}/tracks`) : Promise.resolve([] as UserTrack[]),
        getUserPreferences(activeUsername),
      ]);
      setSongDownloadsEnabled(userSongDownloadsEnabled);
      setUserTracks(tracks || []);
      setThumbPreferences(preferences || {});
    } finally {
      setVisualizationLoading(false);
    }
  }

  function applyVisualizationPayload(viz: VisualizationPayload): void {
    setSongDownloadsEnabled(SONG_DOWNLOADS_BUILD_ENABLED && Boolean(viz.features?.song_downloads_and_embeddings));
    setPoints(viz.points || []);
    setStats({
      point_count: viz.point_count || 0,
      base_point_count: viz.base_point_count || 0,
      artist_point_count: viz.artist_point_count || 0,
      user_point_count: viz.user_point_count || 0,
    });
  }

  async function saveUsername(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError('');
    try {
      const user = await request<{username: string}>('/users', {method: 'POST', body: JSON.stringify({username: draftUsername})});
      safeSetItem(USERNAME_KEY, user.username);
      setUsername(user.username);
      await loadAll(user.username);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function submitTrack(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!songDownloadsEnabled) return;
    setError('');
    setMessage('');
    try {
      const result = await request<{job: Job}>(`/users/${encodeURIComponent(username)}/tracks`, {method: 'POST', body: JSON.stringify({url})});
      setJobs((existing) => [result.job, ...existing]);
      setUrl('');
      setMessage(`Queued ${result.job.track?.source_type} analysis`);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function recomputeLayout(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError('');
    try {
      const job = await request<LayoutJob>('/layouts/recompute', {method: 'POST', body: JSON.stringify(layoutPayload(username, layoutOptions))});
      setLayoutJob(job);
      setMessage(`Queued layout job ${job.id.slice(0, 8)}`);
      setShowLayoutModal(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function createShare(): Promise<void> {
    setError('');
    try {
      const share = await request<{token: string}>('/shares', {
        method: 'POST',
        body: JSON.stringify({username, marked: Array.from(marks)}),
      });
      setShareUrl(`${window.location.origin}${window.location.pathname}?share=${share.token}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function registerPreference(): void {
    preferenceCountRef.current += 1;
    setPreferenceRegistrationCount(preferenceCountRef.current);
    if (preferenceCountRef.current % 10 === 0) setShowTrainPrompt(true);
  }

  async function toggleThumb(point: PointLike, value: PreferenceValue): Promise<void> {
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
    if (nextValue) registerPreference();
    try {
      setThumbPreferences(await setUserPreference(username, target, nextValue || 'clear'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await loadAll();
    }
  }

  async function setArtistPreference(artistPoint: PointLike, value: PreferenceValue): Promise<void> {
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
    if (nextValue) registerPreference();
    try {
      setThumbPreferences(await setUserPreference(username, target, nextValue || 'clear'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await loadAll();
    }
  }

  function resolveSelection(point: Point | null): Point | null {
    return points.find((candidate) => candidate.id === point?.id) || point;
  }

  function selectPoint(point: PointLike, options: {focus?: boolean} = {}): void {
    if (!point || selected?.id === point.id) return;
    if (selected) setSelectionUndoStack((stack) => [...stack, selected].slice(-50));
    setSelectionRedoStack([]);
    setSelected(point as Point);
    setPlaybackPoint(point as Point);
    setPlaying(true);
    if (options.focus) setFocusRequest({pointId: point.id || '', nonce: Date.now()});
  }

  function resetSelection(): void {
    if (!selected) return;
    setSelectionUndoStack((stack) => [...stack, selected].slice(-50));
    setSelectionRedoStack([]);
    setSelected(null);
  }

  function selectRandomSong(focus = false): void {
    const songs = points.filter((point) => point.kind === 'track' || point.kind === 'user_track');
    if (!songs.length) return;
    const candidates = selected ? songs.filter((point) => point.id !== selected.id) : songs;
    selectPoint(candidates[Math.floor(Math.random() * candidates.length)] || songs[0], {focus});
  }

  function selectArtistForSong(point: Point): void {
    const artistName = point?.metadata?.artist_name || point?.metadata?.artist;
    if (!artistName) return;
    const artistPoint = points.find((candidate) => candidate.kind === 'artist' && (candidate.metadata?.artist_name || candidate.label) === artistName);
    if (artistPoint) selectPoint(artistPoint, {focus: true});
  }

  function selectRandomArtistSong(point: Point): void {
    const tracks = point?.metadata?.tracks || [];
    const ids = tracks.map((track) => track.id).filter((id): id is string | number => Boolean(id));
    const songs = ids
      .map((id) => points.find((candidate) => candidate.id === id))
      .filter((candidate): candidate is Point => Boolean(candidate && (candidate.kind === 'track' || candidate.kind === 'user_track')));
    if (!songs.length) return;
    selectPoint(songs[Math.floor(Math.random() * songs.length)], {focus: true});
  }

  function undoSelection(): void {
    if (!selectionUndoStack.length) return;
    const previous = resolveSelection(selectionUndoStack[selectionUndoStack.length - 1]);
    setSelectionUndoStack((stack) => stack.slice(0, -1));
    if (selected) setSelectionRedoStack((stack) => [...stack, selected].slice(-50));
    setSelected(previous);
    setPlaybackPoint(previous);
    setPlaying(true);
  }

  function redoSelection(): void {
    if (!selectionRedoStack.length) return;
    const next = resolveSelection(selectionRedoStack[selectionRedoStack.length - 1]);
    setSelectionRedoStack((stack) => stack.slice(0, -1));
    if (selected) setSelectionUndoStack((stack) => [...stack, selected].slice(-50));
    setSelected(next);
    setPlaybackPoint(next);
    setPlaying(true);
  }

  function selectUserTrack(track: UserTrack): void {
    if (!songDownloadsEnabled) return;
    const pointId = `user-track-${track.id}`;
    const point = points.find((candidate) => candidate.id === pointId) || {
      id: pointId,
      kind: 'user_track',
      label: track.title || track.source_url || String(track.id),
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
    request<{payload?: {username?: string; marked?: string[]}}>(`/shares/${token}`).then((share) => {
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
    }).catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    if (username) loadAll().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [username]);

  useEffect(() => {
    if (!username || !hasSavedPreferenceModel()) return;
    setShowSavedModelPrompt(true);
  }, [username]);

  useEffect(() => {
    if (sideTab !== 'training' || embeddedTracks.length) return;
    loadEmbeddedTracks().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [sideTab, embeddedTracks.length]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
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
        const data = await request<{
          results?: Array<{
            vector_id?: string;
            similarity?: number | null;
            distance?: number | null;
            track_embedding?: {track_id?: number | string};
            metadata?: {track_id?: number | string};
          }>;
        }>('/similarity/track-embeddings', {method: 'POST', body: JSON.stringify(payload)});
        if (cancelled) return;
        const byTrackId = pointsByTrackId(points);
        const edges = (data.results || [])
          .filter((item) => item.vector_id !== selectedVectorId(selected))
          .filter((item) => threshold === null || (item.similarity !== null && item.similarity !== undefined && item.similarity >= threshold))
          .map((item) => {
            const trackId = item.track_embedding?.track_id || item.metadata?.track_id;
            const target = byTrackId.get(String(trackId));
            if (!target || target.id === selected.id) return null;
            return {source: selected.id, target: target.id, similarity: item.similarity ?? null, distance: item.distance ?? null, metric: layoutOptions.similarityMetric};
          })
          .filter((edge): edge is NonNullable<typeof edge> => Boolean(edge))
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
          ? await Promise.all(jobs.filter((job) => ['queued', 'running'].includes(job.status)).map((job) => request<Job>(`/user-track-jobs/${job.id}`)))
          : [];
        if (refreshedJobs.length) setJobs((old) => old.map((job) => refreshedJobs.find((item) => item.id === job.id) || job));
        if (refreshedJobs.some((job) => ['completed', 'failed'].includes(job.status))) await loadAll();
        if (layoutJob && ['queued', 'running'].includes(layoutJob.status)) {
          const next = await request<LayoutJob>(`/layout-jobs/${layoutJob.id}`);
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
    () => Array.from(new Set(points.map((point) => point.cluster).filter((cluster): cluster is number => cluster !== null && cluster !== undefined))).sort((a, b) => Number(a) - Number(b)),
    [points],
  );
  const preferenceTrainingDataset = useMemo(() => buildPreferenceDataset(embeddedTracks, thumbPreferences), [embeddedTracks, thumbPreferences]);
  const preferenceTrainingSummary = useMemo(() => summarizeExamples(preferenceTrainingDataset.examples, preferenceTrainingDataset.unlabeled), [preferenceTrainingDataset]);
  const artistSummaries = useMemo(() => buildArtistSummaries(points, thumbPreferences, predictedPreferences), [points, thumbPreferences, predictedPreferences]);
  const likedTrucks = useMemo(() => {
    const trucks = new Map<string, LikedTruck>();
    for (const artist of artistSummaries) {
      const isLoved = artist.artistPreference === 'up' || artist.predictedUp > artist.predictedDown;
      if (!isLoved) continue;
      for (const truck of artist.loveMobiles) {
        const key = truck.uuid ?? `${truck.number ?? truck.source_index ?? truck.name ?? truck.title}`;
        const existing = trucks.get(key);
        if (existing) existing.artists.push(artist.name);
        else trucks.set(key, {truck, artists: [artist.name]});
      }
    }
    return Array.from(trucks.values()).sort((a, b) => String(truckNumber(a.truck)).localeCompare(String(truckNumber(b.truck)), undefined, {numeric: true}));
  }, [artistSummaries]);

  async function loadEmbeddedTracks(): Promise<EmbeddedTrack[]> {
    const tracks: EmbeddedTrack[] = [];
    let page = 1;
    while (true) {
      const data = await request<{tracks?: EmbeddedTrack[]; has_next?: boolean}>(`/tracks?page=${page}&page_size=500&include_embedding=true`);
      tracks.push(...(data.tracks || []).filter((track) => Array.isArray(track.embedding) && track.embedding.length));
      if (!data.has_next) break;
      page += 1;
    }
    setEmbeddedTracks(tracks);
    return tracks;
  }

  async function refreshPreferenceData(): Promise<void> {
    setError('');
    try {
      const [preferences, tracks] = await Promise.all([
        username ? getUserPreferences(username) : Promise.resolve({} as Record<string, string>),
        loadEmbeddedTracks(),
      ]);
      setThumbPreferences(preferences);
      const dataset = buildPreferenceDataset(tracks, preferences);
      const summary = summarizeExamples(dataset.examples, dataset.unlabeled);
      setPreferenceTrainingStatus(summary.total
        ? `Refreshed preferences: ${summary.likes} liked / ${summary.dislikes} unliked, ${summary.unlabeled} unlabeled tracks.`
        : 'No embedded tracks with matching preferences yet.');
    } catch (err) {
      setPreferenceTrainingStatus(err instanceof Error ? err.message : String(err));
    }
  }

  function handleTrainPromptTrain(): void {
    setShowTrainPrompt(false);
    setSideTab('training');
    setSelectionMinimized(true);
    void trainPreferenceColorModel();
  }

  async function trainPreferenceColorModel(): Promise<void> {
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
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(errorMessage);
      setPreferenceTrainingStatus(errorMessage);
    } finally {
      setPreferenceTrainingBusy(false);
    }
  }

  async function loadPreferenceColorModel(): Promise<void> {
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
      setPreferenceTrainingStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setPreferenceTrainingBusy(false);
    }
  }

  if (!username) {
    return <UsernameGate draftUsername={draftUsername} setDraftUsername={setDraftUsername} saveUsername={saveUsername} error={error} />;
  }

  const activePoint = selected || playbackPoint;
  const activeThumbKey = activePoint ? preferenceKeyForPoint(activePoint) ?? '' : '';
  const canThumb = Boolean(activePoint && ['track', 'user_track', 'artist'].includes(activePoint.kind));
  const canPlay = (activePoint ? playlistForPoint(activePoint) : []).some((track) => track.soundcloudUrl || track.localUrl);

  return (
    <main className="shell">
      <header className="app-bar">
        <div>
          <p className="eyebrow">Street Parade map</p>
          <h1>Embedding visualizer</h1>
        </div>
        <div className="app-bar-actions">
          <div className="app-stats" aria-label="Map statistics">
            <span>{stats.point_count} points</span>
            <span>{stats.user_point_count} uploads</span>
          </div>
          <ShareMenu />
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
              <button type="button" className="secondary icon-button" aria-label="Undo selection" onClick={undoSelection} disabled={!selectionUndoStack.length}><Undo2 size={20} aria-hidden="true" /></button>
              <button type="button" className="secondary icon-button" aria-label="Redo selection" onClick={redoSelection} disabled={!selectionRedoStack.length}><Redo2 size={20} aria-hidden="true" /></button>
              <button type="button" className={`secondary toggle-button ${showSongs ? 'active' : ''}`} onClick={() => setShowSongs((value) => !value)}>Tracks</button>
              <button type="button" className={`secondary toggle-button ${showArtists ? 'active' : ''}`} onClick={() => setShowArtists((value) => !value)}>Artists</button>
              <button type="button" className="secondary icon-button" aria-label="Help" onClick={() => setShowHelp(true)}><CircleHelp size={20} aria-hidden="true" /></button>
            </div>
            {!visualizationLoading && stats.base_point_count === 0 && (
              <div className="empty-warning">
                No Street Parade vectors loaded. Check that the API can access the Chroma vector store, especially `./chroma` when using Docker.
              </div>
            )}
            <Visualizer points={points} loading={visualizationLoading} selected={selected} setSelected={selectPoint} marks={marks} thumbPreferences={thumbPreferences} predictedPreferences={predictedPreferences} colorByPreference={colorByPreference} colorByPredictedPreference={colorByPredictedPreference} onThumb={toggleThumb} edges={similarityEdges} linkedPointIds={linkedTrackIds} hasSearch={Boolean(searchQuery.trim())} searchMatchIds={searchMatchIds} selectedCluster={selectedCluster} showArtists={showArtists} showSongs={showSongs} focusRequest={focusRequest} onCanvasClick={() => setSelectionMinimized(true)} onSelectArtist={selectArtistForSong} onPlayArtistSong={selectRandomArtistSong} onPlaySimilar={() => selectRandomLinkedSong(similarityEdges, points, selected, selectPoint)} onRandomSong={() => selectRandomSong(true)} />
          </section>

          <section className="panel actions">
            <h2>Map layout</h2>
            <button onClick={() => setShowLayoutModal(true)}>Configure and recompute</button>
            {layoutJob && <p className="muted">Layout job: {layoutJob.status}</p>}
            <button className="secondary" onClick={createShare}>Create share link</button>
            {shareUrl && <input readOnly value={shareUrl} onFocus={(event) => event.target.select()} />}
          </section>

          <BottomSheet
            title="Selection"
            show={Boolean(activePoint)}
            minimized={selectionMinimized}
            onMinimize={setSelectionMinimized}
            onToggle={() => setSelectionMinimized((value) => !value)}
            ariaLive
            actions={
              activePoint ? (
                <div className="sheet-quick-actions">
                  {canPlay && (
                    <button
                      type="button"
                      className="secondary icon-button"
                      aria-label={playing ? 'Stop' : 'Play'}
                      onClick={() => setPlaying((value) => !value)}
                    >
                      {playing ? <Pause size={20} aria-hidden="true" /> : <Play size={20} aria-hidden="true" />}
                    </button>
                  )}
                  {canThumb && (
                    <>
                      <button
                        type="button"
                        className={`thumb-button thumb-up ${thumbPreferences[activeThumbKey] === 'up' ? 'active' : ''}`}
                        aria-pressed={thumbPreferences[activeThumbKey] === 'up'}
                        aria-label="Thumbs up"
                        onClick={() => toggleThumb(activePoint, 'up')}
                      >
                        <ThumbsUp size={20} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className={`thumb-button thumb-down ${thumbPreferences[activeThumbKey] === 'down' ? 'active' : ''}`}
                        aria-pressed={thumbPreferences[activeThumbKey] === 'down'}
                        aria-label="Thumbs down"
                        onClick={() => toggleThumb(activePoint, 'down')}
                      >
                        <ThumbsDown size={20} aria-hidden="true" />
                      </button>
                    </>
                  )}
                </div>
              ) : null
            }
          >
            {activePoint ? (
              <Selection
                point={activePoint}
                playing={playing}
                onUndo={undoSelection}
                onRedo={redoSelection}
                canUndo={selectionUndoStack.length > 0}
                canRedo={selectionRedoStack.length > 0}
                onSelectArtist={() => selectArtistForSong(activePoint)}
                onPlaySimilar={() => selectRandomLinkedSong(similarityEdges, points, activePoint, selectPoint)}
                onRandomSong={() => selectRandomSong(true)}
              />
            ) : <p className="muted">Click a point on the map.</p>}
          </BottomSheet>
        </section>

        <aside className="side">
          <div className="side-tabs">
            <button type="button" className={sideTab === 'tracks' ? '' : 'secondary'} onClick={() => { setSideTab('tracks'); setSelectionMinimized(true); }}>Tracks</button>
            <button type="button" className={sideTab === 'training' ? '' : 'secondary'} onClick={() => { setSideTab('training'); setSelectionMinimized(true); }}>Training</button>
            <button type="button" className={sideTab === 'artists' ? '' : 'secondary'} onClick={() => { setSideTab('artists'); setSelectionMinimized(true); }}>Artists</button>
          </div>
          {sideTab === 'tracks' && songDownloadsEnabled && (
            <>
              <form className="panel" onSubmit={submitTrack}>
                <h2>Add a track</h2>
                <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="SoundCloud or YouTube URL" required />
                <button type="submit">Analyze Track</button>
              </form>

              {!isMobile && (
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
              )}
            </>
          )}
          {sideTab === 'tracks' && !songDownloadsEnabled && !isMobile && <section className="panel"><h2>My songs</h2><p className="muted">Song downloads and embeddings are disabled on this deployment.</p></section>}
          {sideTab === 'training' && <PreferenceTrainingPanel options={preferenceTrainingOptions} setOptions={setPreferenceTrainingOptions} summary={preferenceTrainingSummary} status={preferenceTrainingStatus} busy={preferenceTrainingBusy} lossHistory={preferenceLossHistory} evaluation={preferenceEvaluation} evaluationSplit={preferenceEvaluationSplit} setEvaluationSplit={setPreferenceEvaluationSplit} onRefreshPreferences={refreshPreferenceData} onTrain={trainPreferenceColorModel} onLoadModel={loadPreferenceColorModel} />}
          {sideTab === 'artists' && <ArtistFavoritesPanel artists={artistSummaries} onPreference={setArtistPreference} onSelect={(point) => selectPoint(point, {focus: true})} modelAvailable={Object.keys(predictedPreferences).length > 0} onShowLoveMobile={setActiveLoveMobile} onShowLikedTrucks={() => setShowLikedTrucks(true)} onTrain={() => void trainPreferenceColorModel()} trainingBusy={preferenceTrainingBusy} />}
        </aside>
      </section>
      {showLayoutModal && <LayoutModal layoutOptions={layoutOptions} setLayoutOptions={setLayoutOptions} recomputeLayout={recomputeLayout} onClose={() => setShowLayoutModal(false)} />}
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
      {showSavedModelPrompt && <SavedModelPrompt onLoad={loadPreferenceColorModel} onClose={() => setShowSavedModelPrompt(false)} busy={preferenceTrainingBusy} />}
      {showTrainPrompt && <TrainModelPrompt count={preferenceRegistrationCount} onDismiss={() => setShowTrainPrompt(false)} onTrain={handleTrainPromptTrain} />}
      {activeLoveMobile && <LoveMobileModal loveMobile={activeLoveMobile} onClose={() => setActiveLoveMobile(null)} />}
      {showLikedTrucks && <LikedTrucksModal trucks={likedTrucks} onClose={() => setShowLikedTrucks(false)} />}
    </main>
  );
}

function buildArtistSummaries(points: Point[], thumbPreferences: Record<string, string>, predictedPreferences: Record<string, Prediction>): ArtistSummary[] {
  const artistPoints = new Map(points.filter((point) => point.kind === 'artist').map((point) => [point.label, point as PointLike]));
  const summaries = new Map<string, ArtistSummary>();
  for (const point of points) {
    if (!['track', 'user_track'].includes(point.kind)) continue;
    const metadata = point.metadata || {};
    const artistName = metadata.artist_name || metadata.artist;
    if (!artistName) continue;
    const artistPoint: PointLike = artistPoints.get(artistName) || {id: `artist-${slugForKey(artistName)}`, kind: 'artist', label: artistName, metadata: {artist_name: artistName}};
    const summary = summaries.get(artistName) || {
      key: artistPoint.id || `artist-${slugForKey(artistName)}`,
      name: artistName,
      point: artistPoint,
      trackCount: 0,
      actualUp: 0,
      actualDown: 0,
      predictedUp: 0,
      predictedDown: 0,
      artistPreference: (thumbPreferences?.[preferenceKeyForPoint(artistPoint) ?? ''] as PreferenceValue | undefined) || null,
      loveMobiles: Array.isArray(artistPoint.metadata?.love_mobiles) ? artistPoint.metadata.love_mobiles : [],
    };
    const actual = thumbPreferences?.[preferenceKeyForPoint(point) ?? ''];
    const predicted = predictedPreferences?.[preferenceKeyForPoint(point) ?? ''];
    summary.trackCount += 1;
    if (actual === 'up') summary.actualUp += 1;
    if (actual === 'down') summary.actualDown += 1;
    if (!actual && predicted?.value === 'up') summary.predictedUp += 1;
    if (!actual && predicted?.value === 'down') summary.predictedDown += 1;
    summaries.set(artistName, summary);
  }
  return Array.from(summaries.values()).sort((a, b) => {
    const aStrength = Math.max(a.actualUp + a.predictedUp, a.actualDown + a.predictedDown);
    const bStrength = Math.max(b.actualUp + b.predictedUp, b.actualDown + b.predictedDown);
    return bStrength - aStrength || b.trackCount - a.trackCount || a.name.localeCompare(b.name);
  });
}

function slugForKey(value: string): string {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
}

function selectedVectorId(point: Point | null): string | null {
  return point?.metadata?.vector_id || null;
}

function pointsByTrackId(points: Point[]): Map<string, Point> {
  const map = new Map<string, Point>();
  for (const point of points) {
    const trackId = point.metadata?.track_id;
    if (trackId !== undefined && trackId !== null) map.set(String(trackId), point);
  }
  return map;
}

function linksForSelection(selected: Point | null, points: Point[]): SimilarityEdge[] {
  if (!selected || selected.kind !== 'artist') return [];
  const byTrackId = pointsByTrackId(points);
  return (selected.metadata?.tracks || [])
    .map((track) => byTrackId.get(String(track.track_id)))
    .filter((trackPoint): trackPoint is Point => Boolean(trackPoint))
    .map((trackPoint) => ({source: selected.id, target: trackPoint.id, similarity: null, distance: null}));
}

function selectRandomLinkedSong(edges: SimilarityEdge[], points: Point[], selected: Point | null, selectPoint: (point: PointLike, options?: {focus?: boolean}) => void): void {
  const ids = Array.from(new Set((edges || []).flatMap((edge) => [edge.source, edge.target])));
  const songs = ids
    .map((id) => points.find((point) => point.id === id))
    .filter((point): point is Point => Boolean(point && point.id !== selected?.id && (point.kind === 'track' || point.kind === 'user_track')));
  if (!songs.length) return;
  selectPoint(songs[Math.floor(Math.random() * songs.length)], {focus: true});
}

function isEditingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  const tagName = element?.tagName?.toLowerCase();
  return Boolean(element?.isContentEditable) || tagName === 'input' || tagName === 'textarea' || tagName === 'select';
}
