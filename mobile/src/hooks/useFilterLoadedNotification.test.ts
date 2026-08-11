import { act, renderHook } from '@testing-library/react-native';

import {
  addFilterClearActionListener,
  CLEAR_FILTER_ACTION,
  clearFilterLoadedNotification,
  FILTER_NOTIFICATION_ID,
  isFilterNotificationSupported,
  requestFilterNotificationPermissionAsync,
  showFilterLoadedNotification,
} from '../services/filterNotification';
import { isFilterLoaded, useFilterLoadedNotification } from './useFilterLoadedNotification';
import type { DeviceState } from '../types/ezbeq';

jest.mock('../services/filterNotification', () => ({
  configureFilterNotifications: jest.fn().mockResolvedValue(undefined),
  requestFilterNotificationPermissionAsync: jest.fn().mockResolvedValue(true),
  showFilterLoadedNotification: jest.fn().mockResolvedValue(undefined),
  clearFilterLoadedNotification: jest.fn().mockResolvedValue(undefined),
  addFilterClearActionListener: jest.fn().mockReturnValue(jest.fn()),
  isFilterNotificationSupported: jest.fn().mockReturnValue(true),
  CLEAR_FILTER_ACTION: 'ezbeq-clear-filter',
  FILTER_NOTIFICATION_ID: 'ezbeq-filter-loaded',
}));

const flush = () => act(async () => {});

type Params = Parameters<typeof useFilterLoadedNotification>[0];

const device = (overrides: Partial<DeviceState> = {}): DeviceState => ({
  name: 'minidsp',
  type: 'minidsp',
  connected: true,
  slots: [{ id: '1', active: true, last: 'Some Movie (2020)' }],
  ...overrides,
});

const baseParams = () => ({
  enabled: true,
  device: device(),
  activeSlotId: '1',
  onClear: jest.fn(),
  onError: jest.fn(),
});

afterEach(() => jest.clearAllMocks());

describe('isFilterLoaded', () => {
  test('false for undefined/Empty/ERROR', () => {
    expect(isFilterLoaded(undefined)).toBe(false);
    expect(isFilterLoaded('Empty')).toBe(false);
    expect(isFilterLoaded('ERROR')).toBe(false);
  });

  test('true for an actual filter title', () => {
    expect(isFilterLoaded('Some Movie (2020)')).toBe(true);
  });
});

test('does nothing while disabled', async () => {
  await renderHook(() => useFilterLoadedNotification({ ...baseParams(), enabled: false }));
  await flush();
  expect(showFilterLoadedNotification).not.toHaveBeenCalled();
  expect(addFilterClearActionListener).not.toHaveBeenCalled();
});

test('does nothing when unsupported (Expo Go on Android), even if enabled', async () => {
  (isFilterNotificationSupported as jest.Mock).mockReturnValueOnce(false);
  await renderHook(() => useFilterLoadedNotification(baseParams()));
  await flush();
  expect(showFilterLoadedNotification).not.toHaveBeenCalled();
  expect(addFilterClearActionListener).not.toHaveBeenCalled();
  expect(requestFilterNotificationPermissionAsync).not.toHaveBeenCalled();
});

test('shows the notification once permission is granted and a filter is loaded on the active slot', async () => {
  await renderHook(() => useFilterLoadedNotification(baseParams()));
  await flush();
  expect(showFilterLoadedNotification).toHaveBeenCalledWith('minidsp', 'Some Movie (2020)');
});

test('does not show anything when the active slot has no filter loaded', async () => {
  const params = baseParams();
  params.device = device({ slots: [{ id: '1', active: true, last: 'Empty' }] });
  await renderHook(() => useFilterLoadedNotification(params));
  await flush();
  expect(showFilterLoadedNotification).not.toHaveBeenCalled();
});

test('clears the notification when the loaded filter goes away', async () => {
  const params = baseParams();
  const { rerender } = await renderHook((p: Params) => useFilterLoadedNotification(p), { initialProps: params });
  await flush();
  expect(showFilterLoadedNotification).toHaveBeenCalledTimes(1);

  await rerender({ ...params, device: device({ slots: [{ id: '1', active: true, last: 'Empty' }] }) });
  await flush();
  expect(clearFilterLoadedNotification).toHaveBeenCalledTimes(1);
});

test('clears the notification when disabled after having been shown', async () => {
  const params = baseParams();
  const { rerender } = await renderHook((p: Params) => useFilterLoadedNotification(p), { initialProps: params });
  await flush();
  expect(showFilterLoadedNotification).toHaveBeenCalledTimes(1);

  await rerender({ ...params, enabled: false });
  await flush();
  expect(clearFilterLoadedNotification).toHaveBeenCalledTimes(1);
});

test('invokes onClear with the active slot id when the Clear Filter action fires', async () => {
  const params = baseParams();
  await renderHook(() => useFilterLoadedNotification(params));
  await flush();

  const listener = (addFilterClearActionListener as jest.Mock).mock.calls[0][0];
  listener({
    notification: { request: { identifier: FILTER_NOTIFICATION_ID } },
    actionIdentifier: CLEAR_FILTER_ACTION,
  });

  expect(params.onClear).toHaveBeenCalledWith('1');
});

test('ignores responses for other notifications or actions', async () => {
  const params = baseParams();
  await renderHook(() => useFilterLoadedNotification(params));
  await flush();

  const listener = (addFilterClearActionListener as jest.Mock).mock.calls[0][0];
  listener({
    notification: { request: { identifier: 'some-other-notification' } },
    actionIdentifier: CLEAR_FILTER_ACTION,
  });
  listener({
    notification: { request: { identifier: FILTER_NOTIFICATION_ID } },
    actionIdentifier: 'expo.modules.notifications.actions.DEFAULT',
  });

  expect(params.onClear).not.toHaveBeenCalled();
});

test('unsubscribes the action listener on cleanup', async () => {
  const remove = jest.fn();
  (addFilterClearActionListener as jest.Mock).mockReturnValueOnce(remove);
  const params = baseParams();
  const { unmount } = await renderHook(() => useFilterLoadedNotification(params));
  await flush();

  await act(async () => unmount());
  expect(remove).toHaveBeenCalledTimes(1);
});

test('dismisses the notification on unmount if it was showing', async () => {
  const params = baseParams();
  const { unmount } = await renderHook(() => useFilterLoadedNotification(params));
  await flush();
  expect(showFilterLoadedNotification).toHaveBeenCalledTimes(1);

  await act(async () => unmount());
  expect(clearFilterLoadedNotification).toHaveBeenCalledTimes(1);
});
