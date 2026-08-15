import { render, screen, userEvent } from '@testing-library/react-native';
import { Platform } from 'react-native';

import SlotCard from './SlotCard';
import type { SlotState } from '../../types/ezbeq';

const slot = (overrides: Partial<SlotState> = {}): SlotState => ({ id: '1', active: false, ...overrides });

test('shows the slot id and last-loaded filter when the slot has no name', async () => {
  await render(
    <SlotCard slot={slot({ last: 'Interstellar (2014)' })} selected={false} pending={false} onSelect={jest.fn()} onClear={jest.fn()} />
  );

  expect(screen.getByText(/^1: Interstellar \(2014\)/)).toBeTruthy();
});

test('shows Empty when nothing is loaded', async () => {
  await render(<SlotCard slot={slot()} selected={false} pending={false} onSelect={jest.fn()} onClear={jest.fn()} />);

  expect(screen.getByText(/Empty/)).toBeTruthy();
});

test('appends the author in parens when present', async () => {
  await render(
    <SlotCard
      slot={slot({ last: 'Interstellar (2014)', author: 'mkane' })}
      selected={false}
      pending={false}
      onSelect={jest.fn()}
      onClear={jest.fn()}
    />
  );

  expect(screen.getByText('1: Interstellar (2014) (mkane)')).toBeTruthy();
});

test('pressing the card calls onSelect', async () => {
  const onSelect = jest.fn();
  const user = userEvent.setup();
  await render(<SlotCard slot={slot()} selected={false} pending={false} onSelect={onSelect} onClear={jest.fn()} />);

  await user.press(screen.getByTestId('slot-card-1'));

  expect(onSelect).toHaveBeenCalled();
});

test('pressing the clear button calls onClear but not onSelect', async () => {
  const onSelect = jest.fn();
  const onClear = jest.fn();
  const user = userEvent.setup();
  await render(<SlotCard slot={slot()} selected={false} pending={false} onSelect={onSelect} onClear={onClear} />);

  await user.press(screen.getByLabelText('Clear slot 1'));

  expect(onClear).toHaveBeenCalled();
  expect(onSelect).not.toHaveBeenCalled();
});

test('shows a spinner instead of the clear button while pending', async () => {
  await render(<SlotCard slot={slot()} selected={false} pending={true} onSelect={jest.fn()} onClear={jest.fn()} />);

  expect(screen.queryByLabelText('Clear slot 1')).toBeNull();
});

test('marks itself selected via accessibility state', async () => {
  await render(<SlotCard slot={slot()} selected={true} pending={false} onSelect={jest.fn()} onClear={jest.fn()} />);

  expect(screen.getByTestId('slot-card-1').props.accessibilityState).toEqual({ selected: true });
});

// tvOS renders select/clear as two independent Pressable siblings instead of the nested structure
// above - a remote's focus engine can only ever target one focusable element at a time, so it has
// no way to "reach the inner one specifically" the way a touch's hit-testing can (see SlotCard.tsx's
// own comment on the Platform.isTV branch for the full reasoning). This only exercises the props
// that branch produces (testID split, hasTVPreferredFocus passed through, select/clear still
// independent) - not real focus-engine behavior, which needs a real Apple TV/tvOS Simulator to
// verify (see docs/appletv-implementation-plan.md's Phase 5).
describe('on tvOS', () => {
  beforeEach(() => {
    jest.spyOn(Platform, 'isTV', 'get').mockReturnValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('pressing the select area calls onSelect but not onClear', async () => {
    const onSelect = jest.fn();
    const onClear = jest.fn();
    const user = userEvent.setup();
    await render(<SlotCard slot={slot()} selected={false} pending={false} onSelect={onSelect} onClear={onClear} />);

    await user.press(screen.getByTestId('slot-card-select-1'));

    expect(onSelect).toHaveBeenCalled();
    expect(onClear).not.toHaveBeenCalled();
  });

  test('pressing the clear button calls onClear but not onSelect', async () => {
    const onSelect = jest.fn();
    const onClear = jest.fn();
    const user = userEvent.setup();
    await render(<SlotCard slot={slot()} selected={false} pending={false} onSelect={onSelect} onClear={onClear} />);

    await user.press(screen.getByLabelText('Clear slot 1'));

    expect(onClear).toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  test('passes hasTVPreferredFocus through to the select area', async () => {
    await render(
      <SlotCard
        slot={slot()}
        selected={false}
        pending={false}
        onSelect={jest.fn()}
        onClear={jest.fn()}
        hasTVPreferredFocus
      />
    );

    expect(screen.getByTestId('slot-card-select-1').props.hasTVPreferredFocus).toBe(true);
  });

  test('shows a spinner instead of the clear button while pending', async () => {
    await render(<SlotCard slot={slot()} selected={false} pending={true} onSelect={jest.fn()} onClear={jest.fn()} />);

    expect(screen.queryByLabelText('Clear slot 1')).toBeNull();
  });
});
