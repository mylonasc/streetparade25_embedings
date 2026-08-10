import {describe, expect, it} from 'vitest';
import {resolveApiBaseUrlFor} from './api';

const local = {hostname: 'localhost', pathname: '/', protocol: 'http:'};
const deployed = {hostname: 'magarathea.ddns.net', pathname: '/streetparade-navigator-2026/', protocol: 'https:'};

describe('API base URL resolution', () => {
  it('uses localhost API for loopback development without explicit config', () => {
    expect(resolveApiBaseUrlFor({location: local})).toBe('http://localhost:8000');
  });

  it('honours explicit API config on loopback', () => {
    expect(resolveApiBaseUrlFor({configured: 'http://127.0.0.1:9000/', location: local})).toBe('http://127.0.0.1:9000');
  });

  it('uses non-loopback explicit API config in deployed browsers', () => {
    expect(resolveApiBaseUrlFor({configured: 'https://api.example.test/root/', location: deployed})).toBe('https://api.example.test/root');
  });

  it('derives deployed API base from the module asset path', () => {
    expect(resolveApiBaseUrlFor({
      location: deployed,
      moduleUrl: 'https://magarathea.ddns.net/streetparade-navigator-2026/assets/index-abc.js',
    })).toBe('/streetparade-navigator-2026/api');
  });

  it('keeps deep links from changing the deployed API base', () => {
    expect(resolveApiBaseUrlFor({
      location: {...deployed, pathname: '/streetparade-navigator-2026/share/demo'},
      moduleUrl: 'https://magarathea.ddns.net/streetparade-navigator-2026/assets/index-abc.js',
    })).toBe('/streetparade-navigator-2026/api');
  });
});
