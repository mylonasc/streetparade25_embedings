import {describe, expect, it} from 'vitest';
import {serializeLikedTrucks, shareBlurb, telegramShareUrl, whatsAppShareUrl} from './share';

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
      {number: '9', name: 'Magic Mountain', genres: 'Tech House', time: '15:04–19:04', artists: ['Cosmic Circle'], score: 0.83},
      {number: '3', name: 'Bass Wagon', genres: '', time: '20:00–00:00', artists: ['DJ Bass'], score: 0},
    ]);
  });
});

describe('shareBlurb', () => {
  it('describes the shared favorites concisely', () => {
    expect(shareBlurb('harry', 2, 5)).toBe("harry's Street Parade 2026 favorites: 2 love mobiles and 5 acts.");
    expect(shareBlurb('harry', 0, 0)).toBe("harry's Street Parade 2026 favorites.");
  });
});
