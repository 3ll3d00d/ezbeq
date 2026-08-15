import { renderHook } from '@testing-library/react-native';
import { BackHandler, Platform } from 'react-native';

import { useTVBackHandler } from './useTVBackHandler';

// Spy directly on the real BackHandler/Platform exports rather than replacing the whole
// 'react-native' module - BackHandler.ios.js decides once, at module-evaluation time (long before
// this test file runs), whether Platform.isTV means it should wire up a real TVEventHandler-backed
// subscription or export a permanent no-op stub, so toggling Platform.isTV afterwards can't change
// which internal implementation is already loaded. Spying on the (already-loaded, non-TV-under-
// Jest) `addEventListener` function itself sidesteps that - this only needs to verify what
// useTVBackHandler itself does with the API it's given, not re-verify react-native-tvos's own
// already-confirmed BackHandler implementation (see useTVBackHandler.ts's comment). A full
// jest.mock('react-native', ...) replacement was tried first and rejected - `requireActual` there
// bypasses jest-expo's own native-module mocking setup and blows up on a real TurboModuleRegistry
// lookup ('DevMenu') that only jest-expo's controlled environment knows how to stub.
const mockRemove = jest.fn();

beforeEach(() => {
  jest.spyOn(Platform, 'isTV', 'get').mockReturnValue(true);
  jest.spyOn(BackHandler, 'addEventListener').mockReturnValue({ remove: mockRemove });
  mockRemove.mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('registers a hardwareBackPress listener when enabled on tvOS', async () => {
  await renderHook(() => useTVBackHandler(true, jest.fn()));

  expect(BackHandler.addEventListener).toHaveBeenCalledWith('hardwareBackPress', expect.any(Function));
});

test('invokes onBack and reports the event as handled', async () => {
  const onBack = jest.fn();
  await renderHook(() => useTVBackHandler(true, onBack));

  const handler = (BackHandler.addEventListener as jest.Mock).mock.calls[0][1];
  expect(handler()).toBe(true);
  expect(onBack).toHaveBeenCalledTimes(1);
});

test('does not register a listener when disabled', async () => {
  await renderHook(() => useTVBackHandler(false, jest.fn()));

  expect(BackHandler.addEventListener).not.toHaveBeenCalled();
});

test('does not register a listener off tvOS, even when enabled', async () => {
  jest.spyOn(Platform, 'isTV', 'get').mockReturnValue(false);

  await renderHook(() => useTVBackHandler(true, jest.fn()));

  expect(BackHandler.addEventListener).not.toHaveBeenCalled();
});

test('removes the listener on unmount', async () => {
  const { unmount } = await renderHook(() => useTVBackHandler(true, jest.fn()));

  await unmount();

  expect(mockRemove).toHaveBeenCalledTimes(1);
});
