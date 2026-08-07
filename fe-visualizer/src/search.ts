import type {PointKind} from './types';

type SearchablePoint = {
  id: string;
  kind: PointKind;
  label: string;
  metadata: Record<string, unknown>;
};

export function pointSearchText<T extends SearchablePoint>(point: T): string {
  const metadata = point.metadata || {};
  const flat = Object.entries(metadata)
    .filter(([, value]) => value !== null && value !== undefined && typeof value !== 'object')
    .map(([key, value]) => `${key} ${value}`)
    .join(' ');
  const artistNames = Array.isArray(metadata.artist_names) ? (metadata.artist_names as unknown[]).join(' ') : '';
  const artistTracks = ((metadata.tracks as Array<{title?: string; label?: string; url?: string}> | undefined) || [])
    .map((track) => `${track.title || ''} ${track.label || ''} ${track.url || ''}`)
    .join(' ');
  const bestSong = (metadata.best_song as {title?: string; url?: string} | undefined);
  const bestSongText = bestSong ? `${bestSong.title || ''} ${bestSong.url || ''}` : '';
  return `${point.kind} ${point.label} ${flat} ${artistNames} ${artistTracks} ${bestSongText}`.toLowerCase();
}

export function buildSearchIndex<T extends SearchablePoint>(points: T[]): Map<string, string> {
  return new Map(points.map((point) => [point.id, pointSearchText(point)]));
}

export function searchResults<T extends SearchablePoint>(points: T[], searchIndex: Map<string, string>, query: string): T[] {
  const cleaned = query.trim().toLowerCase();
  if (!cleaned) return [];
  return points.filter((point) => searchIndex.get(point.id)?.includes(cleaned));
}
