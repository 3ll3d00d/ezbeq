import { isRunningInExpoGo } from 'expo';
import { Platform } from 'react-native';

// Shared expo-notifications plumbing for every local notification the app raises (the persistent
// filter-loaded notification in filterNotification.ts, the update-available one in
// updateNotification.ts).

// expo-notifications runs push-token auto-registration as an import-time side effect
// (DevicePushTokenAutoRegistration.fx.ts calls addPushTokenListener() at module scope), which
// throws on Android in Expo Go since SDK 53 removed Expo Go's push support - merely *importing*
// the module crashes the app there, regardless of whether anything ever touches a push API. iOS
// Expo Go only logs a warning, so this is Android-only. Everything must check this before ever
// importing 'expo-notifications', and the import itself must stay dynamic (a static import would
// be hoisted and evaluated unconditionally, defeating the guard).
export const isNotificationSupported = (): boolean => !(Platform.OS === 'android' && isRunningInExpoGo());

export type NotificationsModule = typeof import('expo-notifications');

// Metro/Jest both resolve a plain `require()` synchronously (unlike ESM `import()`, which needs
// --experimental-vm-modules under Jest's Node runtime) - using it here, rather than a static
// top-level `import`, is what lets this whole module be loaded for free without ever touching
// expo-notifications' import-time side effects. tsconfig deliberately omits @types/node (it would
// leak Node globals like Buffer/process into the RN environment), so `require` needs this local
// ambient declaration rather than picking one up from there.
declare function require(id: string): unknown;

let cachedNotifications: NotificationsModule | null = null;

export const loadNotifications = (): NotificationsModule => {
  if (!cachedNotifications) {
    cachedNotifications = require('expo-notifications') as NotificationsModule;
    // The library's default handler suppresses foreground notifications entirely - both of the
    // app's notifications are raised while the app is open (it only ever runs in the foreground),
    // so they must show then too.
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

// Android delivers every notification on a named channel (which carries its importance); iOS has
// no equivalent. Keeping that difference here means the notification services never branch on
// Platform.OS themselves.
export const ensureChannelAsync = async (channelId: string, name: string): Promise<void> => {
  if (Platform.OS !== 'android') return;
  const Notifications = loadNotifications();
  await Notifications.setNotificationChannelAsync(channelId, {
    name,
    importance: Notifications.AndroidImportance.DEFAULT,
  });
};

// An immediate trigger - plain on iOS; on Android it must name the channel ensureChannelAsync
// created, or the notification won't pick up that channel's importance/behaviour.
export const channelTrigger = (channelId: string): { channelId: string } | null =>
  Platform.OS === 'android' ? { channelId } : null;

export const requestNotificationPermissionAsync = async (): Promise<boolean> => {
  const Notifications = loadNotifications();
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
};
