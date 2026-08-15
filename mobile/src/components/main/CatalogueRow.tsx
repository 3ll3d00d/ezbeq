import { Pressable, StyleSheet, View, type PressableProps } from 'react-native';
import { Avatar, Chip, Text, useTheme } from 'react-native-paper';

import { initialFor, stringToColor } from '../../utils/avatarColor';
import type { CatalogueEntry } from '../../types/ezbeq';

type Props = {
  entry: CatalogueEntry;
  selected: boolean;
  onPress: (id: number) => void;
};

export default function CatalogueRow({ entry, selected, onPress }: Props) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={() => onPress(entry.id)}
      // Unconditional, not Platform.isTV-gated - `focused` only ever becomes true from a real
      // tvOS focus-engine event (see SlotCard.tsx's own comment on the type-only gap that makes
      // the cast below necessary), so this branch is simply always inert on phone/tablet.
      style={
        (({ focused }: { pressed: boolean; focused: boolean }) => [
          styles.row,
          selected ? { backgroundColor: theme.colors.secondaryContainer } : null,
          focused ? { backgroundColor: theme.colors.primaryContainer } : null,
        ]) as PressableProps['style']
      }
      accessibilityRole="button"
      accessibilityLabel={`${entry.formattedTitle}, by ${entry.author}`}
      accessibilityState={{ selected }}
      testID={`catalogue-row-${entry.id}`}
    >
      <Avatar.Text
        size={36}
        label={initialFor(entry.author)}
        style={{ backgroundColor: stringToColor(entry.author) }}
      />
      <View style={styles.text}>
        <Text variant="bodyLarge" numberOfLines={2}>
          {entry.formattedTitle}
        </Text>
        <View style={styles.chips}>
          {entry.audioTypes.map((audioType) => (
            <Chip key={audioType} compact style={styles.chip}>
              {audioType}
            </Chip>
          ))}
          {entry.edition ? (
            <Chip compact style={styles.chip}>
              {entry.edition}
            </Chip>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    gap: 12,
  },
  text: {
    flex: 1,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 4,
    gap: 4,
  },
  chip: {
    marginRight: 0,
  },
});
