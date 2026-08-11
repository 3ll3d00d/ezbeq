import { render, screen, userEvent } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import ConnectScreen from './ConnectScreen';
import { EzbeqApi } from '../../services/ezbeqApi';
import { ServerProvider } from '../../context/ServerContext';

// fireEvent doesn't reliably flush React 19's concurrent-mode state updates between calls in
// this environment - a changeText immediately followed by a press can fire against a still-stale
// (e.g. still-disabled) render. userEvent's built-in act-wrapping per interaction step doesn't
// have that problem, so it's used throughout instead - see mobile/AGENTS.md.
jest.mock('../../services/ezbeqApi');

const navigation = { replace: jest.fn(), navigate: jest.fn() } as any;

const renderScreen = async () => {
  const user = userEvent.setup();
  const result = await render(
    <ServerProvider>
      <ConnectScreen navigation={navigation} route={{ key: 'Connect', name: 'Connect' } as any} />
    </ServerProvider>
  );
  return { user, ...result };
};

beforeEach(async () => {
  await AsyncStorage.clear();
  (EzbeqApi as jest.Mock).mockReset();
  navigation.replace.mockReset();
  navigation.navigate.mockReset();
});

test('a successful test connects, persists, and navigates to Main', async () => {
  (EzbeqApi as jest.Mock).mockImplementation(() => ({
    getVersion: jest.fn().mockResolvedValue({ pythonSupported: true }),
  }));
  const { user } = await renderScreen();

  await user.type(screen.getByPlaceholderText('192.168.1.23'), '192.168.1.23');
  await user.clear(screen.getByPlaceholderText('8080'));
  await user.type(screen.getByPlaceholderText('8080'), '9968');
  await user.press(screen.getByRole('button', { name: 'Test & Connect' }));

  expect(navigation.replace).toHaveBeenCalledWith('Main');
  expect(EzbeqApi).toHaveBeenCalledWith('http://192.168.1.23:9968');
  expect(JSON.parse((await AsyncStorage.getItem('ezbeq:serverConnection'))!)).toEqual({
    baseUrl: 'http://192.168.1.23:9968',
  });
});

test('shows an error and does not navigate when the server is unreachable', async () => {
  (EzbeqApi as jest.Mock).mockImplementation(() => ({
    getVersion: jest.fn().mockRejectedValue(new Error('network error')),
  }));
  const { user } = await renderScreen();

  await user.type(screen.getByPlaceholderText('192.168.1.23'), '192.168.1.23');
  await user.press(screen.getByRole('button', { name: 'Test & Connect' }));

  expect(await screen.findByText(/Couldn't reach a server/)).toBeTruthy();
  expect(navigation.replace).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem('ezbeq:serverConnection')).toBeNull();
});

test('the connect button is disabled until a host is entered', async () => {
  const { user } = await renderScreen();

  expect(screen.getByRole('button', { name: 'Test & Connect' })).toBeDisabled();

  await user.type(screen.getByPlaceholderText('192.168.1.23'), '192.168.1.23');

  expect(screen.getByRole('button', { name: 'Test & Connect' })).not.toBeDisabled();
});

test('switching to https changes the constructed base URL', async () => {
  (EzbeqApi as jest.Mock).mockImplementation(() => ({
    getVersion: jest.fn().mockResolvedValue({}),
  }));
  const { user } = await renderScreen();

  await user.press(screen.getByRole('button', { name: 'https' }));
  await user.type(screen.getByPlaceholderText('192.168.1.23'), 'ezbeq.example.com');
  await user.clear(screen.getByPlaceholderText('8080'));
  await user.press(screen.getByRole('button', { name: 'Test & Connect' }));

  expect(navigation.replace).toHaveBeenCalledWith('Main');
  expect(EzbeqApi).toHaveBeenCalledWith('https://ezbeq.example.com');
});

test('the "Scan QR code instead" link navigates to ScanQr', async () => {
  const { user } = await renderScreen();

  await user.press(screen.getByRole('button', { name: 'Scan QR code instead' }));

  expect(navigation.navigate).toHaveBeenCalledWith('ScanQr');
});
