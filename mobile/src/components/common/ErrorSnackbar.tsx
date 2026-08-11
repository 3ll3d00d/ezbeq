import { Portal, Snackbar } from 'react-native-paper';

type PersistentError = Error & { persistent?: boolean };

type Props = {
  error: PersistentError | null;
  onDismiss: () => void;
};

// Ported from ui/src/components/ErrorSnack.jsx. A persistent error (payload.persistent from a
// WebSocket Error message - see stateSocket.ts) never auto-hides, matching the web version's
// autoHideDuration={null}; everything else auto-dismisses after 10s.
//
// Rendered through <Portal> - see UpdateAvailableBanner.tsx for why (touch hit-testing against
// the scrollable catalogue list underneath).
export default function ErrorSnackbar({ error, onDismiss }: Props) {
  return (
    <Portal>
      <Snackbar
        visible={error !== null}
        onDismiss={onDismiss}
        duration={error?.persistent ? Number.POSITIVE_INFINITY : 10000}
        action={{ label: 'Close', onPress: onDismiss }}
      >
        {error?.message ?? ''}
      </Snackbar>
    </Portal>
  );
}
