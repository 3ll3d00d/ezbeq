import { useEffect, useRef } from 'react';
import { Linking } from 'react-native';

import { isNotificationSupported } from '../services/notifications';
import { addUpdateNotificationTapListener, notifyUpdateAvailableOnce } from '../services/updateNotification';

type Params = {
  // False until every persisted input (the setting itself, the in-app dismissal) has been read
  // back from storage - until then `enabled`/`updateAvailable` reflect defaults, not the user's
  // choices, and acting on them could notify someone who turned this off or dismissed the version.
  ready: boolean;
  // The persisted user setting - fully inert (no permission prompt, no listener, no
  // expo-notifications import) when off or when notifications are unsupported (Expo Go on Android).
  enabled: boolean;
  // Already accounts for the in-app banner's per-version dismissal - a version the user has
  // dismissed in-app never raises a tray notification either.
  updateAvailable: boolean;
  latestVersion?: string;
  onError: (e: Error) => void;
};

// Raises a tray notification (once per release) when a newer ezbeq release is available, and
// opens the release page when it's tapped.
export const useUpdateNotification = ({ ready, enabled, updateAvailable, latestVersion, onError }: Params): void => {
  const active = enabled && isNotificationSupported();
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    if (!active) return undefined;
    return addUpdateNotificationTapListener((url) => {
      Linking.openURL(url).catch((e) => onErrorRef.current(e as Error));
    });
  }, [active]);

  useEffect(() => {
    if (!ready || !active || !updateAvailable || !latestVersion) return;
    notifyUpdateAvailableOnce(latestVersion).catch((e) => onErrorRef.current(e as Error));
  }, [ready, active, updateAvailable, latestVersion]);
};
