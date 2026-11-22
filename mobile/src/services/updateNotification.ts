import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  channelTrigger,
  ensureChannelAsync,
  loadNotifications,
  requestNotificationPermissionAsync,
} from './notifications';

export const UPDATE_NOTIFICATION_ID = 'ezbeq-update-available';
const ANDROID_CHANNEL_ID = 'update-available';
// Holds the last version a tray notification was raised for, so each release notifies once rather
// than on every launch/reconnect until the user updates. Read straight from AsyncStorage at the
// point of notifying (not via useAsyncStorageState) since that hook starts at its initial value
// until its async read lands, which would race the version fetch and could double-notify.
export const NOTIFIED_UPDATE_VERSION_KEY = 'notifiedUpdateVersion';

const RELEASES_URL = 'https://github.com/3ll3d00d/ezbeq/releases';

// The release page for `version`, or the releases list when no version is known.
export const releaseUrl = (version?: string): string => (version ? `${RELEASES_URL}/tag/${version}` : RELEASES_URL);

const recordNotified = (version: string) =>
  // Same {value} envelope useAsyncStorageState writes, so the key stays readable by that hook too.
  AsyncStorage.setItem(NOTIFIED_UPDATE_VERSION_KEY, JSON.stringify({ value: version }));

const readNotifiedVersion = async (): Promise<string | null> => {
  const item = await AsyncStorage.getItem(NOTIFIED_UPDATE_VERSION_KEY);
  if (!item) return null;
  try {
    return JSON.parse(item).value ?? null;
  } catch {
    return null;
  }
};

// Raises a tray notification for `version` unless this version has already been handled. Resolves
// true if a notification was shown. Permission is only requested here, i.e. when there is
// actually an update to tell the user about - and a refusal still marks the version as handled, so
// the system prompt appears at most once per release rather than on every launch/reconnect.
export const notifyUpdateAvailableOnce = async (version: string): Promise<boolean> => {
  if ((await readNotifiedVersion()) === version) return false;
  if (!(await requestNotificationPermissionAsync())) {
    await recordNotified(version);
    return false;
  }
  const Notifications = loadNotifications();
  await ensureChannelAsync(ANDROID_CHANNEL_ID, 'Update available');
  await Notifications.scheduleNotificationAsync({
    identifier: UPDATE_NOTIFICATION_ID,
    content: {
      title: 'ezbeq update available',
      body: `ezbeq ${version} is available. Tap to view the release.`,
      data: { url: releaseUrl(version) },
    },
    trigger: channelTrigger(ANDROID_CHANNEL_ID),
  });
  await recordNotified(version);
  return true;
};

type Response = import('expo-notifications').NotificationResponse;

// The release URL a tap on the update notification should open, or null if `response` is for
// some other notification/action.
export const urlForUpdateResponse = (response: Response | null | undefined): string | null => {
  if (!response || response.notification.request.identifier !== UPDATE_NOTIFICATION_ID) return null;
  const Notifications = loadNotifications();
  if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return null;
  const url = response.notification.request.content.data?.url;
  return typeof url === 'string' ? url : null;
};

// Calls `onUrl` for taps on the update notification - both while the app is running (listener)
// and for the tap that cold-launched it (last response, cleared once handled so a later remount
// e.g. after reconnecting doesn't reopen the browser).
export const addUpdateNotificationTapListener = (onUrl: (url: string) => void): (() => void) => {
  const Notifications = loadNotifications();
  const launchUrl = urlForUpdateResponse(Notifications.getLastNotificationResponse());
  if (launchUrl) {
    Notifications.clearLastNotificationResponse();
    onUrl(launchUrl);
  }
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const url = urlForUpdateResponse(response);
    if (url) {
      // A tap handled live is still recorded as the "last response" - clear it too, or the next
      // mount's launch check above would replay it.
      Notifications.clearLastNotificationResponse();
      onUrl(url);
    }
  });
  return () => subscription.remove();
};
