import { Portal, Snackbar } from 'react-native-paper';

type Props = {
  message: string | null;
  onDismiss: () => void;
};

// Ported from ui/src/components/SuccessSnack.jsx - always auto-hides after 3s.
//
// Rendered through <Portal> - see UpdateAvailableBanner.tsx for why (touch hit-testing against
// the scrollable catalogue list underneath).
export default function SuccessSnackbar({ message, onDismiss }: Props) {
  return (
    <Portal>
      <Snackbar visible={message !== null} onDismiss={onDismiss} duration={3000}>
        {message ?? ''}
      </Snackbar>
    </Portal>
  );
}
