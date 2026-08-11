import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Text } from 'react-native-paper';

import CatalogueRow from './CatalogueRow';
import type { CatalogueEntry } from '../../types/ezbeq';

type Props = {
  entries: CatalogueEntry[];
  selectedEntryId: number | null;
  onSelectEntry: (id: number) => void;
  refreshing?: boolean;
  onRefresh?: () => void;
};

// Replaces the web UI's @mui/x-data-grid (Catalogue.jsx) - there's no RN DataGrid equivalent, so
// this renders a scrollable card/row list instead of a sortable table. Column-visibility isn't
// ported; sort order (by title, see MainScreen's entryList) is applied before entries reach here.
export default function CatalogueList({
  entries,
  selectedEntryId,
  onSelectEntry,
  refreshing,
  onRefresh,
}: Props) {
  // Built explicitly (rather than via FlashList's own refreshing/onRefresh props) so the same
  // element - with the same testID - backs pull-to-refresh on both the empty and populated
  // states below.
  const refreshControl = onRefresh ? (
    <RefreshControl testID="catalogue-refresh-control" refreshing={!!refreshing} onRefresh={onRefresh} />
  ) : undefined;

  if (entries.length === 0) {
    // A plain View can't be pulled - wrap the empty state in a ScrollView so pull-to-refresh
    // still works when a search/filter (or a not-yet-loaded catalogue) leaves nothing to show.
    return (
      <ScrollView contentContainerStyle={styles.empty} refreshControl={refreshControl}>
        <Text variant="bodyMedium">No results</Text>
      </ScrollView>
    );
  }

  return (
    <FlashList
      data={entries}
      keyExtractor={(entry) => String(entry.id)}
      renderItem={({ item }) => (
        <CatalogueRow entry={item} selected={item.id === selectedEntryId} onPress={onSelectEntry} />
      )}
      refreshControl={refreshControl}
    />
  );
}

const styles = StyleSheet.create({
  empty: {
    padding: 24,
    alignItems: 'center',
  },
});
