import {describe, expect, it} from 'vitest';
import {buildSearchIndex, searchResults} from './search.js';

const points = [
  {id: 'artist-1', kind: 'artist', label: 'Nina Zurich', metadata: {tracks: [{title: 'Rain Lift', url: 'https://soundcloud.com/nina/rain'}]}},
  {id: 'track-1', kind: 'track', label: 'Night Bus', metadata: {artist_name: 'Cem', url: 'https://example.test/night-bus', bpm: 132}},
  {id: 'user-track-1', kind: 'user_track', label: 'Upload A', metadata: {source_url: 'https://youtube.com/watch?v=abc', source_type: 'youtube'}},
];

describe('search helpers', () => {
  it('matches labels, metadata, nested artist tracks, and URLs', () => {
    const index = buildSearchIndex(points);
    expect(searchResults(points, index, 'nina')).toHaveLength(1);
    expect(searchResults(points, index, 'rain lift')).toHaveLength(1);
    expect(searchResults(points, index, '132')).toHaveLength(1);
    expect(searchResults(points, index, 'youtube.com')).toHaveLength(1);
  });

  it('returns no results for empty queries', () => {
    expect(searchResults(points, buildSearchIndex(points), '   ')).toEqual([]);
  });
});
