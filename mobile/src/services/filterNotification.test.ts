import { isRunningInExpoGo } from 'expo';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import {
  CLEAR_FILTER_ACTION,
  clearFilterLoadedNotification,
  configureFilterNotifications,
  FILTER_NOTIFICATION_CATEGORY,
  FILTER_NOTIFICATION_ID,
  isFilterNotificationSupported,
  requestFilterNotificationPermissionAsync,
  showFilterLoadedNotification,
} from './filterNotification';

jest.mock('expo', () => ({ isRunningInExpoGo: jest.fn().mockReturnValue(false) }));

const originalOS = Platform.OS;
afterEach(() => {
  Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
  jest.clearAllMocks();
});

test('isFilterNotificationSupported is false only for Android running in Expo Go', () => {
  (isRunningInExpoGo as jest.Mock).mockReturnValue(false);
  Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
  expect(isFilterNotificationSupported()).toBe(true);

  (isRunningInExpoGo as jest.Mock).mockReturnValue(true);
  expect(isFilterNotificationSupported()).toBe(false);

  Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
  expect(isFilterNotificationSupported()).toBe(true);
});

// Must run before anything else calls configureFilterNotifications (showFilterLoadedNotification
// below does too) - the module-level memoization this asserts on is a one-shot, process-lifetime
// guard, not something that resets between tests. This is also the first call into the service at
// all, so it's what exercises the lazy `require('expo-notifications')` registering the foreground
// handler on first use.
test('configureFilterNotifications registers the clear-filter action category exactly once', async () => {
  await configureFilterNotifications();
  await configureFilterNotifications();
  expect(Notifications.setNotificationHandler).toHaveBeenCalledWith(
    expect.objectContaining({ handleNotification: expect.any(Function) })
  );
  expect(Notifications.setNotificationCategoryAsync).toHaveBeenCalledTimes(1);
  expect(Notifications.setNotificationCategoryAsync).toHaveBeenCalledWith(FILTER_NOTIFICATION_CATEGORY, [
    expect.objectContaining({ identifier: CLEAR_FILTER_ACTION, buttonTitle: 'Clear Filter' }),
  ]);
});

test('requestFilterNotificationPermissionAsync short-circuits when already granted', async () => {
  (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValueOnce({ granted: true });
  const granted = await requestFilterNotificationPermissionAsync();
  expect(granted).toBe(true);
  expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
});

test('requestFilterNotificationPermissionAsync prompts when not yet granted', async () => {
  (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValueOnce({ granted: false });
  (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValueOnce({ granted: true });
  const granted = await requestFilterNotificationPermissionAsync();
  expect(granted).toBe(true);
  expect(Notifications.requestPermissionsAsync).toHaveBeenCalled();
});

test('requestFilterNotificationPermissionAsync reports denial', async () => {
  (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValueOnce({ granted: false });
  (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValueOnce({ granted: false });
  expect(await requestFilterNotificationPermissionAsync()).toBe(false);
});

test('showFilterLoadedNotification schedules a sticky, non-auto-dismissing notification under a stable id', async () => {
  await showFilterLoadedNotification('minidsp', 'Some Movie (2020)');
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
    expect.objectContaining({
      identifier: FILTER_NOTIFICATION_ID,
      content: expect.objectContaining({
        title: 'Filter loaded on minidsp',
        body: 'Some Movie (2020)',
        categoryIdentifier: FILTER_NOTIFICATION_CATEGORY,
        sticky: true,
        autoDismiss: false,
      }),
    })
  );
});

test('showFilterLoadedNotification targets the Android channel on Android', async () => {
  Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
  await showFilterLoadedNotification('minidsp', 'Some Movie (2020)');
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
    expect.objectContaining({ trigger: { channelId: 'filter-loaded' } })
  );
});

test('showFilterLoadedNotification fires immediately (no trigger) on iOS', async () => {
  Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
  await showFilterLoadedNotification('minidsp', 'Some Movie (2020)');
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(expect.objectContaining({ trigger: null }));
});

test('clearFilterLoadedNotification dismisses the stable notification id', async () => {
  await clearFilterLoadedNotification();
  expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith(FILTER_NOTIFICATION_ID);
});
