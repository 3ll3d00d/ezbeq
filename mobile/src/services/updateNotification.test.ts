import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import {
  addUpdateNotificationTapListener,
  NOTIFIED_UPDATE_VERSION_KEY,
  notifyUpdateAvailableOnce,
  releaseUrl,
  UPDATE_NOTIFICATION_ID,
  urlForUpdateResponse,
} from './updateNotification';

jest.mock('expo', () => ({ isRunningInExpoGo: jest.fn().mockReturnValue(false) }));

const originalOS = Platform.OS;
afterEach(async () => {
  Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

const response = (identifier: string, actionIdentifier: string, data: Record<string, unknown> = {}) =>
  ({
    actionIdentifier,
    notification: { request: { identifier, content: { data } } },
  }) as unknown as Notifications.NotificationResponse;

const tap = (url = releaseUrl('2.13.5')) =>
  response(UPDATE_NOTIFICATION_ID, Notifications.DEFAULT_ACTION_IDENTIFIER, { url });

test('releaseUrl points at the GitHub release for the tag, or the releases list without one', () => {
  expect(releaseUrl('2.13.5')).toBe('https://github.com/3ll3d00d/ezbeq/releases/tag/2.13.5');
  expect(releaseUrl()).toBe('https://github.com/3ll3d00d/ezbeq/releases');
});

// First call into the service, so it also exercises the one-off Android channel setup.
test('notifyUpdateAvailableOnce raises the notification on the Android channel, then never again for that version', async () => {
  Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });

  expect(await notifyUpdateAvailableOnce('2.13.5')).toBe(true);
  expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledWith(
    'update-available',
    expect.objectContaining({ name: 'Update available' })
  );
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith({
    identifier: UPDATE_NOTIFICATION_ID,
    content: expect.objectContaining({
      title: 'ezbeq update available',
      body: expect.stringContaining('2.13.5'),
      data: { url: releaseUrl('2.13.5') },
    }),
    trigger: { channelId: 'update-available' },
  });
  expect(await AsyncStorage.getItem(NOTIFIED_UPDATE_VERSION_KEY)).toBe(JSON.stringify({ value: '2.13.5' }));

  (Notifications.scheduleNotificationAsync as jest.Mock).mockClear();
  expect(await notifyUpdateAvailableOnce('2.13.5')).toBe(false);
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
});

test('notifyUpdateAvailableOnce notifies again for a newer version, with an immediate trigger on iOS', async () => {
  Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
  await AsyncStorage.setItem(NOTIFIED_UPDATE_VERSION_KEY, JSON.stringify({ value: '2.13.5' }));

  expect(await notifyUpdateAvailableOnce('2.13.6')).toBe(true);
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(expect.objectContaining({ trigger: null }));
});

test.each(['not json', '{}'])('notifyUpdateAvailableOnce treats a stored %s as never notified', async (stored) => {
  await AsyncStorage.setItem(NOTIFIED_UPDATE_VERSION_KEY, stored);
  expect(await notifyUpdateAvailableOnce('2.13.5')).toBe(true);
});

test('notifyUpdateAvailableOnce shows nothing when permission is denied, and does not re-prompt for that version', async () => {
  (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValueOnce({ granted: false });
  (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValueOnce({ granted: false });

  expect(await notifyUpdateAvailableOnce('2.13.5')).toBe(false);
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(NOTIFIED_UPDATE_VERSION_KEY)).toBe(JSON.stringify({ value: '2.13.5' }));

  expect(await notifyUpdateAvailableOnce('2.13.5')).toBe(false);
  expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
});

describe('urlForUpdateResponse', () => {
  test('returns the release url for a tap on the update notification', () => {
    expect(urlForUpdateResponse(tap())).toBe(releaseUrl('2.13.5'));
  });

  test('ignores other notifications, other actions, missing urls and no response', () => {
    expect(urlForUpdateResponse(null)).toBeNull();
    expect(
      urlForUpdateResponse(response('ezbeq-filter-loaded', Notifications.DEFAULT_ACTION_IDENTIFIER, { url: 'x' }))
    ).toBeNull();
    expect(urlForUpdateResponse(response(UPDATE_NOTIFICATION_ID, 'ezbeq-clear-filter', { url: 'x' }))).toBeNull();
    expect(urlForUpdateResponse(response(UPDATE_NOTIFICATION_ID, Notifications.DEFAULT_ACTION_IDENTIFIER))).toBeNull();
  });
});

describe('addUpdateNotificationTapListener', () => {
  test('handles (and clears) the tap that launched the app', () => {
    (Notifications.getLastNotificationResponse as jest.Mock).mockReturnValueOnce(tap());
    const onUrl = jest.fn();

    addUpdateNotificationTapListener(onUrl);

    expect(onUrl).toHaveBeenCalledWith(releaseUrl('2.13.5'));
    expect(Notifications.clearLastNotificationResponse).toHaveBeenCalled();
  });

  test('handles live taps on the update notification only, and unsubscribes', () => {
    const remove = jest.fn();
    (Notifications.addNotificationResponseReceivedListener as jest.Mock).mockReturnValueOnce({ remove });
    const onUrl = jest.fn();

    const unsubscribe = addUpdateNotificationTapListener(onUrl);
    expect(onUrl).not.toHaveBeenCalled();
    const listener = (Notifications.addNotificationResponseReceivedListener as jest.Mock).mock.calls[0][0];

    listener(response('ezbeq-filter-loaded', 'ezbeq-clear-filter'));
    expect(onUrl).not.toHaveBeenCalled();

    listener(tap());
    expect(onUrl).toHaveBeenCalledWith(releaseUrl('2.13.5'));
    expect(Notifications.clearLastNotificationResponse).toHaveBeenCalled();

    unsubscribe();
    expect(remove).toHaveBeenCalled();
  });
});
