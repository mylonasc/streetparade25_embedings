import {describe, expect, it} from 'vitest';
import {buildArtistSummaries, buildLikedTrucks} from './artistSummary';
import type {ArtistSummary, Point, Prediction} from './types';

function trackPoint(id: number, artistName: string): Point {
  return {id: `track-${id}`, kind: 'track', label: `Track ${id}`, x: 0, y: 0, cluster: null, metadata: {artist_name: artistName, track_id: id}};
}

function predicted(key: string, score: number, value: 'up' | 'down'): Prediction {
  return {key, score, value};
}

describe('buildArtistSummaries like score', () => {
  it('weights sigmoid scores for predicted-liked songs and 1 for actually liked songs, over track count', () => {
    const points = [
      trackPoint(1, 'Alice'), // actual up -> +1
      trackPoint(2, 'Alice'), // actual down -> +0
      trackPoint(3, 'Alice'), // predicted up, score 0.8 -> +0.8
      trackPoint(4, 'Alice'), // predicted down -> +0
    ];
    const result = buildArtistSummaries(points, {
      'track:1': 'up',
      'track:2': 'down',
    }, {
      'track:3': predicted('track:3', 0.8, 'up'),
      'track:4': predicted('track:4', 0.9, 'down'),
    });
    expect(result).toHaveLength(1);
    expect(result[0].likeScore).toBeCloseTo((1 + 0.8) / 4, 5);
    expect(result[0].actualUp).toBe(1);
    expect(result[0].actualDown).toBe(1);
    expect(result[0].predictedUp).toBe(1);
    expect(result[0].predictedDown).toBe(1);
    expect(result[0].trackCount).toBe(4);
  });

  it('clamps sigmoid scores into [0, 1]', () => {
    const points = [trackPoint(1, 'Bob')];
    const result = buildArtistSummaries(points, {}, {
      'track:1': predicted('track:1', 1.4, 'up'),
    });
    expect(result[0].likeScore).toBe(1);
  });

  it('gives a zero score when there are no liked or predicted-liked songs', () => {
    const points = [trackPoint(1, 'Carol'), trackPoint(2, 'Carol')];
    const result = buildArtistSummaries(points, {}, {});
    expect(result[0].likeScore).toBe(0);
  });

  it('sorts artists by like score descending', () => {
    const points = [
      trackPoint(1, 'Alice'),
      trackPoint(2, 'Bob'),
      trackPoint(3, 'Carol'),
    ];
    const result = buildArtistSummaries(points, {}, {
      'track:1': predicted('track:1', 0.3, 'up'),
      'track:2': predicted('track:2', 0.9, 'up'),
      'track:3': predicted('track:3', 0.6, 'up'),
    });
    expect(result.map((artist) => artist.name)).toEqual(['Bob', 'Carol', 'Alice']);
  });
});

describe('buildArtistSummaries unlike score', () => {
  it('scores 1 for explicitly unliked songs and 1 - sigmoid for predicted songs, over track count', () => {
    const points = [
      trackPoint(1, 'Alice'), // actual down -> unlike +1
      trackPoint(2, 'Alice'), // actual up -> unlike +0
      trackPoint(3, 'Alice'), // predicted down, score 0.2 -> unlike +0.8
      trackPoint(4, 'Alice'), // predicted up, score 0.8 -> unlike +0.2
    ];
    const result = buildArtistSummaries(points, {
      'track:1': 'down',
      'track:2': 'up',
    }, {
      'track:3': predicted('track:3', 0.2, 'down'),
      'track:4': predicted('track:4', 0.8, 'up'),
    });
    expect(result).toHaveLength(1);
    expect(result[0].unlikeScore).toBeCloseTo((1 + 0.8 + 0.2) / 4, 5);
  });

  it('ignores unlabeled songs in the unlike score', () => {
    const points = [trackPoint(1, 'Bob'), trackPoint(2, 'Bob')];
    const result = buildArtistSummaries(points, {}, {});
    expect(result[0].unlikeScore).toBe(0);
  });

  it('clamps sigmoid scores in the unlike contribution', () => {
    const points = [trackPoint(1, 'Carol')];
    const result = buildArtistSummaries(points, {}, {
      'track:1': predicted('track:1', 1.4, 'up'),
    });
    expect(result[0].unlikeScore).toBe(0);
  });

  it('classifies artists with any down signal as likely unliked', () => {
    const points = [trackPoint(1, 'Dave')];
    const result = buildArtistSummaries(points, {}, {
      'track:1': predicted('track:1', 0.1, 'down'),
    });
    expect(result[0].unlikeScore).toBeGreaterThan(0);
  });
});

describe('buildLikedTrucks truck score', () => {
  const truck = (number: number, name: string) => ({number, name});
  const artist = (overrides: Partial<ArtistSummary>): ArtistSummary => ({
    key: 'a',
    name: 'A',
    point: {kind: 'artist', label: 'A', metadata: {}},
    trackCount: 1,
    actualUp: 0,
    actualDown: 0,
    predictedUp: 0,
    predictedDown: 0,
    likeScore: 0,
    unlikeScore: 0,
    artistPreference: null,
    loveMobiles: [],
    ...overrides,
  });

  it('averages the artist like scores that contribute to a shared truck', () => {
    const results = buildLikedTrucks([
      artist({key: 'a', name: 'Alice', likeScore: 0.8, loveMobiles: [truck(9, 'Truck 9')]}),
      artist({key: 'b', name: 'Bob', likeScore: 0.4, loveMobiles: [truck(9, 'Truck 9')]}),
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].score).toBeCloseTo(0.6, 5);
    expect(results[0].artists).toEqual(['Alice', 'Bob']);
  });

  it('skips artists that are neither liked nor likely liked', () => {
    const results = buildLikedTrucks([
      artist({key: 'a', name: 'Alice', likeScore: 0, loveMobiles: [truck(9, 'Truck 9')]}),
    ]);
    expect(results).toHaveLength(0);
  });

  it('collects each liked artist set slot on a shared truck', () => {
    const setTruck = (number: number, name: string, set_start: string, set_end: string) => ({number, name, set_start, set_end});
    const results = buildLikedTrucks([
      artist({key: 'a', name: 'Alice', likeScore: 0.8, loveMobiles: [setTruck(9, 'Truck 9', '13:00', '14:15')]}),
      artist({key: 'b', name: 'Bob', likeScore: 0.4, loveMobiles: [setTruck(9, 'Truck 9', '14:15', '15:30')]}),
    ]);
    expect(results[0].artistSlots).toEqual([
      {name: 'Alice', set_order: null, set_start: '13:00', set_end: '14:15'},
      {name: 'Bob', set_order: null, set_start: '14:15', set_end: '15:30'},
    ]);
  });
});
