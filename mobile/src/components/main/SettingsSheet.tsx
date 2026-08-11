import { StyleSheet, View } from 'react-native';
import { Divider, IconButton, List, Modal, Portal, Switch, Text, useTheme } from 'react-native-paper';

type Props = {
  visible: boolean;
  onClose: () => void;
  serverBaseUrl: string | null;
  onDisconnect: () => void;
  filterNotificationEnabled: boolean;
  filterNotificationSupported: boolean;
  onToggleFilterNotification: (next: boolean) => void;
};

// A single home for connection management and app-level toggles (currently just the persistent
// filter-loaded notification) so future settings have somewhere to live other than more top-row
// icons - see MainScreen.tsx's topRow. Follows WhatsNewSheet's Portal+Modal card convention.
export default function SettingsSheet({
  visible,
  onClose,
  serverBaseUrl,
  onDisconnect,
  filterNotificationEnabled,
  filterNotificationSupported,
  onToggleFilterNotification,
}: Props) {
  const theme = useTheme();

  return (
    <Portal>
      <Modal
        visible={visible}
        onDismiss={onClose}
        contentContainerStyle={[styles.modal, { backgroundColor: theme.colors.elevation.level3 }]}
      >
        <View style={styles.header}>
          <Text variant="titleLarge" style={styles.title}>
            Settings
          </Text>
          <IconButton icon="close" accessibilityLabel="Close" onPress={onClose} />
        </View>

        <List.Section>
          <List.Subheader>Notifications</List.Subheader>
          <List.Item
            title="Persistent filter-loaded notification"
            description={
              filterNotificationSupported
                ? 'Shows a notification with a Clear Filter action while a filter is loaded on the active slot.'
                : 'Requires a development build - unavailable in Expo Go on Android.'
            }
            descriptionNumberOfLines={3}
            right={() => (
              <Switch
                value={filterNotificationEnabled}
                disabled={!filterNotificationSupported}
                onValueChange={onToggleFilterNotification}
                accessibilityLabel={
                  filterNotificationEnabled
                    ? 'Disable persistent filter-loaded notification'
                    : 'Enable persistent filter-loaded notification'
                }
              />
            )}
          />
        </List.Section>

        <Divider />

        <List.Section>
          <List.Subheader>Connection</List.Subheader>
          {serverBaseUrl ? (
            <Text variant="bodyMedium" style={styles.serverUrl}>
              {serverBaseUrl}
            </Text>
          ) : null}
          <List.Item
            title="Disconnect from server"
            titleStyle={{ color: theme.colors.error }}
            left={(props) => <List.Icon {...props} icon="logout" color={theme.colors.error} />}
            onPress={onDisconnect}
          />
        </List.Section>
      </Modal>
    </Portal>
  );
}

const styles = StyleSheet.create({
  // See WhatsNewSheet's matching `modal` style.
  modal: {
    margin: 16,
    padding: 16,
    borderRadius: 8,
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  title: {
    flex: 1,
  },
  serverUrl: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    opacity: 0.7,
  },
});
