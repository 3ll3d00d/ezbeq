import { render, screen, userEvent } from '@testing-library/react-native';

import UploaderControls from './UploaderControls';
import type { SlotState } from '../../types/ezbeq';

const slot = (id: string): SlotState => ({ id, active: false });

test('does not show a slot picker when there is only one slot', async () => {
  await render(
    <UploaderControls
      slots={[slot('1')]}
      uploadSlotId="1"
      setUploadSlotId={jest.fn()}
      sendGain={false}
      setSendGain={jest.fn()}
      acceptGain={false}
      gainAdjustAvailable={true}
      pending={false}
      onUpload={jest.fn()}
    />
  );

  expect(screen.queryByText('1')).toBeNull();
});

test('shows a radio option per slot when there are multiple, and selecting one calls setUploadSlotId', async () => {
  const setUploadSlotId = jest.fn();
  const user = userEvent.setup();
  await render(
    <UploaderControls
      slots={[slot('1'), slot('2')]}
      uploadSlotId="1"
      setUploadSlotId={setUploadSlotId}
      sendGain={false}
      setSendGain={jest.fn()}
      acceptGain={false}
      gainAdjustAvailable={true}
      pending={false}
      onUpload={jest.fn()}
    />
  );

  await user.press(screen.getByTestId('slot-radio-2'));

  expect(setUploadSlotId).toHaveBeenCalledWith('2');
});

test('shows the "Set Input Gain" checkbox only when acceptGain is true', async () => {
  const { rerender } = await render(
    <UploaderControls
      slots={[slot('1')]}
      uploadSlotId="1"
      setUploadSlotId={jest.fn()}
      sendGain={false}
      setSendGain={jest.fn()}
      acceptGain={false}
      gainAdjustAvailable={true}
      pending={false}
      onUpload={jest.fn()}
    />
  );
  expect(screen.queryByLabelText('Set Input Gain')).toBeNull();

  await rerender(
    <UploaderControls
      slots={[slot('1')]}
      uploadSlotId="1"
      setUploadSlotId={jest.fn()}
      sendGain={false}
      setSendGain={jest.fn()}
      acceptGain={true}
      gainAdjustAvailable={true}
      pending={false}
      onUpload={jest.fn()}
    />
  );
  expect(screen.getByLabelText('Set Input Gain')).toBeTruthy();
});

test('the "Set Input Gain" checkbox is disabled when the entry has no MV adjustment to send', async () => {
  const setSendGain = jest.fn();
  const user = userEvent.setup();
  await render(
    <UploaderControls
      slots={[slot('1')]}
      uploadSlotId="1"
      setUploadSlotId={jest.fn()}
      sendGain={false}
      setSendGain={setSendGain}
      acceptGain={true}
      gainAdjustAvailable={false}
      pending={false}
      onUpload={jest.fn()}
    />
  );

  await user.press(screen.getByLabelText('Set Input Gain'));

  expect(setSendGain).not.toHaveBeenCalled();
});

test('toggling the gain checkbox calls setSendGain with the flipped value', async () => {
  const setSendGain = jest.fn();
  const user = userEvent.setup();
  await render(
    <UploaderControls
      slots={[slot('1')]}
      uploadSlotId="1"
      setUploadSlotId={jest.fn()}
      sendGain={false}
      setSendGain={setSendGain}
      acceptGain={true}
      gainAdjustAvailable={true}
      pending={false}
      onUpload={jest.fn()}
    />
  );

  await user.press(screen.getByLabelText('Set Input Gain'));

  expect(setSendGain).toHaveBeenCalledWith(true);
});

test('pressing Upload calls onUpload', async () => {
  const onUpload = jest.fn();
  const user = userEvent.setup();
  await render(
    <UploaderControls
      slots={[slot('1')]}
      uploadSlotId="1"
      setUploadSlotId={jest.fn()}
      sendGain={false}
      setSendGain={jest.fn()}
      acceptGain={false}
      gainAdjustAvailable={true}
      pending={false}
      onUpload={onUpload}
    />
  );

  await user.press(screen.getByText('Upload'));

  expect(onUpload).toHaveBeenCalled();
});

test('the Upload button is disabled while pending, showing a spinner instead of its label', async () => {
  await render(
    <UploaderControls
      slots={[slot('1')]}
      uploadSlotId="1"
      setUploadSlotId={jest.fn()}
      sendGain={false}
      setSendGain={jest.fn()}
      acceptGain={false}
      gainAdjustAvailable={true}
      pending={true}
      onUpload={jest.fn()}
    />
  );

  expect(screen.queryByText('Upload')).toBeNull();
  expect(screen.getByRole('button')).toBeDisabled();
});

test('the Upload button is disabled when no slot is selected', async () => {
  await render(
    <UploaderControls
      slots={[]}
      uploadSlotId={null}
      setUploadSlotId={jest.fn()}
      sendGain={false}
      setSendGain={jest.fn()}
      acceptGain={false}
      gainAdjustAvailable={true}
      pending={false}
      onUpload={jest.fn()}
    />
  );

  expect(screen.getByRole('button')).toBeDisabled();
});
