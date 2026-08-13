import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { ActivityIndicator, Badge, IconButton, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import DeviceDisconnectedBanner from '../../components/common/DeviceDisconnectedBanner';
import ErrorSnackbar from '../../components/common/ErrorSnackbar';
import SuccessSnackbar from '../../components/common/SuccessSnackbar';
import CatalogueList from '../../components/main/CatalogueList';
import EntryDetail from '../../components/main/EntryDetail';
import FilterSheet, { emptyFilterSelection, type FilterSelection } from '../../components/main/FilterSheet';
import GainPanel from '../../components/main/GainPanel';
import PythonVersionWarningBanner from '../../components/main/PythonVersionWarningBanner';
import SearchBar from '../../components/main/SearchBar';
import SettingsSheet from '../../components/main/SettingsSheet';
import SlotsGrid from '../../components/main/SlotsGrid';
import UpdateAvailableBanner from '../../components/main/UpdateAvailableBanner';
import WhatsNewSheet, { computeNewCount } from '../../components/main/WhatsNewSheet';
import { useDeviceState } from '../../context/DeviceStateContext';
import { useServerContext } from '../../context/ServerContext';
import { useAsyncStorageState } from '../../hooks/useAsyncStorageState';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useFilterLoadedNotification } from '../../hooks/useFilterLoadedNotification';
import { useResponsiveLayout } from '../../hooks/useResponsiveLayout';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { isFilterNotificationSupported } from '../../services/filterNotification';
import { useGainSync } from '../../services/gains';
import type { CatalogueEntry, DeviceState, VersionInfo } from '../../types/ezbeq';

type Props = NativeStackScreenProps<RootStackParamList, 'Main'>;

const TWO_WEEKS_AGO_SECS = () => Math.floor(Date.now() / 1000) - 2 * 7 * 24 * 60 * 60;

// Ported from ui/src/components/main/index.jsx.
export const txtMatch = (entry: CatalogueEntry, txtFilter: string): boolean => {
  const matchOn = txtFilter.toLowerCase();
  if (entry.formattedTitle.toLowerCase().includes(matchOn)) return true;
  if (entry.altTitle && entry.altTitle.toLowerCase().includes(matchOn)) return true;
  if (entry.collection && entry.collection.toLowerCase().includes(matchOn)) return true;
  return false;
};

// Matches the web UI's default DataGrid sort (Catalogue.jsx's `sortModel: [{field: 'sortTitle',
// sort: 'asc'}]`) - falls back to formattedTitle for the rare entry with no sortTitle set.
export const compareByTitle = (a: CatalogueEntry, b: CatalogueEntry): number =>
  (a.sortTitle || a.formattedTitle).localeCompare(b.sortTitle || b.formattedTitle);

// A deliberate rightward swipe, not an incidental drag while scrolling or a stray tap-and-drift -
// requires both a meaningful horizontal distance and a rightward-moving finger at release.
const BACK_SWIPE_MIN_TRANSLATION_X = 60;
export const shouldTriggerBackSwipe = (translationX: number, velocityX: number): boolean =>
  translationX > BACK_SWIPE_MIN_TRANSLATION_X && velocityX > 0;

export type EntryFilters = FilterSelection & { debouncedTxtFilter: string };

// entry passes only if it satisfies every selected filter dimension
export const isMatch = (entry: CatalogueEntry, filters: EntryFilters): boolean => {
  const { authors, years, audioTypes, contentTypes, freshness, languages, debouncedTxtFilter } = filters;
  if (authors.length && !authors.includes(entry.author)) return false;
  if (years.length && !years.includes(String(entry.year))) return false;
  if (audioTypes.length && !entry.audioTypes.some((at) => audioTypes.includes(at))) return false;
  if (contentTypes.length && !contentTypes.includes(entry.contentType)) return false;
  if (freshness.length && (!entry.freshness || !freshness.includes(entry.freshness))) return false;
  if (languages.length && (!entry.language || !languages.includes(entry.language))) return false;
  if (debouncedTxtFilter && !txtMatch(entry, debouncedTxtFilter)) return false;
  return true;
};

