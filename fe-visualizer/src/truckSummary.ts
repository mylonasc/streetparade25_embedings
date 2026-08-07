import {playlistForPoint} from './selection';
import type {PlaylistTrack} from './selection';
import type {ArtistSummary, Point} from './types';

export type TruckSummary = {
  point: Point;
  likeScore: number;
  artistCount: number;
  bestArtistName: string | null;
  artists: ArtistSummary[];
};

export type TruckSummaries = Map<string, TruckSummary>;

export function buildTruckSummaries(points: Point[], artistSummaries: ArtistSummary[]): TruckSummaries {
  const byName = new Map(artistSummaries.map((summary) => [summary.name, summary]));
  const summaries: TruckSummaries = new Map();
  for (const point of points) {
    if (point.kind !== 'truck') continue;
    const artistNames = (point.metadata?.artist_names || []).slice();
    const artists = artistNames
      .map((name) => byName.get(name))
      .filter((artist): artist is ArtistSummary => Boolean(artist));
    const likeScore = artists.length ? artists.reduce((sum, artist) => sum + artist.likeScore, 0) / artists.length : 0;
    const best = bestArtist(artists);
    summaries.set(point.id, {
      point,
      likeScore,
      artistCount: artists.length,
      bestArtistName: best?.name ?? null,
      artists,
    });
  }
  return summaries;
}

export function pickTruckArtist(truck: Point, summaries: TruckSummaries): ArtistSummary | null {
  const summary = summaries.get(truck.id);
  if (!summary || !summary.artists.length) return null;
  const best = bestArtist(summary.artists);
  if (best && best.likeScore > 0) return best;
  const index = Math.floor(Math.random() * summary.artists.length);
  return summary.artists[index] || null;
}

export function truckBestSong(truck: Point, summaries: TruckSummaries): PlaylistTrack | null {
  const artist = pickTruckArtist(truck, summaries);
  if (!artist) return null;
  const playlist = playlistForPoint(artist.point);
  if (playlist.length) return playlist[0];
  const fallback = summaries.get(truck.id)?.artists || [];
  for (const candidate of fallback) {
    const candidatePlaylist = playlistForPoint(candidate.point);
    if (candidatePlaylist.length) return candidatePlaylist[0];
  }
  return null;
}

function bestArtist(artists: ArtistSummary[]): ArtistSummary | null {
  if (!artists.length) return null;
  return artists.reduce((best, artist) => (artist.likeScore > best.likeScore ? artist : best));
}
