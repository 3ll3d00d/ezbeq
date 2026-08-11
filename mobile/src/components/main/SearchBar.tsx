import { StyleSheet, View } from 'react-native';
import { IconButton, TextInput } from 'react-native-paper';

type Props = {
  value: string;
  onChangeText: (text: string) => void;
  showFilters: boolean;
  onToggleFilters: () => void;
};

// Presentational, like ui/src/components/main/Search.jsx - the parent owns txtFilter and derives
// a debounced value from it (see useDebouncedValue) for actually filtering entries, so typing
// itself never feels laggy.
export default function SearchBar({ value, onChangeText, showFilters, onToggleFilters }: Props) {
  return (
    <View style={styles.row}>
      <TextInput
        mode="outlined"
        placeholder="Search…"
        accessibilityLabel="Search catalogue"
        value={value}
        onChangeText={onChangeText}
        dense
        style={styles.input}
        left={<TextInput.Icon icon="magnify" />}
        right={
          value ? (
            <TextInput.Icon
              icon="close"
              testID="search-clear-icon"
              accessibilityLabel="Clear search"
              onPress={() => onChangeText('')}
            />
          ) : undefined
        }
      />
      <IconButton
        icon="filter-variant"
        selected={showFilters}
        accessibilityLabel="Toggle filters"
        onPress={onToggleFilters}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  input: {
    flex: 1,
  },
});
