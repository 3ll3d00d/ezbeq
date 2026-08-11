import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  clearServerConnection,
  deriveWsUrl,
  loadServerConnection,
  normalizeBaseUrl,
  saveServerConnection,
} from './serverConfig';

beforeEach(() => AsyncStorage.clear());

describe('normalizeBaseUrl', () => {
  it('strips a trailing slash', () => {
    expect(normalizeBaseUrl('http://192.168.1.23:9968/')).toBe('http://192.168.1.23:9968');
  });

  it('leaves an already-clean URL alone', () => {
    expect(normalizeBaseUrl('https://ezbeq.example.com')).toBe('https://ezbeq.example.com');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeBaseUrl('  http://host:8080  ')).toBe('http://host:8080');
  });

  it('rejects a URL without an http(s) scheme', () => {
    expect(() => normalizeBaseUrl('192.168.1.23:9968')).toThrow();
  });

  it('rejects an empty string', () => {
    expect(() => normalizeBaseUrl('')).toThrow();
  });
});

describe('deriveWsUrl', () => {
  it('derives ws:// from http://', () => {
    expect(deriveWsUrl('http://host:8080')).toBe('ws://host:8080/ws');
  });

  it('derives wss:// from https://', () => {
    expect(deriveWsUrl('https://host:8080')).toBe('wss://host:8080/ws');
  });
});

describe('server connection persistence', () => {
  it('returns null when nothing has been saved', async () => {
    expect(await loadServerConnection()).toBeNull();
  });

  it('round-trips a saved connection', async () => {
    await saveServerConnection({ baseUrl: 'http://host:8080' });
    expect(await loadServerConnection()).toEqual({ baseUrl: 'http://host:8080' });
  });

  it('clears a saved connection', async () => {
    await saveServerConnection({ baseUrl: 'http://host:8080' });
    await clearServerConnection();
    expect(await loadServerConnection()).toBeNull();
  });

  it('returns null for malformed stored JSON rather than throwing', async () => {
    await AsyncStorage.setItem('ezbeq:serverConnection', '{not json');
    expect(await loadServerConnection()).toBeNull();
  });

  it('returns null when the stored shape is missing baseUrl', async () => {
    await AsyncStorage.setItem('ezbeq:serverConnection', JSON.stringify({ notBaseUrl: 'x' }));
    expect(await loadServerConnection()).toBeNull();
  });
});
