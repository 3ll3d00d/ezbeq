import { useEffect } from 'react';
import { BackHandler, Platform } from 'react-native';

// tvOS's remote Menu button is surfaced through the same `hardwareBackPress` BackHandler event
// Android's hardware back button uses (confirmed from react-native-tvos's own
// BackHandler.ios.js - "tvOS: Detect presses of the menu button on the TV remote"), and
// @react-navigation/native's NavigationContainer already registers its own listener on this event
// to pop the stack when possible - so screen-to-screen back (e.g. Connect -> Main) works for free
// on tvOS with no code here. What NavigationContainer's listener *can't* know about is
// MainScreen's own in-screen EntryDetail view, which isn't a real stack screen (just a conditional
// render within MainScreen - see the phone-portrait `backSwipeGesture` this hook replaces for
// Platform.isTV in docs/appletv-implementation-plan.md's Phase 2/3). Subscriptions fire in reverse
// registration order and stop at the first one returning true, so a hook used inside MainScreen
// (mounted after/inside NavigationContainer) naturally intercepts Menu presses before
// NavigationContainer's own listener gets a chance to pop the stack instead.
export function useTVBackHandler(enabled: boolean, onBack: () => void): void {
  useEffect(() => {
    if (!Platform.isTV || !enabled) return undefined;

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });

    return () => subscription.remove();
  }, [enabled, onBack]);
}
