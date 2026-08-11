import { Linking } from 'react-native';
import { render, screen, userEvent } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';
import type { ReactElement } from 'react';

import UpdateAvailableBanner from './UpdateAvailableBanner';

jest.spyOn(Linking, 'openURL').mockResolvedValue(true);

// Renders through <Portal>, which needs a <Portal.Host> ancestor - normally supplied by
// <PaperProvider> at the app root (App.tsx).
const renderBanner = (element: ReactElement) => render(<PaperProvider>{element}</PaperProvider>);

test('shows nothing when no update is available', async () => {
  await renderBanner(<UpdateAvailableBanner updateAvailable={false} onDismiss={jest.fn()} />);

  expect(screen.queryByText(/is available/)).toBeNull();
});

test('shows the latest version', async () => {
  await renderBanner(<UpdateAvailableBanner updateAvailable={true} latestVersion="2.1.0" onDismiss={jest.fn()} />);

  expect(screen.getByText('ezbeq 2.1.0 is available.')).toBeTruthy();
});

test('pressing View opens the GitHub release page', async () => {
  const user = userEvent.setup();
  await renderBanner(<UpdateAvailableBanner updateAvailable={true} latestVersion="2.1.0" onDismiss={jest.fn()} />);

  await user.press(screen.getByText('View'));

  expect(Linking.openURL).toHaveBeenCalledWith('https://github.com/3ll3d00d/ezbeq/releases/tag/2.1.0');
});

test('pressing the close icon calls onDismiss', async () => {
  const onDismiss = jest.fn();
  const user = userEvent.setup();
  await renderBanner(<UpdateAvailableBanner updateAvailable={true} latestVersion="2.1.0" onDismiss={onDismiss} />);

  await user.press(screen.getByLabelText('Close icon'));

  expect(onDismiss).toHaveBeenCalled();
});
