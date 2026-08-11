import { render } from '@testing-library/react-native';

import App from './App';

test('opens on the Connect screen', async () => {
  const { getByText } = await render(<App />);
  expect(getByText('Connect to your ezbeq server')).toBeTruthy();
});
