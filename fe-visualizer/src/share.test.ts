import {describe, expect, it} from 'vitest';
import {telegramShareUrl, whatsAppShareUrl} from './share';

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
