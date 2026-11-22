import {
  channelTrigger,
  ensureChannelAsync,
  isNotificationSupported,
  loadNotifications,
  requestNotificationPermissionAsync,
} from './notifications';

// A stable identifier makes re-showing the notification (e.g. the loaded filter's title changing)
// an in-place update rather than stacking a new notification every time.
export const FILTER_NOTIFICATION_ID = 'ezbeq-filter-loaded';
export const FILTER_NOTIFICATION_CATEGORY = 'ezbeq-filter-loaded-category';
export const CLEAR_FILTER_ACTION = 'ezbeq-clear-filter';
const ANDROID_CHANNEL_ID = 'filter-loaded';

// Kept under the filter-specific name for existing callers - the guard is shared (see notifications.ts).
export const isFilterNotificationSupported = isNotificationSupported;

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
      await ensureChannelAsync(ANDROID_CHANNEL_ID, 'Filter loaded');
    })();
  }
  return configured;
};

export const requestFilterNotificationPermissionAsync = requestNotificationPermissionAsync;

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
    trigger: channelTrigger(ANDROID_CHANNEL_ID),
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
