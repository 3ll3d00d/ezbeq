import { Platform, Pressable, StyleSheet, View, type PressableProps } from 'react-native';
import { ActivityIndicator, IconButton, Text, useTheme } from 'react-native-paper';

import type { SlotState } from '../../types/ezbeq';

type Props = {
  slot: SlotState;
  selected: boolean;
  pending: boolean;
  onSelect: () => void;
  onClear: () => void;
  // tvOS only - see the Platform.isTV branch below. Ignored on phone/tablet.
  hasTVPreferredFocus?: boolean;
};

// Ported from the Slot sub-component in ui/src/components/main/Slots.jsx. Tapping the card
// activates the slot; the clear (X) button is a separate nested Pressable - unlike the web
// version, no stopPropagation is needed to keep the tap from also activating the slot, since RN's
// responder system gives the touch to the innermost Pressable rather than bubbling it outward.
export default function SlotCard({ slot, selected, pending, onSelect, onClear, hasTVPreferredFocus }: Props) {
  const theme = useTheme();
  const lastAuthor = slot.author ? ` (${slot.author})` : '';
  const label = `Slot ${slot.name ?? slot.id}: ${slot.last ?? 'Empty'}${lastAuthor}${selected ? ', active' : ''}`;
  const cardText = (
    <Text variant="bodyMedium" style={styles.label} numberOfLines={Platform.isTV ? 1 : undefined}>
      {slot.name ? slot.name : slot.id}: {slot.last ?? 'Empty'}
      {lastAuthor}
    </Text>
  );

  if (Platform.isTV) {
    // tvOS's focus engine only ever gives focus to one element at a time - a remote has no way to
    // "tap the inner one specifically" the way a finger can, so the nested-Pressable-inside-a-
    // Pressable structure the phone/tablet branch below uses (fine for touch) doesn't translate.
    // Two independently-focusable siblings instead: the label area activates the slot, the clear
    // button is its own separate focus target. This is a real, still-unverified-on-real-hardware
    // UX call, not just a style tweak - see docs/appletv-implementation-plan.md's
    // "SlotsGrid.tsx / SlotCard.tsx" section.
    return (
      <View
        style={[styles.card, selected ? { backgroundColor: theme.colors.secondaryContainer } : null]}
        testID={`slot-card-${slot.id}`}
      >
        <Pressable
          onPress={onSelect}
          hasTVPreferredFocus={hasTVPreferredFocus}
          // react-native-tvos adds a real `focused` field to Pressable's style-callback state at
          // runtime (confirmed in node_modules/react-native/types/public/ReactNativeTVTypes.d.ts),
          // but its type-only augmentation of `PressableStateCallbackType` doesn't merge into the
          // specific type Pressable.d.ts's own `style` prop signature references, so `focused`
          // structurally type-checks as absent even though it's genuinely present on tvOS. The
          // cast is narrowly scoped to this callback, not a blanket `any`.
          style={
            (({ focused }: { pressed: boolean; focused: boolean }) => [
              styles.tvSelectArea,
              focused ? { backgroundColor: theme.colors.primaryContainer } : null,
            ]) as PressableProps['style']
          }
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ selected }}
          testID={`slot-card-select-${slot.id}`}
        >
          {cardText}
        </Pressable>
        {pending ? (
          <ActivityIndicator size={20} />
        ) : (
          <IconButton icon="close" size={20} accessibilityLabel={`Clear slot ${slot.id}`} onPress={onClear} />
        )}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onSelect}
      style={[styles.card, selected ? { backgroundColor: theme.colors.secondaryContainer } : null]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      testID={`slot-card-${slot.id}`}
    >
      {cardText}
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
  // Fills the space between the card's edge and the clear IconButton - same role `label`'s
  // `flex: 1` plays in the phone/tablet Pressable-only layout above, just on a nested element
  // instead of the Text directly, since the tvOS branch needs its own Pressable in between for
  // independent focusability (see the Platform.isTV branch above).
  tvSelectArea: {
    flex: 1,
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderRadius: 4,
  },
});
