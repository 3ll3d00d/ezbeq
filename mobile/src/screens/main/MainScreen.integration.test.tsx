import { act, fireEvent, render, screen, userEvent, waitFor } from '@testing-library/react-native';
import { useWindowDimensions } from 'react-native';
import { PaperProvider } from 'react-native-paper';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import MainScreen from './MainScreen';
import { DeviceStateProvider } from '../../context/DeviceStateContext';
import { ServerProvider } from '../../context/ServerContext';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { EzbeqApi } from '../../services/ezbeqApi';
import { StateSocket } from '../../services/stateSocket';
import type { CatalogueEntry, DeviceState, VersionInfo } from '../../types/ezbeq';

const mockNavigation = { reset: jest.fn() } as unknown as NativeStackScreenProps<RootStackParamList, 'Main'>['navigation'];
const mockRoute = {} as NativeStackScreenProps<RootStackParamList, 'Main'>['route'];

// This suite is the "structural testing gap" step from the mobile behavioral-parity plan: every
// other component/context test mocks useDeviceState()/StateSocket per-file, so nothing exercises
// the real pair -> WebSocket -> catalogue-load -> render pipeline. These tests mount the actual
// ServerProvider + DeviceStateProvider + MainScreen tree, mocking only the two boundary modules
// (EzbeqApi's network calls, StateSocket's transport), and drive it with real
// Catalogue/CatalogueEntries/DeviceState message shapes - the same pattern DeviceStateContext.test.tsx
// already uses for the context alone, extended up through MainScreen's rendered output.
jest.mock('../../services/ezbeqApi');
jest.mock('../../services/stateSocket');
jest.mock('react-native/Libraries/Utilities/useWindowDimensions');

(useWindowDimensions as jest.Mock).mockReturnValue({ width: 390, height: 844, scale: 2, fontScale: 1 });

let lastSocket: any;

const mockStateSocket = () => {
  (StateSocket as jest.Mock).mockImplementation(function (this: any) {
    this.init = jest.fn((setErr, replaceDevice, setMeta, loadEntries, onConnectionChange) => {
      this.callbacks = { setErr, replaceDevice, setMeta, loadEntries, onConnectionChange };
    });
    this.isConnected = jest.fn(() => false);
    this.close = jest.fn();
    this.loadCatalogue = jest.fn();
    lastSocket = this;
  });
};

const buildApi = (overrides: Record<string, jest.Mock> = {}) => ({
  getDevices: jest.fn().mockResolvedValue({}),
  getAuthors: jest.fn().mockResolvedValue([]),
  getLanguages: jest.fn().mockResolvedValue([]),
  getYears: jest.fn().mockResolvedValue([]),
  getAudioTypes: jest.fn().mockResolvedValue([]),
  getContentTypes: jest.fn().mockResolvedValue([]),
  getWhatsNew: jest.fn().mockResolvedValue([]),
  getVersion: jest.fn().mockResolvedValue({} as VersionInfo),
  activateSlot: jest.fn(),
  clearSlot: jest.fn(),
  sendFilter: jest.fn(),
  loadWithMV: jest.fn(),
  ...overrides,
});

const pairServer = () =>
  AsyncStorage.setItem('ezbeq:serverConnection', JSON.stringify({ baseUrl: 'http://host:8080' }));

const renderApp = async () =>
  render(
    <PaperProvider>
      <ServerProvider>
        <DeviceStateProvider>
          <MainScreen navigation={mockNavigation} route={mockRoute} />
        </DeviceStateProvider>
      </ServerProvider>
    </PaperProvider>
  );

const device = (overrides: Partial<DeviceState> = {}): DeviceState => ({
  name: 'd1',
  type: 'minidsp',
  connected: true,
  slots: [{ id: '1', active: true }],
  ...overrides,
});

