import { act, fireEvent, render, screen, userEvent } from '@testing-library/react-native';

import GainRow from './GainRow';

const baseProps = {
  label: 'Master',
  minGain: -127,
  maxGain: 0,
  step: 0.5,
  value: -10,
  muted: false,
  savedValue: -10,
  savedMuted: false,
  onValueChange: jest.fn(),
  onValueCommit: jest.fn(),
  onMuteToggle: jest.fn(),
};

beforeEach(() => {
  baseProps.onValueChange.mockReset();
  baseProps.onValueCommit.mockReset();
  baseProps.onMuteToggle.mockReset();
});

test('renders the label and formatted value', async () => {
  await render(<GainRow {...baseProps} value={-10} step={0.5} />);

  expect(screen.getByText('Master')).toBeTruthy();
  expect(screen.getByDisplayValue('-10.0')).toBeTruthy();
});

test('dragging the slider calls onValueChange with a rounded value', async () => {
  await render(<GainRow {...baseProps} />);

  await act(async () => {
    fireEvent(screen.getByTestId('gain-slider-Master'), 'valueChange', -8.33);
  });

  expect(baseProps.onValueChange).toHaveBeenCalledWith(-8.3);
});

test('releasing the slider calls onValueCommit', async () => {
  await render(<GainRow {...baseProps} />);

  await act(async () => {
    fireEvent(screen.getByTestId('gain-slider-Master'), 'slidingComplete', -8.33);
  });

  expect(baseProps.onValueCommit).toHaveBeenCalledWith(-8.3);
});

test('typing a value and blurring commits it, clamped to the gain range', async () => {
  await render(<GainRow {...baseProps} />);

  const input = screen.getByDisplayValue('-10.0');
  await act(async () => {
    fireEvent.changeText(input, '5'); // above maxGain (0)
  });
  await act(async () => {
    fireEvent(input, 'blur');
  });

  expect(baseProps.onValueCommit).toHaveBeenCalledWith(0);
});

test('blurring with invalid text reverts to the last committed value without calling onValueCommit', async () => {
  await render(<GainRow {...baseProps} />);

  const input = screen.getByDisplayValue('-10.0');
  await act(async () => {
    fireEvent.changeText(input, 'abc');
  });
  await act(async () => {
    fireEvent(input, 'blur');
  });

  expect(baseProps.onValueCommit).not.toHaveBeenCalled();
  expect(screen.getByDisplayValue('-10.0')).toBeTruthy();
});

test('pressing the mute button toggles muted state', async () => {
  const user = userEvent.setup();
  await render(<GainRow {...baseProps} muted={false} />);

  await user.press(screen.getByLabelText('Mute'));

  expect(baseProps.onMuteToggle).toHaveBeenCalledWith(true);
});

test('shows Unmute label when already muted', async () => {
  await render(<GainRow {...baseProps} muted={true} />);

  expect(screen.getByLabelText('Unmute')).toBeTruthy();
});
