import {describe, expect, it} from 'vitest';
import {buildArtistSummaries} from './artistSummary';
import {buildTruckSummaries, pickTruckArtist, truckBestSong} from './truckSummary';
import type {Point} from './types';

function artistPoint(id: string, name: string, trackIds: number[]): Point {
  return {
    id,
    kind: 'artist',
    label: name,
    x: 0,
    y: 0,
    cluster: null,
    metadata: {
      artist_name: name,
      tracks: trackIds.map((trackId) => ({
        id: `track-${trackId}`,
        track_id: trackId,
        title: `Track ${trackId}`,
        url: `https://soundcloud.com/artist/track-${trackId}`,
      })),
    },
  };
}

function trackPoint(id: number, artistName: string): Point {
  return {id: `track-${id}`, kind: 'track', label: `Track ${id}`, x: 0, y: 0, cluster: null, metadata: {artist_name: artistName, track_id: id}};
}

function truckPoint(id: string, artistNames: string[]): Point {
  return {id, kind: 'truck', label: `Truck ${id}`, x: 0, y: 0, cluster: null, metadata: {artist_names: artistNames}};
}

function build(points: Point[], thumbPreferences: Record<string, string>) {
  const artistSummaries = buildArtistSummaries(points, thumbPreferences, {});
  return buildTruckSummaries(points, artistSummaries);
}

describe('buildTruckSummaries', () => {
  it('averages the like scores of the artists assigned to a truck', () => {
    const points = [
      trackPoint(1, 'Alice'),
      trackPoint(2, 'Alice'),
      trackPoint(3, 'Bob'),
      artistPoint('artist-alice', 'Alice', [1, 2]),
      artistPoint('artist-bob', 'Bob', [3]),
      truckPoint('truck-1', ['Alice', 'Bob']),
    ];
    const summaries = build(points, {'track:1': 'up'});
    const summary = summaries.get('truck-1');
    expect(summary?.artistCount).toBe(2);
    // Alice 0.5 (one of two tracks liked), Bob 0 -> 0.25
    expect(summary?.likeScore).toBeCloseTo(0.25, 5);
  });

  it('gives a zero score when a truck has no artists on the map', () => {
    const summaries = build([truckPoint('truck-2', ['Nobody'])], {});
    const summary = summaries.get('truck-2');
    expect(summary?.artistCount).toBe(0);
    expect(summary?.likeScore).toBe(0);
    expect(summary?.bestArtistName).toBeNull();
  });
});

describe('pickTruckArtist', () => {
  it('picks the highest-scoring artist', () => {
    const points = [
      trackPoint(1, 'Alice'),
      trackPoint(2, 'Bob'),
      artistPoint('artist-alice', 'Alice', [1]),
      artistPoint('artist-bob', 'Bob', [2]),
      truckPoint('truck-1', ['Alice', 'Bob']),
    ];
    const summaries = build(points, {'track:1': 'up'});
    const truck = points.find((point) => point.id === 'truck-1') as Point;
    expect(pickTruckArtist(truck, summaries)?.name).toBe('Alice');
  });

  it('falls back to a random artist when none has a positive score', () => {
    const points = [
      trackPoint(1, 'Alice'),
      trackPoint(2, 'Bob'),
      artistPoint('artist-alice', 'Alice', [1]),
      artistPoint('artist-bob', 'Bob', [2]),
      truckPoint('truck-1', ['Alice', 'Bob']),
    ];
    const summaries = build(points, {});
    const truck = points.find((point) => point.id === 'truck-1') as Point;
    const artist = pickTruckArtist(truck, summaries);
    expect(['Alice', 'Bob']).toContain(artist?.name);
  });
});

describe('truckBestSong', () => {
  it('returns the first playable song of the best artist', () => {
    const points = [
      trackPoint(1, 'Alice'),
      trackPoint(2, 'Bob'),
      artistPoint('artist-alice', 'Alice', [1]),
      artistPoint('artist-bob', 'Bob', [2]),
      truckPoint('truck-1', ['Alice', 'Bob']),
    ];
    const summaries = build(points, {'track:1': 'up'});
    const truck = points.find((point) => point.id === 'truck-1') as Point;
    const song = truckBestSong(truck, summaries);
    expect(song?.title).toBe('Track 1');
    expect(song?.soundcloudUrl).toContain('soundcloud.com');
  });

  it('returns null when no artist has a playable song', () => {
    const truck = truckPoint('truck-2', ['Nobody']);
    const summaries = build([truck], {});
    expect(truckBestSong(truck, summaries)).toBeNull();
  });
});
