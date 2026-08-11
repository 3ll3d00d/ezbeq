import { isRunningInExpoGo } from 'expo';
import { Platform } from 'react-native';

// A stable identifier makes re-showing the notification (e.g. the loaded filter's title changing)
// an in-place update rather than stacking a new notification every time.
export const FILTER_NOTIFICATION_ID = 'ezbeq-filter-loaded';
export const FILTER_NOTIFICATION_CATEGORY = 'ezbeq-filter-loaded-category';
export const CLEAR_FILTER_ACTION = 'ezbeq-clear-filter';
const ANDROID_CHANNEL_ID = 'filter-loaded';

// expo-notifications runs push-token auto-registration as an import-time side effect
// (DevicePushTokenAutoRegistration.fx.ts calls addPushTokenListener() at module scope), which
// throws on Android in Expo Go since SDK 53 removed Expo Go's push support - merely *importing*
// the module crashes the app there, regardless of whether anything in this file ever touches a
// push API. iOS Expo Go only logs a warning, so this is Android-only. Everything in this module
// must check this before ever importing 'expo-notifications', and the import itself must stay
// dynamic (a static import would be hoisted and evaluated unconditionally, defeating the guard).
export const isFilterNotificationSupported = (): boolean => !(Platform.OS === 'android' && isRunningInExpoGo());

type NotificationsModule = typeof import('expo-notifications');

// Metro/Jest both resolve a plain `require()` synchronously (unlike ESM `import()`, which needs
// --experimental-vm-modules under Jest's Node runtime) - using it here, rather than a static
// top-level `import`, is what lets this whole module be loaded for free without ever touching
// expo-notifications' import-time side effects. tsconfig deliberately omits @types/node (it would
// leak Node globals like Buffer/process into the RN environment), so `require` needs this local
// ambient declaration rather than picking one up from there.
declare function require(id: string): unknown;

let cachedNotifications: NotificationsModule | null = null;

const loadNotifications = (): NotificationsModule => {
  if (!cachedNotifications) {
    cachedNotifications = require('expo-notifications') as NotificationsModule;
    // The library's default handler suppresses foreground notifications entirely - this
    // notification exists specifically to sit in the tray while the app is open and in use, so it
    // must show then too.
    cachedNotifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
  }
  return cachedNotifications;
};

let configured: Promise<void> | null = null;

// Registers the "Clear Filter" action/category and (Android only) the notification channel that
// carries it - both one-time setup, safe to call before every show since it memoizes.
export const configureFilterNotifications = async (): Promise<void> => {
  if (!configured) {
    configured = (async () => {
      const Notifications = loadNotifications();
      await Notifications.setNotificationCategoryAsync(FILTER_NOTIFICATION_CATEGORY, [
        {
          identifier: CLEAR_FILTER_ACTION,
          buttonTitle: 'Clear Filter',
          options: { opensAppToForeground: false },
        },
      ]);
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
          name: 'Filter loaded',
          importance: Notifications.AndroidImportance.DEFAULT,
        });
      }
    })();
  }
  return configured;
};

export const requestFilterNotificationPermissionAsync = async (): Promise<boolean> => {
  const Notifications = loadNotifications();
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
};

export const showFilterLoadedNotification = async (deviceName: string, filterTitle: string): Promise<void> => {
  const Notifications = loadNotifications();
  await configureFilterNotifications();
  await Notifications.scheduleNotificationAsync({
    identifier: FILTER_NOTIFICATION_ID,
    content: {
      title: `Filter loaded on ${deviceName}`,
      body: filterTitle,
      categoryIdentifier: FILTER_NOTIFICATION_CATEGORY,
      // sticky (Android's "ongoing") is what keeps this un-swipe-away-able - the whole point of a
      // *persistent* notification. iOS has no equivalent; autoDismiss only stops it from
      // self-clearing when tapped, it can still be swiped away there.
      sticky: true,
      autoDismiss: false,
    },
    // A plain immediate trigger on iOS; Android additionally needs the channel named so the
    // notification actually lands on the channel configureFilterNotifications created (and thus
    // picks up that channel's importance/behaviour).
    trigger: Platform.OS === 'android' ? { channelId: ANDROID_CHANNEL_ID } : null,
  });
};

export const clearFilterLoadedNotification = async (): Promise<void> => {
  const Notifications = loadNotifications();
  await Notifications.dismissNotificationAsync(FILTER_NOTIFICATION_ID);
};

export const addFilterClearActionListener = (
  listener: (response: import('expo-notifications').NotificationResponse) => void
): (() => void) => {
  const Notifications = loadNotifications();
  const subscription = Notifications.addNotificationResponseReceivedListener(listener);
  return () => subscription.remove();
};
