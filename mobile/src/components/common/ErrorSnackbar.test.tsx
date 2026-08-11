import { render, screen, userEvent } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';
import type { ReactElement } from 'react';

import ErrorSnackbar from './ErrorSnackbar';

// Renders through <Portal>, which needs a <Portal.Host> ancestor - normally supplied by
// <PaperProvider> at the app root (App.tsx).
const renderSnackbar = (element: ReactElement) => render(<PaperProvider>{element}</PaperProvider>);

test('shows nothing when there is no error', async () => {
  await renderSnackbar(<ErrorSnackbar error={null} onDismiss={jest.fn()} />);

  expect(screen.queryByText(/./)).toBeNull();
});

test('shows the error message', async () => {
  await renderSnackbar(<ErrorSnackbar error={new Error('device offline')} onDismiss={jest.fn()} />);

  expect(screen.getByText('device offline')).toBeTruthy();
});

test('pressing Close calls onDismiss', async () => {
  const onDismiss = jest.fn();
  const user = userEvent.setup();
  await renderSnackbar(<ErrorSnackbar error={new Error('device offline')} onDismiss={onDismiss} />);

  await user.press(screen.getByText('Close'));

  expect(onDismiss).toHaveBeenCalled();
});
