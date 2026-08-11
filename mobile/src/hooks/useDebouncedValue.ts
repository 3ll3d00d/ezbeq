import { useEffect, useState } from 'react';

// Mirrors debounceTxtFilter in ui/src/components/main/index.jsx (a lodash debounce wrapping
// setDebouncedTxtFilter), as a reusable hook rather than a one-off instance - other fields
// (e.g. later filter dimensions) can reuse this instead of hand-rolling their own debounce.
export const useDebouncedValue = <T,>(value: T, delayMs: number): T => {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
};
