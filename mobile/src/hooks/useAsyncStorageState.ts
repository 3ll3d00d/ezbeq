import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Mirrors useLocalStorage in ui/src/services/util.js, adapted for AsyncStorage's async API -
// unlike localStorage, the persisted value can't be read synchronously on first render, so this
// starts at `initialValue` and swaps in the persisted value once the read resolves (there's a
// brief window on cold start where a stale-looking value shows, same tradeoff ServerContext makes
// for the paired-server connection). The third element, `loaded`, flips true once that read has
// settled - for callers that must not act on the initial value as if it were the user's choice
// (e.g. raising a notification the user has turned off).
export const useAsyncStorageState = <T,>(
  key: string,
  initialValue: T
): [T, (value: T | ((prev: T) => T)) => void, boolean] => {
  const [value, setValueState] = useState<T>(initialValue);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(key)
      .then((item) => {
        if (cancelled || !item) return;
        try {
          setValueState(JSON.parse(item).value);
        } catch {
          // malformed - keep initialValue
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoaded(true);
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

  return [value, setValue, loaded];
};
