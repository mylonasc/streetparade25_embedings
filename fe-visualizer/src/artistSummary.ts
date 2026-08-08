import {preferenceKeyForPoint} from './selection';
import {truckNumber} from './loveMobile';
import type {ArtistSummary, LikedTruck, Point, PointLike, PreferenceValue, Prediction} from './types';

export function buildArtistSummaries(points: Point[], thumbPreferences: Record<string, string>, predictedPreferences: Record<string, Prediction>): ArtistSummary[] {
  const artistPoints = new Map(points.filter((point) => point.kind === 'artist').map((point) => [point.label, point as PointLike]));
  const summaries = new Map<string, ArtistSummary>();
  const likeScoreSums = new Map<string, number>();
  const unlikeScoreSums = new Map<string, number>();
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
      likeScore: 0,
      unlikeScore: 0,
      artistPreference: (thumbPreferences?.[preferenceKeyForPoint(artistPoint) ?? ''] as PreferenceValue | undefined) || null,
      loveMobiles: Array.isArray(artistPoint.metadata?.love_mobiles) ? artistPoint.metadata.love_mobiles : [],
    };
    const actual = thumbPreferences?.[preferenceKeyForPoint(point) ?? ''];
    const predicted = predictedPreferences?.[preferenceKeyForPoint(point) ?? ''];
    summary.trackCount += 1;
    let contribution = 0;
    let unlikeContribution = 0;
    if (actual === 'up') {
      summary.actualUp += 1;
      contribution = 1;
    } else if (actual === 'down') {
      summary.actualDown += 1;
      unlikeContribution = 1;
    } else if (predicted?.value === 'up') {
      summary.predictedUp += 1;
      contribution = clamp01(predicted.score);
      unlikeContribution = 1 - clamp01(predicted.score);
    } else if (predicted?.value === 'down') {
      summary.predictedDown += 1;
      unlikeContribution = 1 - clamp01(predicted.score);
    }
    if (contribution > 0) likeScoreSums.set(artistName, (likeScoreSums.get(artistName) || 0) + contribution);
    if (unlikeContribution > 0) unlikeScoreSums.set(artistName, (unlikeScoreSums.get(artistName) || 0) + unlikeContribution);
    summaries.set(artistName, summary);
  }
  return Array.from(summaries.values())
    .map((summary) => ({
      ...summary,
      likeScore: summary.trackCount ? (likeScoreSums.get(summary.name) || 0) / summary.trackCount : 0,
      unlikeScore: summary.trackCount ? (unlikeScoreSums.get(summary.name) || 0) / summary.trackCount : 0,
    }))
    .sort((a, b) => b.likeScore - a.likeScore || b.trackCount - a.trackCount || a.name.localeCompare(b.name));
}

export function slugForKey(value: string): string {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function buildLikedTrucks(artists: ArtistSummary[]): LikedTruck[] {
  const trucks = new Map<string, Omit<LikedTruck, 'score'> & {scoreSum: number; scoreCount: number}>();
  for (const artist of artists) {
    const isLoved = artist.artistPreference === 'up' || artist.likeScore > 0;
    if (!isLoved) continue;
    for (const truck of artist.loveMobiles) {
      const key = truck.uuid ?? `${truck.number ?? truck.source_index ?? truck.name ?? truck.title}`;
      const existing = trucks.get(key);
      const slot = {name: artist.name, set_order: truck.set_order ?? null, set_start: truck.set_start ?? null, set_end: truck.set_end ?? null};
      if (existing) {
        existing.artists.push(artist.name);
        existing.artistSlots.push(slot);
        existing.scoreSum += artist.likeScore;
        existing.scoreCount += 1;
      } else {
        trucks.set(key, {truck, artists: [artist.name], artistSlots: [slot], scoreSum: artist.likeScore, scoreCount: 1});
      }
    }
  }
  return Array.from(trucks.values())
    .map(({scoreSum, scoreCount, ...entry}) => ({...entry, score: scoreCount ? scoreSum / scoreCount : 0}))
    .sort((a, b) => String(truckNumber(a.truck)).localeCompare(String(truckNumber(b.truck)), undefined, {numeric: true}));
}
