import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useAsyncStorageState } from './useAsyncStorageState';

beforeEach(() => AsyncStorage.clear());

test('starts at the initial value while nothing is persisted', async () => {
  const { result } = await renderHook(() => useAsyncStorageState('k', 'default'));

  expect(result.current[0]).toBe('default');
});

test('reports loaded once the read settles, whether or not anything was persisted', async () => {
  const { result } = await renderHook(() => useAsyncStorageState('k', 'default'));

  await waitFor(() => expect(result.current[2]).toBe(true));
  expect(result.current[0]).toBe('default');
});

test('ignores a read that settles after unmount', async () => {
  let resolve: (v: string | null) => void = () => {};
  jest.spyOn(AsyncStorage, 'getItem').mockReturnValueOnce(new Promise((r) => (resolve = r)));
  const errorSpy = jest.spyOn(console, 'error');

  const { result, unmount } = await renderHook(() => useAsyncStorageState('k', 'default'));
  await unmount();
  await act(async () => resolve(JSON.stringify({ value: 'late' })));

  expect(result.current[0]).toBe('default');
  expect(result.current[2]).toBe(false);
  expect(errorSpy).not.toHaveBeenCalled();
  errorSpy.mockRestore();
});

test('still reports loaded when the read fails, keeping the initial value', async () => {
  jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('io'));

  const { result } = await renderHook(() => useAsyncStorageState('k', 'default'));

  await waitFor(() => expect(result.current[2]).toBe(true));
  expect(result.current[0]).toBe('default');
});

test('swaps in a persisted value once the read resolves', async () => {
  await AsyncStorage.setItem('k', JSON.stringify({ value: 'persisted' }));

  const { result } = await renderHook(() => useAsyncStorageState('k', 'default'));

  await waitFor(() => expect(result.current[0]).toBe('persisted'));
});

test('setValue updates state and persists the new value', async () => {
  const { result } = await renderHook(() => useAsyncStorageState('k', 'default'));

  await act(() => result.current[1]('next'));

  expect(result.current[0]).toBe('next');
  expect(JSON.parse((await AsyncStorage.getItem('k'))!)).toEqual({ value: 'next' });
});

test('setValue accepts an updater function reading the previous value', async () => {
  const { result } = await renderHook(() => useAsyncStorageState('k', 1));

  await act(() => result.current[1]((prev) => prev + 1));

  expect(result.current[0]).toBe(2);
});

test('ignores malformed persisted JSON, keeping the initial value', async () => {
  await AsyncStorage.setItem('k', '{not json');

  const { result } = await renderHook(() => useAsyncStorageState('k', 'default'));

  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(result.current[0]).toBe('default');
});
