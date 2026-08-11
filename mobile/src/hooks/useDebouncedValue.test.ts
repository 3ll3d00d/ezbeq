import { act, renderHook } from '@testing-library/react-native';

import { useDebouncedValue } from './useDebouncedValue';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('returns the initial value immediately', async () => {
  const { result } = await renderHook(() => useDebouncedValue('a', 300));
  expect(result.current).toBe('a');
});

test('does not update until the delay elapses', async () => {
  const { result, rerender } = await renderHook(({ v }: { v: string }) => useDebouncedValue(v, 300), {
    initialProps: { v: 'a' },
  });

  await rerender({ v: 'b' });
  expect(result.current).toBe('a');

  await act(() => {
    jest.advanceTimersByTime(299);
  });
  expect(result.current).toBe('a');

  await act(() => {
    jest.advanceTimersByTime(1);
  });
  expect(result.current).toBe('b');
});

test('resets the timer on rapid successive changes, adopting only the final value', async () => {
  const { result, rerender } = await renderHook(({ v }: { v: string }) => useDebouncedValue(v, 300), {
    initialProps: { v: 'a' },
  });

  await rerender({ v: 'b' });
  await act(() => {
    jest.advanceTimersByTime(200);
  });
  await rerender({ v: 'c' });
  await act(() => {
    jest.advanceTimersByTime(200);
  });
  expect(result.current).toBe('a'); // still not 300ms since the last change ('c')

  await act(() => {
    jest.advanceTimersByTime(100);
  });
  expect(result.current).toBe('c');
});
