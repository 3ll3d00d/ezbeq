import { act, fireEvent, render, screen, userEvent } from '@testing-library/react-native';

import GainPanel from './GainPanel';
import type { GainsPayload } from '../../types/ezbeq';

const defaultGain: GainsPayload = {
  master_mv: 0,
  master_mute: false,
  gains: [],
  mutes: [],
  output_gains: [],
  output_mutes: [],
};

test('renders nothing when the device has not reported a master volume', async () => {
  const { toJSON } = await render(
    <GainPanel
      selectedSlotId={null}
      deviceGains={{}}
      gains={{}}
      updateGain={jest.fn()}
      commitGain={jest.fn()}
    />
  );

  expect(toJSON()).toBeNull();
});

test('renders the master row and calls updateGain/commitGain', async () => {
  const updateGain = jest.fn();
  const commitGain = jest.fn();
  await render(
    <GainPanel
      selectedSlotId={null}
      deviceGains={defaultGain}
      gains={{ ...defaultGain, master_mv: -12 }}
      updateGain={updateGain}
      commitGain={commitGain}
    />
  );

  expect(screen.getByText('Master')).toBeTruthy();

  await act(async () => {
    fireEvent(screen.getByTestId('gain-slider-Master'), 'slidingComplete', -20);
  });

  expect(commitGain).toHaveBeenCalledWith('master', 'mv', -20);
});

test('does not show the channels section when no slot is selected', async () => {
  await render(
    <GainPanel
      selectedSlotId={null}
      deviceGains={defaultGain}
      gains={{ ...defaultGain, master_mv: -12, gains: [{ id: '1', value: 0 }] }}
      updateGain={jest.fn()}
      commitGain={jest.fn()}
    />
  );

  expect(screen.queryByText(/Channels/)).toBeNull();
});

test('shows a collapsed channels toggle with the combined input+output count', async () => {
  await render(
    <GainPanel
      selectedSlotId="1"
      deviceGains={defaultGain}
      gains={{
        ...defaultGain,
        master_mv: -12,
        gains: [{ id: '1', value: 0 }],
        mutes: [{ id: '1', value: false }],
        output_gains: [{ id: '1', value: 0 }],
        output_mutes: [{ id: '1', value: false }],
      }}
      updateGain={jest.fn()}
      commitGain={jest.fn()}
    />
  );

  expect(screen.getByText('Channels (2)')).toBeTruthy();
  expect(screen.queryByText('In 1')).toBeNull();
});

test('expanding channels reveals input and output rows', async () => {
  const user = userEvent.setup();
  await render(
    <GainPanel
      selectedSlotId="1"
      deviceGains={defaultGain}
      gains={{
        ...defaultGain,
        master_mv: -12,
        gains: [{ id: '1', value: 0 }],
        mutes: [{ id: '1', value: false }],
        output_gains: [{ id: '2', value: 0 }],
        output_mutes: [{ id: '2', value: false }],
      }}
      updateGain={jest.fn()}
      commitGain={jest.fn()}
    />
  );

  await user.press(screen.getByText('Channels (2)'));

  expect(screen.getByText('In 1')).toBeTruthy();
  expect(screen.getByText('Out 2')).toBeTruthy();
});

test('committing an input channel row uses the channel id as the parent', async () => {
  const commitGain = jest.fn();
  const user = userEvent.setup();
  await render(
    <GainPanel
      selectedSlotId="1"
      deviceGains={defaultGain}
      gains={{
        ...defaultGain,
        master_mv: -12,
        gains: [{ id: '3', value: 0 }],
        mutes: [{ id: '3', value: false }],
      }}
      updateGain={jest.fn()}
      commitGain={commitGain}
    />
  );
  await user.press(screen.getByText('Channels (1)'));

  await user.press(screen.getAllByLabelText('Mute')[1]); // [0] is the Master row

  expect(commitGain).toHaveBeenCalledWith('3', 'mute', true);
});

test("committing an output channel row prefixes the parent with 'out_'", async () => {
  const commitGain = jest.fn();
  const user = userEvent.setup();
  await render(
    <GainPanel
      selectedSlotId="1"
      deviceGains={defaultGain}
      gains={{
        ...defaultGain,
        master_mv: -12,
        output_gains: [{ id: '4', value: 0 }],
        output_mutes: [{ id: '4', value: false }],
      }}
      updateGain={jest.fn()}
      commitGain={commitGain}
    />
  );
  await user.press(screen.getByText('Channels (1)'));

  await user.press(screen.getAllByLabelText('Mute')[1]); // [0] is the Master row

  expect(commitGain).toHaveBeenCalledWith('out_4', 'mute', true);
});
