import AsyncStorage from '@react-native-async-storage/async-storage';

// A host:port isn't secret/credential material, so plain AsyncStorage is fine here - no need for
// the Keychain-backed expo-secure-store.
const STORAGE_KEY = 'ezbeq:serverConnection';

export type ServerConnection = {
  // e.g. "http://192.168.1.23:9968" - no trailing slash, includes scheme.
  baseUrl: string;
};

// Strips a trailing slash and rejects anything without an http(s) scheme, so every caller
// downstream (ezbeqApi/stateSocket) can assume a clean `${baseUrl}/api/...` join.
export const normalizeBaseUrl = (input: string): string => {
  const trimmed = input.trim().replace(/\/+$/, '');
  if (!/^https?:\/\/\S+$/i.test(trimmed)) {
    throw new Error(`Not a valid http(s) URL: ${input}`);
  }
  return trimmed;
};

export const deriveWsUrl = (baseUrl: string): string =>
  `${baseUrl.replace(/^http/i, 'ws')}/ws`;

export const loadServerConnection = async (): Promise<ServerConnection | null> => {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.baseUrl === 'string') {
      return { baseUrl: parsed.baseUrl };
    }
    return null;
  } catch {
    return null;
  }
};

export const saveServerConnection = async (connection: ServerConnection): Promise<void> => {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(connection));
};

export const clearServerConnection = async (): Promise<void> => {
  await AsyncStorage.removeItem(STORAGE_KEY);
};
