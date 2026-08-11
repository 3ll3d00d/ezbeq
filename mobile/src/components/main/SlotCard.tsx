import { Pressable, StyleSheet } from 'react-native';
import { ActivityIndicator, IconButton, Text, useTheme } from 'react-native-paper';

import type { SlotState } from '../../types/ezbeq';

type Props = {
  slot: SlotState;
  selected: boolean;
  pending: boolean;
  onSelect: () => void;
  onClear: () => void;
};

// Ported from the Slot sub-component in ui/src/components/main/Slots.jsx. Tapping the card
// activates the slot; the clear (X) button is a separate nested Pressable - unlike the web
// version, no stopPropagation is needed to keep the tap from also activating the slot, since RN's
// responder system gives the touch to the innermost Pressable rather than bubbling it outward.
export default function SlotCard({ slot, selected, pending, onSelect, onClear }: Props) {
  const theme = useTheme();
  const lastAuthor = slot.author ? ` (${slot.author})` : '';

  return (
    <Pressable
      onPress={onSelect}
      style={[styles.card, selected ? { backgroundColor: theme.colors.secondaryContainer } : null]}
      accessibilityRole="button"
      accessibilityLabel={`Slot ${slot.name ?? slot.id}: ${slot.last ?? 'Empty'}${lastAuthor}${selected ? ', active' : ''}`}
      accessibilityState={{ selected }}
      testID={`slot-card-${slot.id}`}
    >
      <Text variant="bodyMedium" style={styles.label}>
        {slot.name ? slot.name : slot.id}: {slot.last ?? 'Empty'}
        {lastAuthor}
      </Text>
      {pending ? (
        <ActivityIndicator size={20} />
      ) : (
        <IconButton icon="close" size={20} accessibilityLabel={`Clear slot ${slot.id}`} onPress={onClear} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // No flex on `card` itself - it sits in a plain (non-flex, content-sized) `cell` View
  // (see SlotsGrid.tsx), so `flex: 1` here had no definite height to grow into. That ambiguity
  // silently zeroed out the *measured size of the Text child specifically* on-device (Fabric/Yoga,
  // RN 0.86.2) - the fixed-size IconButton sibling kept rendering fine since its size doesn't
  // depend on the ambiguous flex resolution, which is what made this look like a text-only bug.
  // `card`'s width still fills the cell correctly with no flex needed, via the cell's default
  // `alignItems: 'stretch'` cross-axis behavior. Confirmed on-device across several isolated
  // variants: flex on the label (direct Text or a wrapping View) was never the problem - only
  // `card`'s own flex was.
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 8,
    borderRadius: 8,
  },
  label: {
    flex: 1,
  },
});
