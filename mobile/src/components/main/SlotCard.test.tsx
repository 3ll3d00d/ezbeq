import { render, screen, userEvent } from '@testing-library/react-native';

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
