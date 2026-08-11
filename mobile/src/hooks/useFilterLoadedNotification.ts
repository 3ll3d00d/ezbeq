import { useEffect, useRef } from 'react';

import {
  addFilterClearActionListener,
  CLEAR_FILTER_ACTION,
  clearFilterLoadedNotification,
  FILTER_NOTIFICATION_ID,
  isFilterNotificationSupported,
  requestFilterNotificationPermissionAsync,
  showFilterLoadedNotification,
} from '../services/filterNotification';
import type { DeviceState } from '../types/ezbeq';

// Mirrors deriveTxtFilterFromActiveSlot's notion of "loaded" in MainScreen.tsx - a slot only
// counts once it reports an actual filter title, not its unloaded/failed placeholders.
export const isFilterLoaded = (last?: string): boolean => Boolean(last && last !== 'Empty' && last !== 'ERROR');

type Params = {
  // The persisted user setting - the notification is fully inert (no permission prompt, no
  // listener, no expo-notifications import at all) whenever this is off, and likewise whenever
  // isFilterNotificationSupported() is false (see filterNotification.ts).
  enabled: boolean;
  device: DeviceState | null;
  activeSlotId: string | null;
  // Invoked with the loaded slot's id when the notification's "Clear Filter" action fires - pass
  // MainScreen's existing clearSlot so the notification goes through the exact same
  // api.clearSlot/replaceDevice/successMessage path as the on-screen clear button.
  onClear: (slotId: string) => void;
  onError: (e: Error) => void;
};

// Shows (and keeps updated) a persistent tray notification for as long as the selected device's
// active slot has a filter loaded, with a "Clear Filter" action wired back to the same clear path
// the SlotCard's own X button uses.
export const useFilterLoadedNotification = ({ enabled, device, activeSlotId, onClear, onError }: Params): void => {
  const supported = enabled && isFilterNotificationSupported();
  const activeSlot = device?.slots?.find((s) => s.id === activeSlotId);
  const loaded = supported && Boolean(device) && isFilterLoaded(activeSlot?.last);
  const shownRef = useRef(false);

  // Refs so the response listener below always sees the latest callback/slot id without needing
  // to tear down and resubscribe on every state change.
  const onClearRef = useRef(onClear);
  onClearRef.current = onClear;
  const activeSlotIdRef = useRef(activeSlotId);
  activeSlotIdRef.current = activeSlotId;

  useEffect(() => {
    if (!supported) return undefined;
    return addFilterClearActionListener((response) => {
      if (
        response.notification.request.identifier === FILTER_NOTIFICATION_ID &&
        response.actionIdentifier === CLEAR_FILTER_ACTION &&
        activeSlotIdRef.current
      ) {
        onClearRef.current(activeSlotIdRef.current);
      }
    });
  }, [supported]);

  useEffect(() => {
    if (!loaded || !device || !activeSlot) {
      if (shownRef.current) {
        shownRef.current = false;
        clearFilterLoadedNotification().catch(() => {});
      }
      return;
    }
    requestFilterNotificationPermissionAsync()
      .then((granted) => {
        if (!granted) return;
        shownRef.current = true;
        return showFilterLoadedNotification(device.name, activeSlot.last ?? '');
      })
      .catch((e) => onError(e as Error));
    // activeSlot is derived fresh every render from device/activeSlotId, so those two alone are
    // the real dependencies - re-running per new activeSlot object reference would refire this
    // effect (and its permission check) on every unrelated device update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, device?.name, activeSlot?.last, onError]);

  // Safety net for the notification outliving the screen it was raised from - e.g. the user
  // disconnects from the server (MainScreen unmounts back to ConnectScreen) while a filter is
  // still loaded. The effects above already dismiss it for every in-app state change; this only
  // covers the unmount case they can't.
  useEffect(() => {
    return () => {
      if (shownRef.current) {
        clearFilterLoadedNotification().catch(() => {});
      }
    };
  }, []);
};
