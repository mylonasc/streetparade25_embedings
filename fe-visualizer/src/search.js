export function pointSearchText(point) {
  const metadata = point.metadata || {};
  const flat = Object.entries(metadata)
    .filter(([, value]) => value !== null && value !== undefined && typeof value !== 'object')
    .map(([key, value]) => `${key} ${value}`)
    .join(' ');
  const artistTracks = (metadata.tracks || []).map((track) => `${track.title || ''} ${track.label || ''} ${track.url || ''}`).join(' ');
  return `${point.kind} ${point.label} ${flat} ${artistTracks}`.toLowerCase();
}

export function buildSearchIndex(points) {
  return new Map(points.map((point) => [point.id, pointSearchText(point)]));
}

export function searchResults(points, searchIndex, query) {
  const cleaned = query.trim().toLowerCase();
  if (!cleaned) return [];
  return points.filter((point) => searchIndex.get(point.id)?.includes(cleaned));
}
