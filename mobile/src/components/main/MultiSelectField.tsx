import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { Button, Checkbox, Chip, Modal, Portal, Text, TextInput, useTheme } from 'react-native-paper';

type Props = {
  label: string;
  items: string[];
  selectedValues: string[];
  onChange: (selected: string[]) => void;
  // Rows for a value not "in view" render struck-through, mirroring
  // ui/src/components/main/Filter.jsx's getOptionStyle - used to show which filter options
  // actually appear in the current (other-filters-applied) result set.
  isInView?: (value: string) => boolean;
};

// The web version (MultiSelect.jsx) is a MUI Autocomplete with free-text "create" support that
// fuzzy-matches typed text against known options (see Filter.jsx's matchYears/matchAudioTypes/
// etc). Free-solo-then-fuzzy-match is a desktop-Autocomplete idiom; the mobile equivalent of
// "type to find, then commit" is simpler and more platform-native as search-to-filter-the-list
// plus tap-to-select, which is what this implements - there's no separate "create" step because
// typing never resolves to anything other than a real known option anyway.
export default function MultiSelectField({ label, items, selectedValues, onChange, isInView = () => true }: Props) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const visibleItems = useMemo(
    () => items.filter((item) => item.toLowerCase().includes(query.toLowerCase())),
    [items, query]
  );

  const toggle = (value: string) => {
    const next = selectedValues.includes(value)
      ? selectedValues.filter((v) => v !== value)
      : [...selectedValues, value];
    onChange(next);
  };

  return (
    <View style={styles.field}>
      <Pressable
        onPress={() => setOpen(true)}
        style={styles.trigger}
        accessibilityRole="button"
        accessibilityLabel={`${label} filter, ${selectedValues.length ? selectedValues.join(', ') : 'any'}`}
      >
        <Text variant="labelLarge">{label}</Text>
        <View style={styles.chips}>
          {selectedValues.length === 0 ? (
            <Text variant="bodySmall" style={styles.placeholder}>
              Any
            </Text>
          ) : (
            selectedValues.map((v) => (
              <Chip key={v} compact onClose={() => toggle(v)} style={styles.chip}>
                {v}
              </Chip>
            ))
          )}
        </View>
      </Pressable>
      <Portal>
        <Modal
          visible={open}
          onDismiss={() => setOpen(false)}
          contentContainerStyle={[styles.modal, { backgroundColor: theme.colors.elevation.level3 }]}
        >
          <Text variant="titleMedium" style={styles.modalTitle}>
            {label}
          </Text>
          <TextInput
            mode="outlined"
            dense
            placeholder={`Search ${label}`}
            value={query}
            onChangeText={setQuery}
            style={styles.search}
          />
          <FlatList
            data={visibleItems}
            keyExtractor={(item) => item}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => toggle(item)}
                style={styles.row}
                testID={`option-${item}`}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selectedValues.includes(item) }}
                accessibilityLabel={item}
              >
                <Checkbox status={selectedValues.includes(item) ? 'checked' : 'unchecked'} />
                <Text testID={`option-label-${item}`} style={isInView(item) ? undefined : styles.notInView}>
                  {item}
                </Text>
              </Pressable>
            )}
          />
          <View style={styles.actions}>
            <Button onPress={() => onChange([])}>Clear</Button>
            <Button onPress={() => setOpen(false)}>Done</Button>
          </View>
        </Modal>
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    marginBottom: 8,
  },
  trigger: {
    paddingVertical: 8,
    paddingHorizontal: 12,
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
  placeholder: {
    opacity: 0.6,
  },
  // See ConnectScreen's matching `content` style - caps the modal's width on wide/unfolded
  // screens instead of stretching a single narrow column of checkbox rows edge-to-edge.
  modal: {
    margin: 24,
    padding: 16,
    borderRadius: 8,
    maxHeight: '80%',
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
  },
  modalTitle: {
    marginBottom: 8,
  },
  search: {
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  notInView: {
    textDecorationLine: 'line-through',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 8,
    gap: 8,
  },
});