const entry = (overrides: Partial<CatalogueEntry> = {}): CatalogueEntry => ({
  id: 1,
  title: 'Movie One',
  formattedTitle: 'Movie One (2020)',
  author: 'mkane',
  year: 2020,
  audioTypes: ['Atmos'],
  contentType: 'film',
  ...overrides,
});

beforeEach(async () => {
  await AsyncStorage.clear();
  (EzbeqApi as jest.Mock).mockReset();
  (StateSocket as jest.Mock).mockReset();
  lastSocket = undefined;
  mockStateSocket();
  (useWindowDimensions as jest.Mock).mockReturnValue({ width: 390, height: 844, scale: 2, fontScale: 1 });
});

test('pairing, a Catalogue push, then CatalogueEntries renders real entries with no manual refresh - locks in fix #1', async () => {
  (EzbeqApi as jest.Mock).mockImplementation(() => buildApi({ getDevices: jest.fn().mockResolvedValue({ d1: device() }) }));
  await pairServer();

  await renderApp();

  await waitFor(() => expect(lastSocket).toBeDefined());
  // Single-device pairing hides the redundant device name (see f8c49c4) - wait on the slot
  // card instead, which is what actually confirms device data has loaded.
  expect(await screen.findByText('1: Empty')).toBeTruthy();

  // The server unsolicited-pushes a Catalogue message (-> meta) on register; DeviceStateContext's
  // version-change effect reacts by sending 'load catalogue' over the (mocked) socket.
  await act(async () => {
    lastSocket.callbacks.setMeta({ version: 'v1' });
  });
  expect(lastSocket.loadCatalogue).toHaveBeenCalled();

  // The server's CatalogueEntries response arrives asynchronously, with no separate "loaded" signal.
  await act(async () => {
    lastSocket.callbacks.loadEntries({ '1': entry() });
  });

  expect(await screen.findByText('Movie One (2020)')).toBeTruthy();
});

test('populated device.slots renders each slot card with its expected label text - locks in fix #3', async () => {
  (EzbeqApi as jest.Mock).mockImplementation(() =>
    buildApi({
      getDevices: jest.fn().mockResolvedValue({
        d1: device({
          slots: [
            { id: '1', active: false, last: 'Empty' },
            { id: '2', active: true, last: '10 Cloverfield Lane', author: 'aron7awol' },
          ],
        }),
      }),
    })
  );
  await pairServer();

  await renderApp();

  expect(await screen.findByText('1: Empty')).toBeTruthy();
  expect(await screen.findByText('2: 10 Cloverfield Lane (aron7awol)')).toBeTruthy();
});

test('the update-available and Python-version banners can both be visible and are dismissed independently - locks in fix #2', async () => {
  (EzbeqApi as jest.Mock).mockImplementation(() =>
    buildApi({
      getDevices: jest.fn().mockResolvedValue({ d1: device() }),
      getVersion: jest.fn().mockResolvedValue({
        updateAvailable: true,
        latestVersion: '2.1.0',
        pythonSupported: false,
        pythonVersion: '3.9',
        minPythonVersion: '3.11',
      } as VersionInfo),
    })
  );
  await pairServer();
  const user = userEvent.setup();

  await renderApp();

  expect(await screen.findByText('ezbeq 2.1.0 is available.')).toBeTruthy();
  expect(await screen.findByText(/Running Python 3\.9/)).toBeTruthy();

  // Both banners render through their own <Portal>, as independent top-level Snackbars rather
  // than plain siblings of the scrollable catalogue - each must expose its own close control
  // rather than one being swallowed or shadowed by the other. (Paper's Portal.Host renders its
  // children in reverse-mount order, so closeIcons[0] is the later-mounted Python banner's own
  // icon, not the Update banner's - confirmed by which persisted key each press actually flips.
  // Paper's Snackbar also only actually unmounts after its exit animation's completion callback
  // fires, which real Animated timers don't reliably do under Jest, so this asserts the two
  // dismiss handlers are wired independently via their persisted storage keys rather than
  // waiting on that animation.)
  const closeIcons = screen.getAllByLabelText('Close icon');
  expect(closeIcons).toHaveLength(2);

  fireEvent.press(closeIcons[0]);
  await waitFor(async () =>
    expect(await AsyncStorage.getItem('dismissedPythonWarningVersion')).toEqual(JSON.stringify({ value: '3.11' }))
  );
  expect(await AsyncStorage.getItem('dismissedUpdateVersion')).toBeNull();

  fireEvent.press(closeIcons[1]);
  await waitFor(async () =>
    expect(await AsyncStorage.getItem('dismissedUpdateVersion')).toEqual(JSON.stringify({ value: '2.1.0' }))
  );
});

