import { Portal, Snackbar } from 'react-native-paper';

type Props = {
  pythonUnsupported: boolean;
  pythonVersion?: string;
  minPythonVersion?: string;
  onDismiss: () => void;
};

// Ported from ui/src/components/main/PythonVersionWarningSnack.jsx - never auto-hides, dismissed
// only via the close icon.
//
// Rendered through <Portal> - see UpdateAvailableBanner.tsx for why (touch hit-testing against
// the scrollable catalogue list underneath).
export default function PythonVersionWarningBanner({
  pythonUnsupported,
  pythonVersion,
  minPythonVersion,
  onDismiss,
}: Props) {
  return (
    <Portal>
      <Snackbar visible={pythonUnsupported} onDismiss={onDismiss} onIconPress={onDismiss} duration={Number.POSITIVE_INFINITY}>
        {`Running Python ${pythonVersion}; ezbeq requires ${minPythonVersion}+. Some features may not work correctly.`}
      </Snackbar>
    </Portal>
  );
}
