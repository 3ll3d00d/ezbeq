import { render, screen } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';
import type { ReactElement } from 'react';

import SuccessSnackbar from './SuccessSnackbar';

// Renders through <Portal>, which needs a <Portal.Host> ancestor - normally supplied by
// <PaperProvider> at the app root (App.tsx).
const renderSnackbar = (element: ReactElement) => render(<PaperProvider>{element}</PaperProvider>);

test('shows nothing when there is no message', async () => {
  await renderSnackbar(<SuccessSnackbar message={null} onDismiss={jest.fn()} />);

  expect(screen.queryByText(/./)).toBeNull();
});

test('shows the success message', async () => {
  await renderSnackbar(<SuccessSnackbar message="Filter loaded" onDismiss={jest.fn()} />);

  expect(screen.getByText('Filter loaded')).toBeTruthy();
});
