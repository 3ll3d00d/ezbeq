import { fireEvent, render, screen, userEvent, within } from '@testing-library/react-native';

import SlotsGrid, { columnsForWidth } from './SlotsGrid';
import type { SlotState } from '../../types/ezbeq';

const slots: SlotState[] = [
  { id: '1', active: true, last: 'A' },
  { id: '2', active: false, last: 'B' },
];

const fiveSlots: SlotState[] = Array.from({ length: 5 }, (_, i) => ({
  id: String(i + 1),
  active: false,
  last: `Slot ${i + 1}`,
}));

// A raw layout-change payload from a real device only ever sets `width`/`height` on the
// container itself - x/y aren't relevant to columnsForWidth, but LayoutChangeEvent requires them.
const layoutEvent = (width: number) => ({
  nativeEvent: { layout: { x: 0, y: 0, width, height: 100 } },
});

describe('columnsForWidth', () => {
  test('defaults to 2 before a real layout width is known', () => {
    expect(columnsForWidth(0)).toBe(2);
  });

  test('never goes below 1 column, even narrower than a single card', () => {
    expect(columnsForWidth(120)).toBe(1);
  });

  test('adds a column every 200px of available width', () => {
    expect(columnsForWidth(200)).toBe(1);
    expect(columnsForWidth(399)).toBe(1);
    expect(columnsForWidth(400)).toBe(2);
    expect(columnsForWidth(799)).toBe(3);
  });

  test('caps at 4 columns on very wide (e.g. unfolded tablet-width) containers', () => {
    expect(columnsForWidth(2000)).toBe(4);
  });
});

test('renders a card per slot', async () => {
  await render(
    <SlotsGrid slots={slots} selectedSlotId="1" pendingSlotIds={new Set()} onActivate={jest.fn()} onClear={jest.fn()} />
  );

  expect(screen.getByTestId('slot-card-1')).toBeTruthy();
  expect(screen.getByTestId('slot-card-2')).toBeTruthy();
});

test('marks only the selected slot as selected', async () => {
  await render(
    <SlotsGrid slots={slots} selectedSlotId="2" pendingSlotIds={new Set()} onActivate={jest.fn()} onClear={jest.fn()} />
  );

  expect(screen.getByTestId('slot-card-1').props.accessibilityState).toEqual({ selected: false });
  expect(screen.getByTestId('slot-card-2').props.accessibilityState).toEqual({ selected: true });
});

test('tapping a card calls onActivate with its id', async () => {
  const onActivate = jest.fn();
  const user = userEvent.setup();
  await render(
    <SlotsGrid slots={slots} selectedSlotId={null} pendingSlotIds={new Set()} onActivate={onActivate} onClear={jest.fn()} />
  );

  await user.press(screen.getByTestId('slot-card-2'));

  expect(onActivate).toHaveBeenCalledWith('2');
});

test('tapping a clear button calls onClear with its slot id', async () => {
  const onClear = jest.fn();
  const user = userEvent.setup();
  await render(
    <SlotsGrid slots={slots} selectedSlotId={null} pendingSlotIds={new Set()} onActivate={jest.fn()} onClear={onClear} />
  );

  await user.press(screen.getByLabelText('Clear slot 2'));

  expect(onClear).toHaveBeenCalledWith('2');
});

test('shows the pending spinner only for slots in pendingSlotIds', async () => {
  await render(
    <SlotsGrid slots={slots} selectedSlotId={null} pendingSlotIds={new Set(['2'])} onActivate={jest.fn()} onClear={jest.fn()} />
  );

  expect(screen.getByLabelText('Clear slot 1')).toBeTruthy();
  expect(screen.queryByLabelText('Clear slot 2')).toBeNull();
});

test('defaults to a 2-column grid before any layout event has been reported', async () => {
  await render(
    <SlotsGrid slots={fiveSlots} selectedSlotId={null} pendingSlotIds={new Set()} onActivate={jest.fn()} onClear={jest.fn()} />
  );

  expect(within(screen.getByTestId('slots-grid-row-0')).getAllByTestId(/^slot-card-/)).toHaveLength(2);
  expect(within(screen.getByTestId('slots-grid-row-1')).getAllByTestId(/^slot-card-/)).toHaveLength(2);
  expect(within(screen.getByTestId('slots-grid-row-2')).getAllByTestId(/^slot-card-/)).toHaveLength(1);
});

test('widens to more columns once its container reports a tablet/unfolded-width layout', async () => {
  await render(
    <SlotsGrid slots={fiveSlots} selectedSlotId={null} pendingSlotIds={new Set()} onActivate={jest.fn()} onClear={jest.fn()} />
  );

  // 900px -> columnsForWidth clamps to the 4-column cap, so all 5 slots split 4-then-1.
  // fireEvent is async in RNTL v14 (see AGENTS.md) - the resulting setState needs the await to
  // land before the assertions below re-query the tree.
  await fireEvent(screen.getByTestId('slots-grid'), 'layout', layoutEvent(900));

  expect(within(screen.getByTestId('slots-grid-row-0')).getAllByTestId(/^slot-card-/)).toHaveLength(4);
  expect(within(screen.getByTestId('slots-grid-row-1')).getAllByTestId(/^slot-card-/)).toHaveLength(1);
});
