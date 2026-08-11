import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Mirrors useLocalStorage in ui/src/services/util.js, adapted for AsyncStorage's async API -
// unlike localStorage, the persisted value can't be read synchronously on first render, so this
// starts at `initialValue` and swaps in the persisted value once the read resolves (there's a
// brief window on cold start where a stale-looking value shows, same tradeoff ServerContext makes
// for the paired-server connection).
export const useAsyncStorageState = <T,>(
  key: string,
  initialValue: T
): [T, (value: T | ((prev: T) => T)) => void] => {
  const [value, setValueState] = useState<T>(initialValue);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(key).then((item) => {
      if (cancelled || !item) return;
      try {
        setValueState(JSON.parse(item).value);
      } catch {
        // malformed - keep initialValue
      }
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  const setValue = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValueState((prev) => {
        const resolved = next instanceof Function ? next(prev) : next;
        AsyncStorage.setItem(key, JSON.stringify({ value: resolved })).catch(() => {});
        return resolved;
      });
    },
    [key]
  );

  return [value, setValue];
};
