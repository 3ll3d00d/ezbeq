import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useAsyncStorageState } from './useAsyncStorageState';

beforeEach(() => AsyncStorage.clear());

test('starts at the initial value while nothing is persisted', async () => {
  const { result } = await renderHook(() => useAsyncStorageState('k', 'default'));

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
