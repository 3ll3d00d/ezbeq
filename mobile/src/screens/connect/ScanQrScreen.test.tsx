import { act, render, screen, userEvent } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import ScanQrScreen from './ScanQrScreen';
import { EzbeqApi } from '../../services/ezbeqApi';
import { ServerProvider } from '../../context/ServerContext';

jest.mock('../../services/ezbeqApi');

// A real <CameraView> can't run in a test environment - stand in with a pressable that fires
// onBarcodeScanned with a fixed payload, and capture the handler itself so a test can also drive
// it directly with a different payload (e.g. an invalid one). Both module-level names must start
// with "mock" (case-insensitive) - that's the only exemption babel-plugin-jest-hoist allows for
// referencing an out-of-scope variable from inside a jest.mock() factory.
let mockCapturedOnBarcodeScanned: ((result: { data: string }) => void) | undefined;
const mockUseCameraPermissions = jest.fn();

jest.mock('expo-camera', () => {
  const { Pressable, Text } = require('react-native');
  return {
    CameraView: ({ onBarcodeScanned }: any) => {
      mockCapturedOnBarcodeScanned = onBarcodeScanned;
      return (
        <Pressable testID="mock-camera" onPress={() => onBarcodeScanned?.({ data: 'http://192.168.1.23:9968' })}>
          <Text>MockCamera</Text>
        </Pressable>
      );
    },
    useCameraPermissions: () => mockUseCameraPermissions(),
  };
});

const navigation = { replace: jest.fn(), goBack: jest.fn(), navigate: jest.fn() } as any;

const renderScreen = async () => {
  const user = userEvent.setup();
  const result = await render(
    <ServerProvider>
      <ScanQrScreen navigation={navigation} route={{ key: 'ScanQr', name: 'ScanQr' } as any} />
    </ServerProvider>
  );
  return { user, ...result };
};

beforeEach(async () => {
  await AsyncStorage.clear();
  (EzbeqApi as jest.Mock).mockReset();
  navigation.replace.mockReset();
  navigation.goBack.mockReset();
  mockUseCameraPermissions.mockReset();
  mockCapturedOnBarcodeScanned = undefined;
});

test('prompts for camera access when not yet granted', async () => {
  const requestPermission = jest.fn();
  mockUseCameraPermissions.mockReturnValue([{ granted: false }, requestPermission]);
  const { user } = await renderScreen();

  expect(screen.queryByTestId('mock-camera')).toBeNull();

  await user.press(screen.getByRole('button', { name: 'Grant Camera Access' }));
  expect(requestPermission).toHaveBeenCalled();
});

test('falls back to manual entry from the permission prompt', async () => {
  mockUseCameraPermissions.mockReturnValue([{ granted: false }, jest.fn()]);
  const { user } = await renderScreen();

  await user.press(screen.getByRole('button', { name: 'Enter address manually instead' }));

  expect(navigation.goBack).toHaveBeenCalled();
});

test('a successful scan validates, pairs, and navigates to Main', async () => {
  mockUseCameraPermissions.mockReturnValue([{ granted: true }, jest.fn()]);
  (EzbeqApi as jest.Mock).mockImplementation(() => ({
    getVersion: jest.fn().mockResolvedValue({}),
  }));
  const { user } = await renderScreen();

  await user.press(screen.getByTestId('mock-camera'));

  expect(navigation.replace).toHaveBeenCalledWith('Main');
  expect(EzbeqApi).toHaveBeenCalledWith('http://192.168.1.23:9968');
  expect(JSON.parse((await AsyncStorage.getItem('ezbeq:serverConnection'))!)).toEqual({
    baseUrl: 'http://192.168.1.23:9968',
  });
});

test('shows an error and does not navigate when the scanned server is unreachable', async () => {
  mockUseCameraPermissions.mockReturnValue([{ granted: true }, jest.fn()]);
  (EzbeqApi as jest.Mock).mockImplementation(() => ({
    getVersion: jest.fn().mockRejectedValue(new Error('network error')),
  }));
  const { user } = await renderScreen();

  await user.press(screen.getByTestId('mock-camera'));

  expect(await screen.findByText(/didn't point to a reachable ezbeq server/)).toBeTruthy();
  expect(navigation.replace).not.toHaveBeenCalled();
});

test('ignores an invalid (non-URL) scanned payload without navigating', async () => {
  mockUseCameraPermissions.mockReturnValue([{ granted: true }, jest.fn()]);
  await renderScreen();

  await act(async () => {
    mockCapturedOnBarcodeScanned?.({ data: 'not-a-url' });
  });
  await screen.findByText(/didn't point to a reachable ezbeq server/);

  expect(navigation.replace).not.toHaveBeenCalled();
  expect(EzbeqApi).not.toHaveBeenCalled();
});
