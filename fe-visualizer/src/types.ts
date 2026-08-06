export type PointKind = 'track' | 'user_track' | 'artist';

export type MetadataTracks = Array<{
  id?: number | string;
  track_id?: number | string;
  title?: string;
  label?: string;
  url?: string;
  source_url?: string;
}>;

export type LoveMobile = {
  id?: number | string;
  uuid?: string;
  source_index?: number;
  number?: number | string;
  name?: string;
  title?: string;
  genres?: string;
  motto?: string;
  time?: string;
  description?: string;
  image?: Record<string, unknown>;
  links?: Array<Record<string, unknown>>;
  source?: string;
  artist_name?: string;
  artist_bio?: string;
};

export type PointMetadata = {
  id?: number | string;
  track_id?: number | string;
  vector_id?: string;
  artist_name?: string;
  artist?: string;
  title?: string;
  url?: string;
  source_url?: string;
  source_type?: string;
  username?: string;
  cluster?: number;
  track_count?: number;
  tracks?: MetadataTracks;
  love_mobiles?: LoveMobile[];
  embedding_model?: string;
  model_name?: string;
  embedding_backend?: string;
  bpm?: number;
  [key: string]: unknown;
};

export type Point = {
  id: string;
  kind: PointKind;
  label: string;
  x: number;
  y: number;
  cluster: number | null;
  metadata: PointMetadata;
};

export type PointLike = {
  id?: string;
  kind: PointKind;
  label: string;
  metadata: PointMetadata;
};

export type VisualizationFeatures = {
  song_downloads_and_embeddings?: boolean;
  [key: string]: unknown;
};

export type VisualizationPayload = {
  signature?: string;
  points: Point[];
  point_count?: number;
  base_point_count?: number;
  artist_point_count?: number;
  user_point_count?: number;
  features?: VisualizationFeatures;
};

export type Stats = {
  point_count: number;
  base_point_count: number;
  artist_point_count: number;
  user_point_count: number;
};

export type PreferenceValue = 'up' | 'down';

export type Prediction = {
  key: string;
  score: number;
  value: PreferenceValue;
};

export type PreferenceMap = Record<string, PreferenceValue>;

export type PredictionMap = Record<string, Prediction>;

export type PreferenceTarget = {
  point_id: string;
  target_kind: PointKind;
  target_id: string;
  track_id: number | null;
  user_track_id: number | null;
  vector_id: string | null;
};

export type SimilarityEdge = {
  source: string;
  target: string;
  similarity: number | null;
  distance: number | null;
  metric?: string;
};

export type Edge = SimilarityEdge;

export type UserTrack = {
  id: number | string;
  title?: string;
  source_url?: string;
  source_type?: string;
  status?: string;
  last_error?: string | null;
  x?: number;
  y?: number;
  username?: string;
  [key: string]: unknown;
};

export type Track = {
  id: number | string;
  title?: string;
  url?: string;
  artist_name?: string;
  artist?: string;
  embedding?: number[];
  [key: string]: unknown;
};

export type TrackStatus = 'queued' | 'running' | 'completed' | 'failed';

export type Job = {
  id: string;
  status: TrackStatus;
  track?: {source_type?: string};
  [key: string]: unknown;
};

export type LayoutJob = Job;

export type ArtistSummary = {
  key: string;
  name: string;
  point: PointLike;
  trackCount: number;
  actualUp: number;
  actualDown: number;
  predictedUp: number;
  predictedDown: number;
  artistPreference: PreferenceValue | null;
  loveMobiles: LoveMobile[];
};

export type LikedTruck = {
  truck: LoveMobile;
  artists: string[];
};