// null means "leave the current text filter alone" - only a genuinely loaded slot should
// overwrite whatever the user may have typed. Ported from ui/src/components/main/index.jsx.
export const deriveTxtFilterFromActiveSlot = (
  device: DeviceState | null,
  userDriven: boolean,
  selectedSlotId: string | null
): string | null => {
  if (!device || !userDriven || !device.slots) return null;
  const slot = device.slots.find((s) => s.id === selectedSlotId);
  if (slot && slot.last && slot.last !== 'ERROR' && slot.last !== 'Empty') {
    return slot.last;
  }
  return null;
};

// Wires together ui/src/components/main/index.jsx (search/filter/catalogue/entry detail/upload),
// Slots.jsx (slot activate/clear), and Gain.jsx (master/channel gain, via useGainSync).
export default function MainScreen({ navigation }: Props) {
  const {
    api,
    availableDevices,
    selectedDeviceName,
    selectedSlotId,
    replaceDevice,
    entries,
    meta,
    error,
    setError,
    refreshCatalogue,
  } = useDeviceState();
  const { connection, unpair } = useServerContext();
  const device = selectedDeviceName ? availableDevices[selectedDeviceName] : null;

  const [txtFilter, setTxtFilter] = useState('');
  const [catalogueRefreshing, setCatalogueRefreshing] = useState(false);
  const debouncedTxtFilter = useDebouncedValue(txtFilter, 300);
  const [showFilters, setShowFilters] = useState(false);
  const [filterSelection, setFilterSelection] = useState<FilterSelection>(emptyFilterSelection);
  const [selectedEntryId, setSelectedEntryId] = useState<number | null>(null);
  const [userDriven, setUserDriven] = useState(false);
  const [pendingSlotIds, setPendingSlotIds] = useState<ReadonlySet<string>>(new Set());
  const [uploadPendingSlotId, setUploadPendingSlotId] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [recentEntries, setRecentEntries] = useState<CatalogueEntry[]>([]);
  const [lastChecked, setLastChecked] = useAsyncStorageState('whatsNewLastChecked', TWO_WEEKS_AGO_SECS());
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [versionInfo, setVersionInfo] = useState<VersionInfo>({});
  const [dismissedUpdateVersion, setDismissedUpdateVersion] = useAsyncStorageState<string | null>(
    'dismissedUpdateVersion',
    null
  );
  const [dismissedPythonWarningVersion, setDismissedPythonWarningVersion] = useAsyncStorageState<
    string | null
  >('dismissedPythonWarningVersion', null);
  const [filterNotificationEnabled, setFilterNotificationEnabled] = useAsyncStorageState(
    'filterNotificationEnabled',
    false
  );
  // Static for the life of the process (Platform.OS/Expo Go don't change at runtime) - computed
  // once rather than memoized.
  const filterNotificationSupported = isFilterNotificationSupported();

  // Without an explicit sort, entries come back in whatever order the backend's unordered SQL
  // SELECT happens to return, which groups by author rather than title - see compareByTitle.
  const entryList = useMemo(() => Object.values(entries).sort(compareByTitle), [entries]);

  const filteredEntries = useMemo(() => {
    const filters: EntryFilters = { ...filterSelection, debouncedTxtFilter };
    return entryList.filter((e) => isMatch(e, filters));
  }, [entryList, filterSelection, debouncedTxtFilter]);

  const selectedEntry = useMemo(
    () => (selectedEntryId !== null ? (entries[String(selectedEntryId)] ?? null) : null),
    [entries, selectedEntryId]
  );

  useEffect(() => {
    const next = deriveTxtFilterFromActiveSlot(device, userDriven, selectedSlotId);
    if (next) setTxtFilter(next);
  }, [device, selectedSlotId, userDriven]);

  // Silently ignored, unlike every other api call here - /api/1/whats-new is a relatively recent
  // addition (see mobile/README.md's backend compatibility note), so a server running an older
  // ezbeq release 404s on this and would otherwise surface a spurious error toast on every launch
  // for a working, fully-functional-in-every-other-respect connection. Worst case, the What's New
  // bell just never gets a badge and the sheet stays empty - not worth alarming the user over.
  useEffect(() => {
    api?.getWhatsNew().then(setRecentEntries).catch(() => {});
  }, [api, meta]);

  useEffect(() => {
    api?.getVersion().then(setVersionInfo).catch((e) => setError(e));
  }, [api, setError]);

  const newCount = computeNewCount(recentEntries, lastChecked);
  const updateAvailable = Boolean(
    versionInfo.updateAvailable && versionInfo.latestVersion && versionInfo.latestVersion !== dismissedUpdateVersion
  );
  const pythonUnsupported =
    versionInfo.pythonSupported === false && versionInfo.minPythonVersion !== dismissedPythonWarningVersion;
  const whatsNewBadgeCount = newCount + (updateAvailable ? 1 : 0) + (pythonUnsupported ? 1 : 0);

  const openWhatsNew = () => {
    if (whatsNewOpen) {
      setWhatsNewOpen(false);
    } else {
      setWhatsNewOpen(true);
      setLastChecked(Math.floor(Date.now() / 1000));
    }
  };

  // Only forgets the paired server (ServerContext.unpair -> clearServerConnection) - everything
  // else persisted via useAsyncStorageState (What's New dismissal state, the notification toggle,
  // ...) is untouched, so re-pairing with the same or a different server picks those back up
  // rather than resetting them.
  const handleDisconnect = () => {
    Alert.alert('Disconnect from server?', 'You can reconnect at any time - your settings are kept.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect',
        style: 'destructive',
        onPress: () => {
          unpair().then(() => navigation.reset({ index: 0, routes: [{ name: 'Connect' }] }));
        },
      },
    ]);
  };

  // loadCatalogue() is fire-and-forget over the websocket - the fresh CatalogueEntries push
  // arrives asynchronously with no completion signal, so this just gives the RefreshControl a
  // brief, fixed-duration spin to confirm the pull was registered rather than tracking the
  // response itself.
  const handleRefreshCatalogue = useCallback(() => {
    setCatalogueRefreshing(true);
    refreshCatalogue();
    setTimeout(() => setCatalogueRefreshing(false), 800);
  }, [refreshCatalogue]);

  const withPending = useCallback((slotId: string, action: () => Promise<void>) => {
    setPendingSlotIds((current) => new Set(current).add(slotId));
    action().finally(() => {
      setPendingSlotIds((current) => {
        const next = new Set(current);
        next.delete(slotId);
        return next;
      });
    });
  }, []);

  const activateSlot = useCallback(
    (slotId: string) => {
      if (!api || !device) return;
      withPending(slotId, async () => {
        try {
          const updated = await api.activateSlot(device.name, slotId);
          replaceDevice(updated);
          setUserDriven(true);
        } catch (e) {
          setError(e as Error);
        }
      });
    },
    [api, device, replaceDevice, setError, withPending]
  );

  const clearSlot = useCallback(
    (slotId: string) => {
      if (!api || !device) return;
      withPending(slotId, async () => {
        try {
          const updated = await api.clearSlot(device.name, slotId);
          replaceDevice(updated);
          setSuccessMessage('Slot cleared');
        } catch (e) {
          setError(e as Error);
        }
      });
    },
    [api, device, replaceDevice, setError, withPending]
  );

  useFilterLoadedNotification({
    enabled: filterNotificationEnabled,
    device,
    activeSlotId: selectedSlotId,
    onClear: clearSlot,
    onError: setError,
  });

  const slotPendingIds = useMemo(() => {
    if (!uploadPendingSlotId || pendingSlotIds.has(uploadPendingSlotId)) return pendingSlotIds;
    return new Set(pendingSlotIds).add(uploadPendingSlotId);
  }, [pendingSlotIds, uploadPendingSlotId]);

  const { currentGains, deviceGains, updateGain, commitGain } = useGainSync(
    api,
    device,
    selectedSlotId,
    setError
  );

  // Phone-portrait layout has no real navigation-stack transition into the detail view (it's a
  // conditional render within this same screen, see selectedEntry below), so React Navigation's
  // native-stack edge-swipe-back doesn't apply here - it has to be wired up by hand. Constrained
  // to a mostly-horizontal rightward drag so it doesn't fight EntryDetail's vertical ScrollView.
  const backSwipeGesture = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .activeOffsetX(20)
        .failOffsetY([-10, 10])
        .onEnd((e) => {
          if (shouldTriggerBackSwipe(e.translationX, e.velocityX)) {
            setSelectedEntryId(null);
          }
        }),
    []
  );

  const { useWide, isTablet, height } = useResponsiveLayout();
  // This screen has no navigator header (see RootNavigator) to cover the top inset for it, unlike
  // Connect/ScanQr - so, uniquely among the three screens, it pads all four sides itself.
  const insets = useSafeAreaInsets();
  // A flat pixel cap either swallows most of a short landscape-phone screen or wastes the extra
  // room a tablet has - scale with available height instead, clamped so it's never cramped on the
  // shortest screens or absurdly tall on the longest ones.
  const filterSheetMaxHeight = Math.min(480, Math.max(180, height * 0.4));
  // A tablet held in portrait is narrower than the landscape useWide threshold but still has
  // plenty of room for the two-pane list|detail split - only a phone-width portrait screen needs
  // the single-column, navigate-into-detail layout.
  const showSplitView = useWide || isTablet;

  const devicesPane = !device ? (
    <View style={styles.center}>
      <ActivityIndicator />
      <Text style={styles.hint}>Waiting for device data…</Text>
    </View>
  ) : (
    <View style={styles.slots}>
      {Object.keys(availableDevices).length > 1 ? (
        <Text variant="titleMedium" style={styles.deviceName}>
          {device.name}
        </Text>
      ) : null}
      <SlotsGrid
        slots={device.slots ?? []}
        selectedSlotId={selectedSlotId}
        pendingSlotIds={slotPendingIds}
        onActivate={activateSlot}
        onClear={clearSlot}
      />
      {device.masterVolume !== undefined ? (
        <GainPanel
          selectedSlotId={selectedSlotId}
          deviceGains={deviceGains}
          gains={currentGains}
          updateGain={updateGain}
          commitGain={commitGain}
        />
      ) : null}
    </View>
  );

  const cataloguePane = (
    <CatalogueList
      entries={filteredEntries}
      selectedEntryId={selectedEntryId}
      onSelectEntry={setSelectedEntryId}
      refreshing={catalogueRefreshing}
      onRefresh={handleRefreshCatalogue}
    />
  );

  const entryPane =
    api && selectedEntry ? (
      <EntryDetail
        api={api}
        selectedEntry={selectedEntry}
        selectedDevice={device}
        selectedSlotId={selectedSlotId}
        onDeviceUpdate={replaceDevice}
        onError={setError}
        onSuccess={setSuccessMessage}
        onUploadPendingSlotChange={setUploadPendingSlotId}
      />
    ) : null;

  return (
    <View
      style={[
        styles.container,
        {
          paddingTop: insets.top,
          paddingLeft: insets.left,
          paddingRight: insets.right,
          paddingBottom: insets.bottom,
        },
      ]}
    >
      <View style={styles.topRow}>
        <View style={styles.searchBarFlex}>
          <SearchBar
            value={txtFilter}
            onChangeText={setTxtFilter}
            showFilters={showFilters}
            onToggleFilters={() => setShowFilters((prev) => !prev)}
          />
        </View>
        <IconButton icon="cog-outline" accessibilityLabel="Settings" onPress={() => setSettingsOpen(true)} />
        <View>
          <IconButton icon="bell-outline" accessibilityLabel="What's New" onPress={openWhatsNew} />
          {whatsNewBadgeCount > 0 ? <Badge style={styles.whatsNewBadge}>{whatsNewBadgeCount}</Badge> : null}
        </View>
      </View>

      <SettingsSheet
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        serverBaseUrl={connection?.baseUrl ?? null}
        onDisconnect={handleDisconnect}
        filterNotificationEnabled={filterNotificationEnabled}
        filterNotificationSupported={filterNotificationSupported}
        onToggleFilterNotification={setFilterNotificationEnabled}
      />

      <UpdateAvailableBanner
        updateAvailable={updateAvailable}
        latestVersion={versionInfo.latestVersion}
        onDismiss={() => setDismissedUpdateVersion(versionInfo.latestVersion ?? null)}
      />
      <PythonVersionWarningBanner
        pythonUnsupported={pythonUnsupported}
        pythonVersion={versionInfo.pythonVersion}
        minPythonVersion={versionInfo.minPythonVersion}
        onDismiss={() => setDismissedPythonWarningVersion(versionInfo.minPythonVersion ?? null)}
      />

      <WhatsNewSheet
        visible={whatsNewOpen}
        onClose={() => setWhatsNewOpen(false)}
        entries={recentEntries}
        lastChecked={lastChecked}
        initialMode={newCount > 0 ? 'new' : 'recent'}
        onSelect={(id) => {
          setSelectedEntryId(id);
          setWhatsNewOpen(false);
        }}
      />

      {device && device.connected === false ? <DeviceDisconnectedBanner deviceName={device.name} /> : null}

      <ErrorSnackbar error={error} onDismiss={() => setError(null)} />
      <SuccessSnackbar message={successMessage} onDismiss={() => setSuccessMessage(null)} />

      {showFilters && api ? (
        <View style={{ maxHeight: filterSheetMaxHeight }}>
          <FilterSheet
            api={api}
            selection={filterSelection}
            onChange={setFilterSelection}
            filteredEntries={filteredEntries}
            onError={setError}
          />
        </View>
      ) : null}

      {showSplitView ? (
        // Landscape with enough height, or any tablet-width screen regardless of orientation -
        // list and detail panes render side by side, matching MainView's two-column Grid on the
        // web, rather than the phone-style list<->detail navigation used below.
        <View style={styles.wideRow}>
          <View style={styles.wideListPane}>
            {devicesPane}
            {cataloguePane}
          </View>
          <View style={styles.wideDetailPane}>
            {entryPane ?? (
              <View style={styles.center}>
                <Text style={styles.hint}>Select a catalogue entry to see its details.</Text>
              </View>
            )}
          </View>
        </View>
      ) : selectedEntry ? (
        <GestureDetector gesture={backSwipeGesture}>
          <View style={styles.detailContainer}>
            <IconButton icon="arrow-left" accessibilityLabel="Back to results" onPress={() => setSelectedEntryId(null)} />
            {entryPane}
          </View>
        </GestureDetector>
      ) : (
        <View style={styles.listContainer}>
          {devicesPane}
          {cataloguePane}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  searchBarFlex: {
    flex: 1,
  },
  whatsNewBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  hint: {
    marginTop: 8,
  },
  detailContainer: {
    flex: 1,
  },
  listContainer: {
    flex: 1,
  },
  wideRow: {
    flex: 1,
    flexDirection: 'row',
  },
  wideListPane: {
    flex: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: 'rgba(0, 0, 0, 0.12)',
  },
  wideDetailPane: {
    flex: 1,
  },
  slots: {
    padding: 8,
  },
  deviceName: {
    marginBottom: 4,
    marginLeft: 4,
  },
});
