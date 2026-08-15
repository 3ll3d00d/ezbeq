import { StyleSheet, View } from 'react-native';
import { Divider, IconButton, List, Modal, Portal, Switch, Text, useTheme } from 'react-native-paper';

import type { CatalogueMeta, VersionInfo } from '../../types/ezbeq';

type Props = {
  visible: boolean;
  onClose: () => void;
  serverBaseUrl: string | null;
  onDisconnect: () => void;
  filterNotificationEnabled: boolean;
  filterNotificationSupported: boolean;
  onToggleFilterNotification: (next: boolean) => void;
  versionInfo: VersionInfo;
  catalogueMeta: CatalogueMeta;
};

const padZero = (n: number) => n.toString().padStart(2, '0');

// Ported from ui/src/components/main/Footer.jsx - kept as close to that formatting as possible so
// the two stay easy to diff against each other.
const formatSeconds = (s: number | undefined): string => {
  if (s) {
    const d = new Date(0);
    d.setUTCSeconds(s);
    return `${d.getFullYear()}${padZero(d.getMonth() + 1)}${padZero(d.getDate())}_${padZero(d.getHours())}${padZero(d.getMinutes())}${padZero(d.getSeconds())}`;
  }
  return '?';
};

// Ported from ui/src/components/main/Footer.jsx.
export const formatCatalogueVersion = (meta: CatalogueMeta | null | undefined): string | null => {
  if (!meta) return null;
  const sha1 = meta.version ? String(meta.version).substring(0, 7) : '';
  return `${formatSeconds(meta.loaded)} / ${sha1}`;
};

// Ported from ui/src/components/main/Footer.jsx.
export const formatAppVersion = (version: VersionInfo | null | undefined): string | null => {
  if (!version) return null;
  const gitRef = version.branch ? `${version.branch}@${version.sha || ''}` : version.sha || '';
  const v = version.version;
  const vStr = v && v !== 'UNKNOWN' ? `v${v}` : gitRef ? '' : v || '';
  const gitStr = gitRef ? ` git: ${gitRef}` : '';
  const result = `${vStr}${gitStr}`.trim();
  return result || null;
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
  versionInfo,
  catalogueMeta,
}: Props) {
  const theme = useTheme();
  const appVersionText = formatAppVersion(versionInfo);
  const catalogueVersionText = formatCatalogueVersion(catalogueMeta);

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

        {appVersionText || catalogueVersionText ? (
          <>
            <Divider />
            <List.Section>
              <List.Subheader>About</List.Subheader>
              {appVersionText ? <List.Item title="App version" description={appVersionText} /> : null}
              {catalogueVersionText ? (
                <List.Item title="Catalogue version" description={catalogueVersionText} />
              ) : null}
            </List.Section>
          </>
        ) : null}
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
