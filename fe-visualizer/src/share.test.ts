import {describe, expect, it} from 'vitest';
import {serializeLikedTrucks, shareBlurb, soundcloudUrlFromLinks, soundcloudUrlFromTracks, telegramShareUrl, whatsAppShareUrl} from './share';

describe('telegramShareUrl', () => {
  it('builds a t.me share URL with encoded url and text', () => {
    expect(telegramShareUrl('https://magarathea.ddns.net/sp26-test/', 'Street Parade 2026 — explore the embedding visualizer map.'))
      .toBe('https://t.me/share/url?url=https%3A%2F%2Fmagarathea.ddns.net%2Fsp26-test%2F&text=Street%20Parade%202026%20%E2%80%94%20explore%20the%20embedding%20visualizer%20map.');
  });
});

describe('whatsAppShareUrl', () => {
  it('builds a wa.me share URL with encoded text plus link', () => {
    expect(whatsAppShareUrl('https://magarathea.ddns.net/sp26-test/', 'Hi'))
      .toBe('https://wa.me/?text=Hi%20https%3A%2F%2Fmagarathea.ddns.net%2Fsp26-test%2F');
  });
});

describe('serializeLikedTrucks', () => {
  it('flattens love mobiles into a serializable snapshot', () => {
    expect(serializeLikedTrucks([
      {truck: {number: 9, name: 'Magic Mountain', genres: 'Tech House', time: '15:04–19:04'}, artists: ['Cosmic Circle'], score: 0.83},
      {truck: {source_index: 3, title: 'Bass Wagon', time: '20:00–00:00'}, artists: ['DJ Bass']},
    ])).toEqual([
      {number: '9', name: 'Magic Mountain', genres: 'Tech House', time: '15:04–19:04', artists: ['Cosmic Circle'], score: 0.83, soundcloudUrl: ''},
      {number: '3', name: 'Bass Wagon', genres: '', time: '20:00–00:00', artists: ['DJ Bass'], score: 0, soundcloudUrl: ''},
    ]);
  });

  it('extracts the soundcloud url from love mobile links', () => {
    expect(serializeLikedTrucks([
      {truck: {number: 9, name: 'Magic Mountain', artist_links: [{type: 'soundcloud', url: 'https://soundcloud.com/magic-mountain'}]}, artists: ['Cosmic Circle'], score: 0.5},
    ])).toEqual([
      {number: '9', name: 'Magic Mountain', genres: '', time: '', artists: ['Cosmic Circle'], score: 0.5, soundcloudUrl: 'https://soundcloud.com/magic-mountain'},
    ]);
  });

  it('passes artist set slots through to the snapshot', () => {
    expect(serializeLikedTrucks([
      {truck: {number: 9, name: 'Magic Mountain'}, artists: ['Cosmic Circle'], artistSlots: [{name: 'Cosmic Circle', set_start: '15:04', set_end: '15:38'}], score: 0.83},
    ])).toEqual([
      {number: '9', name: 'Magic Mountain', genres: '', time: '', artists: ['Cosmic Circle'], artistSlots: [{name: 'Cosmic Circle', set_start: '15:04', set_end: '15:38'}], score: 0.83, soundcloudUrl: ''},
    ]);
  });
});

describe('soundcloudUrlFromLinks', () => {
  it('prefers the soundcloud type link and tolerates missing link lists', () => {
    expect(soundcloudUrlFromLinks([{type: 'website', url: 'https://example.com'}], [{type: 'soundcloud', url: 'https://soundcloud.com/adambeyer'}])).toBe('https://soundcloud.com/adambeyer');
    expect(soundcloudUrlFromLinks(undefined, null)).toBe('');
  });
});

describe('soundcloudUrlFromTracks', () => {
  it('finds the first soundcloud track url', () => {
    expect(soundcloudUrlFromTracks([{url: 'https://soundcloud.com/aiiamusic/aiia-season-opening'}])).toBe('https://soundcloud.com/aiiamusic/aiia-season-opening');
    expect(soundcloudUrlFromTracks([{url: 'https://example.com/x'}, {source_url: 'https://soundcloud.com/other/thing'}])).toBe('https://soundcloud.com/other/thing');
    expect(soundcloudUrlFromTracks([])).toBe('');
  });
});

describe('shareBlurb', () => {
  it('describes the shared favorites concisely', () => {
    expect(shareBlurb('harry', 2, 5)).toBe("harry's Street Parade 2026 favorites: 2 love mobiles and 5 acts.");
    expect(shareBlurb('harry', 0, 0)).toBe("harry's Street Parade 2026 favorites.");
  });
});
