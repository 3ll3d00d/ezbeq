import { render, screen } from '@testing-library/react-native';

import DeviceDisconnectedBanner from './DeviceDisconnectedBanner';

test('shows the device name and an unreachable message', async () => {
  await render(<DeviceDisconnectedBanner deviceName="d1" />);

  expect(screen.getByText('Device Unreachable', { exact: false })).toBeTruthy();
  expect(screen.getByText(/d1 is not responding/)).toBeTruthy();
});
