import { chunk } from 'lodash';
import { useState } from 'react';
import { type LayoutChangeEvent, StyleSheet, View } from 'react-native';

import SlotCard from './SlotCard';
import type { SlotState } from '../../types/ezbeq';

type Props = {
  slots: SlotState[];
  selectedSlotId: string | null;
  pendingSlotIds: ReadonlySet<string>;
  onActivate: (slotId: string) => void;
  onClear: (slotId: string) => void;
};

// Below this, a SlotCard's title/author text has too little room next to its clear button and
// wraps onto several lines (see SlotCard's own comment on why its label can't just flex-shrink
// around that).
const MIN_CARD_WIDTH = 200;
// Devices rarely expose more than a handful of slots - past 4 columns each card gets wider than
// it needs to be for little practical benefit, even on a large unfolded/tablet screen.
const MAX_COLUMNS = 4;

// Originally a flat chunk(arr, 2) ported from ui/src/components/main/Slots.jsx. That's fine on a
// phone but wastes most of the row on a tablet-width screen or a foldable's unfolded inner
// display - and, being a fixed count rather than a window-dimensions read, it's *also* right for
// the case a fixed count can't be: this pane's own available width, not the screen's. In the
// split (list | detail) layout the grid only ever gets half the screen, and a screen-width-based
// column count would overshoot there - so this measures its own container via onLayout instead of
// taking a screen-level isTablet/useWide prop.
export const columnsForWidth = (width: number): number =>
  width > 0 ? Math.min(MAX_COLUMNS, Math.max(1, Math.floor(width / MIN_CARD_WIDTH))) : 2;

// Ported from ui/src/components/main/Slots.jsx. An earlier version used a flexWrap row with
// width:'50%' cells instead, reasoning that RN flexbox wraps natively so pre-chunking shouldn't be
// necessary - but that combination (a percentage width inside a flex-wrap row) is a known Yoga
// layout pitfall, and on-device it silently collapsed every cell to zero effective width, leaving
// only each card's fixed-size clear button visible with no card background or text at all.
// Explicit row-pairing with flex:1 cells (no percentages, no wrap) sidesteps the bug entirely - so
// the responsive column count above still feeds into the same row-chunking structure, just with a
// variable chunk size instead of a hardcoded 2.
export default function SlotsGrid({ slots, selectedSlotId, pendingSlotIds, onActivate, onClear }: Props) {
  // 0 (-> the 2-column default) until the first layout pass reports a real width, matching the
  // previous fixed behaviour rather than flashing a single column on first render.
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const rows = chunk(slots, columnsForWidth(width));
  return (
    <View style={styles.grid} onLayout={onLayout} testID="slots-grid">
      {rows.map((row, i) => (
        <View key={row[0].id} style={styles.row} testID={`slots-grid-row-${i}`}>
          {row.map((slot, j) => (
            <View key={slot.id} style={styles.cell}>
              <SlotCard
                slot={slot}
                selected={slot.id === selectedSlotId}
                pending={pendingSlotIds.has(slot.id)}
                onSelect={() => onActivate(slot.id)}
                onClear={() => onClear(slot.id)}
                // tvOS only (SlotCard ignores this off tvOS) - lands the focus engine somewhere
                // sane on first render instead of nowhere. The very first slot, not e.g. the
                // active one, since "active" can be null (no slot loaded yet) and this only needs
                // *a* starting point, not the "right" one - see
                // docs/appletv-implementation-plan.md's Phase 2.
                hasTVPreferredFocus={i === 0 && j === 0}
              />
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    padding: 4,
  },
  row: {
    flexDirection: 'row',
  },
  cell: {
    flex: 1,
    padding: 4,
  },
});
