import {API_BASE_URL} from './api';
import type {PointKind, PointLike, PointMetadata, PreferenceTarget} from './types';

export type PlaylistTrack = {
  title: string;
  soundcloudUrl: string | null;
  localUrl: string | null;
};

type PreferenceTargetPoint = {id?: string; kind: PointKind; metadata: PointMetadata};

export function visibleMetadataEntries(metadata: Record<string, unknown>): Array<[string, unknown]> {
  const hidden = new Set(['url', 'source_url', 'path', 'vector_id', 'embedding_model', 'embedding_backend', 'model_name']);
  return Object.entries(metadata)
    .filter(([key, value]) => !hidden.has(key) && value !== null && value !== undefined && typeof value !== 'object');
}

export function modelSummary(metadata: Record<string, unknown>): string | null {
  const model = metadata.embedding_model || metadata.model_name;
  const backend = metadata.embedding_backend;
  if (!model && !backend) return null;
  return [backend, model].filter(Boolean).join(' / ');
}

export function playlistForPoint(point: PointLike): PlaylistTrack[] {
  const metadata = point.metadata || {};
  if (point.kind === 'artist') {
    return (metadata.tracks || [])
      .map((track) => playlistTrack(track.title || track.label || `Track ${track.track_id || ''}`, track.url || null, null))
      .filter((track): track is PlaylistTrack => Boolean(track));
  }
  const sourceUrl = metadata.url || metadata.source_url;
  const localUrl = point.kind === 'user_track' && metadata.source_type === 'youtube' && metadata.username
    ? `${API_BASE_URL}/users/${encodeURIComponent(metadata.username)}/tracks/${metadata.id}/audio`
    : null;
  return [playlistTrack(metadata.title || point.label, sourceUrl || null, localUrl)].filter((track): track is PlaylistTrack => Boolean(track));
}

export function playlistTrack(title: string, sourceUrl: string | null, localUrl: string | null): PlaylistTrack | null {
  const soundcloudUrl = sourceUrl && sourceUrl.includes('soundcloud.com') ? sourceUrl : null;
  if (!soundcloudUrl && !localUrl) return null;
  return {title: title || 'Untitled track', soundcloudUrl, localUrl};
}

export function isMarked(point: PointLike, marks: ReadonlySet<string>): boolean {
  return marks.has(markKey(point));
}

export function markKey(point: PointLike): string {
  return `${point.kind}:${point.metadata?.artist_name || point.metadata?.artist || point.label}`;
}

export function preferenceTarget(point: PreferenceTargetPoint): PreferenceTarget | null {
  if (!point || !['track', 'user_track', 'artist'].includes(point.kind)) return null;
  const metadata = point.metadata || {};
  if (point.kind === 'artist') {
    return {
      point_id: point.id || '',
      target_kind: 'artist',
      target_id: String(point.id),
      track_id: null,
      user_track_id: null,
      vector_id: null,
    };
  }
  if (point.kind === 'user_track') {
    const userTrackId = metadata.id ?? point.id?.replace(/^user-track-/, '');
    return {
      point_id: point.id || '',
      target_kind: 'user_track',
      target_id: String(userTrackId),
      user_track_id: numericOrNull(userTrackId),
      track_id: numericOrNull(metadata.track_id),
      vector_id: metadata.vector_id || null,
    };
  }
  const trackId = metadata.track_id ?? point.id?.replace(/^track-/, '');
  return {
    point_id: point.id || '',
    target_kind: 'track',
    target_id: String(trackId),
    track_id: numericOrNull(trackId),
    user_track_id: null,
    vector_id: metadata.vector_id || null,
  };
}

export function preferenceKeyForPoint(point: PreferenceTargetPoint): string | null {
  const target = preferenceTarget(point);
  return target ? `${target.target_kind}:${target.target_id}` : null;
}

function numericOrNull(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}
