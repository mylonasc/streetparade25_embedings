import {describe, expect, it} from 'vitest';
import {markKey, modelSummary, playlistForPoint, playlistTrack, preferenceKeyForPoint, preferenceTarget, visibleMetadataEntries} from './selection.js';

describe('selection helpers', () => {
  it('creates playlists for artist and soundcloud points', () => {
    expect(playlistForPoint({
      kind: 'artist',
      label: 'Artist',
      metadata: {tracks: [{title: 'Song A', url: 'https://soundcloud.com/a/song'}, {title: 'Video', url: 'https://youtube.com/v'}]},
    })).toEqual([{title: 'Song A', soundcloudUrl: 'https://soundcloud.com/a/song', localUrl: null}]);

    expect(playlistForPoint({
      kind: 'track',
      label: 'Song B',
      metadata: {url: 'https://soundcloud.com/b/song'},
    })).toEqual([{title: 'Song B', soundcloudUrl: 'https://soundcloud.com/b/song', localUrl: null}]);
  });

  it('creates local audio URLs for youtube user tracks', () => {
    expect(playlistForPoint({
      kind: 'user_track',
      label: 'Upload',
      metadata: {id: 9, username: 'alex', source_type: 'youtube', source_url: 'https://youtube.com/watch?v=abc'},
    })[0].localUrl).toContain('/users/alex/tracks/9/audio');
  });

  it('filters hidden metadata and summarizes model fields', () => {
    expect(visibleMetadataEntries({title: 'Song', vector_id: 'hidden', bpm: 128})).toEqual([['title', 'Song'], ['bpm', 128]]);
    expect(modelSummary({embedding_backend: 'openl3', embedding_model: 'music'})).toBe('openl3 / music');
  });

  it('builds stable mark keys', () => {
    expect(markKey({kind: 'track', label: 'Fallback', metadata: {artist_name: 'DJ A'}})).toBe('track:DJ A');
    expect(playlistTrack('Video', 'https://youtube.com/v', null)).toBeNull();
  });

  it('builds preference targets for base and user songs', () => {
    const track = {id: 'track-7', kind: 'track', metadata: {track_id: 7, vector_id: 'v7'}};
    expect(preferenceKeyForPoint(track)).toBe('track:7');
    expect(preferenceTarget(track)).toMatchObject({target_kind: 'track', target_id: '7', track_id: 7, vector_id: 'v7'});

    const userTrack = {id: 'user-track-3', kind: 'user_track', metadata: {id: 3, track_id: 9}};
    expect(preferenceKeyForPoint(userTrack)).toBe('user_track:3');
    expect(preferenceTarget(userTrack)).toMatchObject({target_kind: 'user_track', target_id: '3', user_track_id: 3, track_id: 9});

    const artist = {id: 'artist-nina', kind: 'artist', label: 'Nina', metadata: {artist_name: 'Nina'}};
    expect(preferenceKeyForPoint(artist)).toBe('artist:artist-nina');
    expect(preferenceTarget(artist)).toMatchObject({target_kind: 'artist', target_id: 'artist-nina'});
  });
});
