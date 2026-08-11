import { render, screen, userEvent } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';
import type { ReactElement } from 'react';

import PythonVersionWarningBanner from './PythonVersionWarningBanner';

// Renders through <Portal>, which needs a <Portal.Host> ancestor - normally supplied by
// <PaperProvider> at the app root (App.tsx).
const renderBanner = (element: ReactElement) => render(<PaperProvider>{element}</PaperProvider>);

test('shows nothing when python is supported', async () => {
  await renderBanner(
    <PythonVersionWarningBanner
      pythonUnsupported={false}
      pythonVersion="3.9.0"
      minPythonVersion="3.10"
      onDismiss={jest.fn()}
    />
  );

  expect(screen.queryByText(/Running Python/)).toBeNull();
});

test('shows the current and minimum required python versions', async () => {
  await renderBanner(
    <PythonVersionWarningBanner
      pythonUnsupported={true}
      pythonVersion="3.9.0"
      minPythonVersion="3.10"
      onDismiss={jest.fn()}
    />
  );

  expect(screen.getByText(/Running Python 3\.9\.0/)).toBeTruthy();
  expect(screen.getByText(/requires 3\.10\+/)).toBeTruthy();
});

test('pressing the close icon calls onDismiss', async () => {
  const onDismiss = jest.fn();
  const user = userEvent.setup();
  await renderBanner(
    <PythonVersionWarningBanner
      pythonUnsupported={true}
      pythonVersion="3.9.0"
      minPythonVersion="3.10"
      onDismiss={onDismiss}
    />
  );

  await user.press(screen.getByLabelText('Close icon'));

  expect(onDismiss).toHaveBeenCalled();
});