test('a filter option outside the current result set renders strikethrough but stays selectable - re-verifies isInView semantics', async () => {
  (EzbeqApi as jest.Mock).mockImplementation(() =>
    buildApi({
      getDevices: jest.fn().mockResolvedValue({ d1: device() }),
      getAudioTypes: jest.fn().mockResolvedValue(['Atmos', 'DTS']),
      getYears: jest.fn().mockResolvedValue([2020, 2021]),
    })
  );
  await pairServer();
  const user = userEvent.setup();

  await renderApp();
  await waitFor(() => expect(lastSocket).toBeDefined());
  await act(async () => {
    lastSocket.callbacks.setMeta({ version: 'v1' });
    lastSocket.callbacks.loadEntries({
      '1': entry({ id: 1, year: 2020, audioTypes: ['Atmos'] }),
      '2': entry({ id: 2, title: 'Movie Two', formattedTitle: 'Movie Two (2021)', year: 2021, audioTypes: ['DTS'] }),
    });
  });
  await screen.findByText('Movie One (2020)');

  await user.press(screen.getByLabelText('Toggle filters'));
  await user.press(screen.getByText('Audio Types'));
  await user.press(screen.getByTestId('option-Atmos'));
  await user.press(screen.getByText('Done'));

  // Only the Atmos entry (year 2020) now matches, so 2021 - a real, fetched option - falls outside
  // the current result set.
  await waitFor(() => expect(screen.queryByText('Movie Two (2021)')).toBeNull());

  await user.press(screen.getByText('Year'));
  expect(screen.getByTestId('option-label-2021')).toHaveStyle({ textDecorationLine: 'line-through' });
  expect(screen.getByTestId('option-label-2020')).not.toHaveStyle({ textDecorationLine: 'line-through' });

  // Struck-through never means disabled - it must still be selectable, same as the web version.
  await user.press(screen.getByTestId('option-2021'));
  await user.press(screen.getByText('Done'));
  expect(screen.getByLabelText(/Year filter, 2021/)).toBeTruthy();
});

test('wide/tablet layout renders the catalogue and a selected entry detail simultaneously', async () => {
  (useWindowDimensions as jest.Mock).mockReturnValue({ width: 1024, height: 768, scale: 2, fontScale: 1 });
  (EzbeqApi as jest.Mock).mockImplementation(() => buildApi({ getDevices: jest.fn().mockResolvedValue({ d1: device() }) }));
  await pairServer();
  const user = userEvent.setup();

  await renderApp();
  await waitFor(() => expect(lastSocket).toBeDefined());
  await act(async () => {
    lastSocket.callbacks.setMeta({ version: 'v1' });
    lastSocket.callbacks.loadEntries({ '1': entry() });
  });
  await screen.findByText('Movie One (2020)');

  await user.press(screen.getByTestId('catalogue-row-1'));

  // Unlike the narrow phone layout (which navigates away to a full-screen detail view), the wide
  // layout keeps the catalogue row and its detail pane both mounted at once.
  expect(screen.getByTestId('catalogue-row-1')).toBeTruthy();
  expect(screen.getByText('Upload')).toBeTruthy();
  expect(screen.queryByLabelText('Back to results')).toBeNull();
});
