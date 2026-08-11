import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { Chip, IconButton, Modal, Portal, SegmentedButtons, Text, useTheme } from 'react-native-paper';

import type { CatalogueEntry } from '../../types/ezbeq';

// Ported from ui/src/components/main/index.jsx - exported for direct testing, independent of the
// rest of this component's rendering (which also needs entries/lastChecked wiring from a parent).
export const computeNewCount = (recentEntries: CatalogueEntry[], lastChecked: number): number =>
  recentEntries.filter((e) => Math.max(e.created_at ?? 0, e.updated_at ?? 0) >= lastChecked).length;

type Props = {
  visible: boolean;
  onClose: () => void;
  entries: CatalogueEntry[];
  lastChecked: number;
  initialMode: 'new' | 'recent';
  onSelect: (id: number) => void;
};

// Ported from ui/src/components/main/WhatsNew.jsx, minus its inline update-available/python-
// version alerts - those are the separate UpdateAvailableBanner/PythonVersionWarningBanner
// components (a later step), shown regardless of whether this sheet is open.
export default function WhatsNewSheet({ visible, onClose, entries, lastChecked, initialMode, onSelect }: Props) {
  const theme = useTheme();
  const [mode, setMode] = useState<'new' | 'recent'>(initialMode);

  const visibleEntries =
    mode === 'new'
      ? entries.filter((e) => Math.max(e.created_at ?? 0, e.updated_at ?? 0) >= lastChecked)
      : entries;

  return (
    <Portal>
      <Modal
        visible={visible}
        onDismiss={onClose}
        contentContainerStyle={[styles.modal, { backgroundColor: theme.colors.elevation.level3 }]}
      >
        <View style={styles.header}>
          <Text variant="titleLarge" style={styles.title}>
            What&apos;s New
          </Text>
          <IconButton icon="close" accessibilityLabel="Close" onPress={onClose} />
        </View>
        <SegmentedButtons
          value={mode}
          onValueChange={(v) => setMode(v as 'new' | 'recent')}
          style={styles.toggle}
          buttons={[
            { value: 'new', label: 'New' },
            { value: 'recent', label: 'Recent' },
          ]}
        />
        {visibleEntries.length === 0 ? (
          <Text variant="bodyMedium" style={styles.empty}>
            {mode === 'new' ? 'Nothing new since your last check.' : 'No recent titles in the last 2 weeks.'}
          </Text>
        ) : (
          <FlatList
            data={visibleEntries}
            keyExtractor={(entry) => String(entry.id)}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => onSelect(item.id)}
                style={styles.row}
                testID={`whats-new-row-${item.id}`}
              >
                <Text variant="bodyLarge">
                  {item.formattedTitle}
                  {item.year ? ` (${item.year})` : ''}
                </Text>
                <View style={styles.chips}>
                  <Chip compact style={styles.chip} testID={`freshness-chip-${item.id}`}>
                    {item.freshness === 'Fresh' ? 'New' : 'Updated'}
                  </Chip>
                  {item.author ? (
                    <Chip compact style={styles.chip}>
                      {item.author}
                    </Chip>
                  ) : null}
                  {item.audioTypes.map((t) => (
                    <Chip key={t} compact style={styles.chip}>
                      {t}
                    </Chip>
                  ))}
                </View>
              </Pressable>
            )}
          />
        )}
      </Modal>
    </Portal>
  );
}

const styles = StyleSheet.create({
  // See ConnectScreen's matching `content` style - caps the modal's width on wide/unfolded
  // screens instead of stretching a single-column list edge-to-edge.
  modal: {
    margin: 16,
    marginTop: 48,
    marginBottom: 48,
    padding: 16,
    borderRadius: 8,
    flex: 1,
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
  toggle: {
    marginBottom: 8,
  },
  empty: {
    padding: 24,
    textAlign: 'center',
  },
  row: {
    paddingVertical: 10,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 4,
  },
  chip: {
    marginRight: 0,
  },
});
