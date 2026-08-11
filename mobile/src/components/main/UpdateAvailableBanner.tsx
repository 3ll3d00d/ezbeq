import { Linking } from 'react-native';
import { Portal, Snackbar } from 'react-native-paper';

type Props = {
  updateAvailable: boolean;
  latestVersion?: string;
  onDismiss: () => void;
};

// Ported from ui/src/components/main/UpdateAvailableSnack.jsx - never auto-hides (matches the
// web version's autoHideDuration={null}), dismissed only via the close icon.
//
// Rendered through <Portal> so it lands in PaperProvider's top-level Portal.Host instead of as a
// plain sibling of the scrollable catalogue list - without it, Paper's Snackbar is absolutely
// positioned but has no elevation/z-index coordination against that list, so taps on the close
// icon were being stolen by whatever catalogue row happened to sit underneath it on-screen.
export default function UpdateAvailableBanner({ updateAvailable, latestVersion, onDismiss }: Props) {
  return (
    <Portal>
      <Snackbar
        visible={updateAvailable}
        onDismiss={onDismiss}
        onIconPress={onDismiss}
        duration={Number.POSITIVE_INFINITY}
        action={{
          label: 'View',
          onPress: () => Linking.openURL(`https://github.com/3ll3d00d/ezbeq/releases/tag/${latestVersion}`),
        }}
      >
        {`ezbeq ${latestVersion} is available.`}
      </Snackbar>
    </Portal>
  );
}
