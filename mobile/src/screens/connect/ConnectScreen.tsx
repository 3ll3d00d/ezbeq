import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, HelperText, SegmentedButtons, Text, TextInput } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { useServerContext } from '../../context/ServerContext';
import { EzbeqApi } from '../../services/ezbeqApi';
import { normalizeBaseUrl } from '../../services/serverConfig';
import type { RootStackParamList } from '../../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Connect'>;

// Probes the given base URL the same way the pairing paths do (GET /api/1/version, which every
// ezbeq server exposes with no auth) before committing to it, so a typo doesn't get silently
// persisted only to fail later on the main screen.
const testConnection = async (baseUrl: string): Promise<void> => {
  await new EzbeqApi(baseUrl).getVersion();
};

export default function ConnectScreen({ navigation }: Props) {
  const { pair } = useServerContext();
  // The navigator header covers the top inset; left/right/bottom aren't covered by anything here.
  const insets = useSafeAreaInsets();
  const [protocol, setProtocol] = useState<'http' | 'https'>('http');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('8080');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = host.trim().length > 0 && !connecting;

  const handleConnect = async () => {
    setError(null);
    let baseUrl: string;
    try {
      const portSuffix = port.trim() ? `:${port.trim()}` : '';
      baseUrl = normalizeBaseUrl(`${protocol}://${host.trim()}${portSuffix}`);
    } catch (e) {
      setError((e as Error).message);
      return;
    }

    setConnecting(true);
    try {
      await testConnection(baseUrl);
      await pair({ baseUrl });
      navigation.replace('Main');
    } catch {
      setError(`Couldn't reach a server at ${baseUrl}. Check the address and that it's running.`);
    } finally {
      setConnecting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      // iOS never resizes the view around the keyboard the way Android's default
      // windowSoftInputMode does - without this, the port field/error text/buttons can end up
      // hidden behind the keyboard on a short-height landscape phone.
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.container,
          { paddingLeft: 24 + insets.left, paddingRight: 24 + insets.right, paddingBottom: 24 + insets.bottom },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.content}>
          <Text variant="titleMedium" style={styles.title}>
            Connect to your ezbeq server
          </Text>
          <Text variant="bodyMedium" style={styles.subtitle}>
            Enter the address shown in the "Pair Mobile App" dialog on the ezbeq web UI, or scan
            its QR code instead.
          </Text>

          <SegmentedButtons
            value={protocol}
            onValueChange={(value) => setProtocol(value as 'http' | 'https')}
            style={styles.field}
            buttons={[
              { value: 'http', label: 'http' },
              { value: 'https', label: 'https' },
            ]}
          />

          <TextInput
            label="Host or IP address"
            placeholder="192.168.1.23"
            value={host}
            onChangeText={setHost}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={styles.field}
          />

          <TextInput
            label="Port"
            placeholder="8080"
            value={port}
            onChangeText={setPort}
            keyboardType="number-pad"
            style={styles.field}
          />

          {error ? <HelperText type="error">{error}</HelperText> : null}

          <Button mode="contained" onPress={handleConnect} disabled={!canSubmit} style={styles.field}>
            {connecting ? <ActivityIndicator size="small" /> : 'Test & Connect'}
          </Button>

          <Button mode="text" onPress={() => navigation.navigate('ScanQr')}>
            Scan QR code instead
          </Button>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  // Caps the form's width so it doesn't stretch edge-to-edge on large tablets (e.g. a 13" iPad
  // Pro is 1000pt+ wide) - a single-line text field or a paragraph of body text that wide is
  // uncomfortable to read/use.
  content: {
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
  },
  title: {
    marginBottom: 4,
  },
  subtitle: {
    marginBottom: 24,
  },
  field: {
    marginBottom: 12,
  },
});
