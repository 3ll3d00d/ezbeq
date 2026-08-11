import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Button, HelperText, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BarcodeScanningResult } from 'expo-camera';

import { useServerContext } from '../../context/ServerContext';
import { EzbeqApi } from '../../services/ezbeqApi';
import { normalizeBaseUrl } from '../../services/serverConfig';
import type { RootStackParamList } from '../../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'ScanQr'>;

// The web UI's "Pair Mobile App" dialog (ui/src/components/PairMobileAppDialog.jsx) encodes a
// plain URL string, not JSON - simpler to scan/debug with any generic QR reader too.
export default function ScanQrScreen({ navigation }: Props) {
  const { pair } = useServerContext();
  const [permission, requestPermission] = useCameraPermissions();
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  // Guards against the camera firing onBarcodeScanned repeatedly for the same code while a scan
  // is already being processed.
  const processingRef = useRef(false);
  // The navigator header covers the top inset; left/right/bottom aren't covered by anything here.
  const insets = useSafeAreaInsets();
  const insetContainer = [
    styles.container,
    { paddingLeft: 24 + insets.left, paddingRight: 24 + insets.right, paddingBottom: insets.bottom },
  ];

  const handleScanned = async ({ data }: BarcodeScanningResult) => {
    if (processingRef.current) return;
    processingRef.current = true;
    setError(null);
    setConnecting(true);

    try {
      const baseUrl = normalizeBaseUrl(data);
      await new EzbeqApi(baseUrl).getVersion();
      await pair({ baseUrl });
      navigation.replace('Main');
    } catch {
      setError(`That QR code didn't point to a reachable ezbeq server.`);
      setConnecting(false);
      processingRef.current = false;
    }
  };

  if (!permission) {
    return <View style={insetContainer} />;
  }

  if (!permission.granted) {
    return (
      <View style={insetContainer}>
        <View style={styles.content}>
          <Text variant="bodyMedium" style={styles.message}>
            Camera access is needed to scan the pairing QR code.
          </Text>
          <Button mode="contained" onPress={requestPermission}>
            Grant Camera Access
          </Button>
          <Button mode="text" onPress={() => navigation.goBack()}>
            Enter address manually instead
          </Button>
        </View>
      </View>
    );
  }

  return (
    <View style={insetContainer}>
      <CameraView
        style={styles.camera}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={connecting ? undefined : handleScanned}
      />
      {error ? <HelperText type="error">{error}</HelperText> : null}
      <Button mode="text" onPress={() => navigation.goBack()}>
        Enter address manually instead
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  // See ConnectScreen's matching `content` style - caps the permission-prompt text/buttons'
  // width on large tablets instead of stretching them edge-to-edge.
  content: {
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
  },
  message: {
    marginBottom: 16,
    textAlign: 'center',
  },
  camera: {
    flex: 1,
    marginBottom: 12,
  },
});
