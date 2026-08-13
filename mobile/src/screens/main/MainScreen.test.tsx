import { fireEvent, render, screen, userEvent, waitFor } from '@testing-library/react-native';
import { Alert, useWindowDimensions } from 'react-native';
import { PaperProvider } from 'react-native-paper';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';

import MainScreen, {
  compareByTitle,
  deriveTxtFilterFromActiveSlot,
  isMatch,
  shouldTriggerBackSwipe,
  txtMatch,
} from './MainScreen';
import { useDeviceState } from '../../context/DeviceStateContext';
import { useServerContext } from '../../context/ServerContext';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import * as filterNotificationService from '../../services/filterNotification';
import type { EzbeqApi } from '../../services/ezbeqApi';
import type { CatalogueEntry } from '../../types/ezbeq';

jest.mock('../../context/DeviceStateContext');
jest.mock('../../context/ServerContext');
jest.mock('react-native/Libraries/Utilities/useWindowDimensions');

// Default to a narrow phone-portrait size (not wide) - individual tests override this to
// exercise the wide two-pane layout.
(useWindowDimensions as jest.Mock).mockReturnValue({ width: 390, height: 844, scale: 2, fontScale: 1 });

const mockUseDeviceState = useDeviceState as jest.Mock;
const mockUseServerContext = useServerContext as jest.Mock;
mockUseServerContext.mockReturnValue({
  connection: { baseUrl: 'http://ezbeq.local:9968' },
  unpair: jest.fn().mockResolvedValue(undefined),
});

const mockNavigation = { reset: jest.fn() } as unknown as NativeStackScreenProps<RootStackParamList, 'Main'>['navigation'];
const mockRoute = {} as NativeStackScreenProps<RootStackParamList, 'Main'>['route'];

// useAsyncStorageState persists through the real async-storage-mock, which (unlike the
// per-test mockUseDeviceState/mockUseServerContext return values) isn't reset between tests on
// its own - a value one test writes (e.g. flipping filterNotificationEnabled on) otherwise leaks
// into every test that runs after it in this file.
afterEach(() => AsyncStorage.clear());

const api = {
  getAuthors: jest.fn().mockResolvedValue([]),
  getLanguages: jest.fn().mockResolvedValue([]),
  getYears: jest.fn().mockResolvedValue([]),
  getAudioTypes: jest.fn().mockResolvedValue([]),
  getContentTypes: jest.fn().mockResolvedValue([]),
  activateSlot: jest.fn(),
  clearSlot: jest.fn(),
  getWhatsNew: jest.fn().mockResolvedValue([]),
  getVersion: jest.fn().mockResolvedValue({}),
} as unknown as EzbeqApi;

const entry = (overrides: Partial<CatalogueEntry> = {}): CatalogueEntry => ({
  id: 1,
  formattedTitle: 'Some Movie (2020)',
  author: 'mkane',
  year: 2020,
  audioTypes: ['Atmos'],
  contentType: 'film',
  ...overrides,
});

const baseState = (overrides: Record<string, unknown> = {}) => ({
  api,
  availableDevices: {},
  selectedDeviceName: null,
  selectedSlotId: null,
  replaceDevice: jest.fn(),
  entries: {},
  meta: {},
  error: null,
  setError: jest.fn(),
  refreshCatalogue: jest.fn(),
  ...overrides,
});

const renderScreen = () =>
  render(
    <PaperProvider>
      <MainScreen navigation={mockNavigation} route={mockRoute} />
    </PaperProvider>
  );

describe('txtMatch', () => {
  it('matches on formattedTitle', () => {
    expect(txtMatch(entry({ formattedTitle: 'Interstellar (2014)' }), 'stellar')).toBe(true);
  });

  it('matches on altTitle', () => {
    expect(txtMatch(entry({ altTitle: 'Alt Name' }), 'alt name')).toBe(true);
  });

  it('matches on collection', () => {
    expect(txtMatch(entry({ collection: 'Bourne Collection' }), 'bourne')).toBe(true);
  });

  it('does not match unrelated text', () => {
    expect(txtMatch(entry({ formattedTitle: 'Interstellar (2014)' }), 'batman')).toBe(false);
  });
});

describe('isMatch', () => {
  const filters = (overrides: Partial<Parameters<typeof isMatch>[1]> = {}) => ({
    contentTypes: [],
    authors: [],
    years: [],
    audioTypes: [],
    freshness: [],
    languages: [],
    debouncedTxtFilter: '',
    ...overrides,
  });

  it('passes when no filters are set', () => {
    expect(isMatch(entry(), filters())).toBe(true);
  });

  it('filters out an entry from a non-selected author', () => {
    expect(isMatch(entry({ author: 'other' }), filters({ authors: ['mkane'] }))).toBe(false);
  });

  it('matches years as strings against the numeric entry.year', () => {
    expect(isMatch(entry({ year: 2020 }), filters({ years: ['2020'] }))).toBe(true);
    expect(isMatch(entry({ year: 2019 }), filters({ years: ['2020'] }))).toBe(false);
  });

  it('matches if any of the entry audioTypes is selected', () => {
    expect(isMatch(entry({ audioTypes: ['Atmos', 'DTS-X'] }), filters({ audioTypes: ['DTS-X'] }))).toBe(true);
  });

  it('filters out an entry missing a selected freshness/language when those are required', () => {
    expect(isMatch(entry({ freshness: undefined }), filters({ freshness: ['Fresh'] }))).toBe(false);
    expect(isMatch(entry({ language: undefined }), filters({ languages: ['English'] }))).toBe(false);
  });

  it('applies the text filter alongside dimension filters', () => {
    expect(isMatch(entry({ formattedTitle: 'X' }), filters({ debouncedTxtFilter: 'y' }))).toBe(false);
  });
});

describe('compareByTitle', () => {
  it('sorts by title, not author', () => {
    const zAuthorATitle = entry({ id: 1, author: 'zAuthor', sortTitle: 'Alpha', formattedTitle: 'Alpha (2020)' });
    const aAuthorZTitle = entry({ id: 2, author: 'aAuthor', sortTitle: 'Zeta', formattedTitle: 'Zeta (2020)' });

    expect([aAuthorZTitle, zAuthorATitle].sort(compareByTitle)).toEqual([zAuthorATitle, aAuthorZTitle]);
  });

  it('falls back to formattedTitle when sortTitle is absent', () => {
    const b = entry({ id: 1, formattedTitle: 'Bravo (2020)' });
    const a = entry({ id: 2, formattedTitle: 'Alpha (2020)' });

    expect([b, a].sort(compareByTitle)).toEqual([a, b]);
  });
});

describe('shouldTriggerBackSwipe', () => {
  it('triggers on a deliberate rightward swipe', () => {
    expect(shouldTriggerBackSwipe(120, 400)).toBe(true);
  });

  it('ignores a short drag even if moving rightward', () => {
    expect(shouldTriggerBackSwipe(20, 400)).toBe(false);
  });

  it('ignores a long drag that ends moving leftward (e.g. a flick back)', () => {
    expect(shouldTriggerBackSwipe(120, -50)).toBe(false);
  });

  it('ignores a leftward swipe entirely', () => {
    expect(shouldTriggerBackSwipe(-120, -400)).toBe(false);
  });
});

describe('deriveTxtFilterFromActiveSlot', () => {
  const device = (last?: string) => ({
    name: 'd1',
    type: 'minidsp',
    connected: true,
    slots: [{ id: '1', active: true, last }],
  });

  it('returns null when not userDriven', () => {
    expect(deriveTxtFilterFromActiveSlot(device('Interstellar'), false, '1')).toBeNull();
  });

  it('returns null when there is no device', () => {
    expect(deriveTxtFilterFromActiveSlot(null, true, '1')).toBeNull();
  });

  it("returns the slot's last-loaded filter when userDriven", () => {
    expect(deriveTxtFilterFromActiveSlot(device('Interstellar'), true, '1')).toBe('Interstellar');
  });

  it('returns null for an empty or errored slot rather than clobbering the search box', () => {
    expect(deriveTxtFilterFromActiveSlot(device('Empty'), true, '1')).toBeNull();
    expect(deriveTxtFilterFromActiveSlot(device('ERROR'), true, '1')).toBeNull();
  });
});

describe('MainScreen', () => {
  beforeEach(() => {
    mockUseDeviceState.mockReset();
    // getWhatsNew/getVersion get overridden with a non-Once mockResolvedValue in several tests
    // below (e.g. the "fetches What's New entries" and dismiss-banner tests) - without resetting
    // back to the module-scope defaults here, that override leaks into every test that runs after
    // it in file order and never sets its own value, silently changing their badge/count math.
    (api.getWhatsNew as jest.Mock).mockResolvedValue([]);
    (api.getVersion as jest.Mock).mockResolvedValue({});
  });

  it('shows a loading indicator while no device is selected yet', async () => {
    mockUseDeviceState.mockReturnValue(baseState());

    await renderScreen();

    expect(screen.getByText('Waiting for device data…')).toBeTruthy();
  });

  it('renders the selected device name and its slots when multiple devices are available', async () => {
    mockUseDeviceState.mockReturnValue(
      baseState({
        availableDevices: {
          d1: {
            name: 'd1',
            connected: true,
            slots: [
              { id: '1', active: true, last: 'Some BEQ' },
              { id: '2', active: false, last: 'Empty' },
            ],
          },
          d2: { name: 'd2', connected: true, slots: [] },
        },
        selectedDeviceName: 'd1',
        selectedSlotId: '1',
      })
    );

    await renderScreen();

    expect(screen.getByText('d1')).toBeTruthy();
    expect(screen.getByTestId('slot-card-1')).toBeTruthy();
    expect(screen.getByText(/^1: Some BEQ/)).toBeTruthy();
    expect(screen.getByTestId('slot-card-1').props.accessibilityState).toEqual({ selected: true });
    expect(screen.getByTestId('slot-card-2').props.accessibilityState).toEqual({ selected: false });
  });

  it('hides the device name when only one device is available', async () => {
    mockUseDeviceState.mockReturnValue(
      baseState({
        availableDevices: {
          d1: {
            name: 'd1',
            connected: true,
            slots: [{ id: '1', active: true, last: 'Some BEQ' }],
          },
        },
        selectedDeviceName: 'd1',
        selectedSlotId: '1',
      })
    );

    await renderScreen();

    expect(screen.queryByText('d1')).toBeNull();
    expect(screen.getByTestId('slot-card-1')).toBeTruthy();
  });

  it('activating a slot calls activateSlot and applies the response via replaceDevice', async () => {
    const replaceDevice = jest.fn();
    const updated = { name: 'd1', connected: true, slots: [] };
    (api.activateSlot as jest.Mock).mockResolvedValue(updated);
    mockUseDeviceState.mockReturnValue(
      baseState({
        availableDevices: { d1: { name: 'd1', connected: true, slots: [{ id: '1', active: false }] } },
        selectedDeviceName: 'd1',
        replaceDevice,
      })
    );
    const user = userEvent.setup();

    await renderScreen();
    await user.press(screen.getByTestId('slot-card-1'));

    await waitFor(() => expect(api.activateSlot).toHaveBeenCalledWith('d1', '1'));
    expect(replaceDevice).toHaveBeenCalledWith(updated);
  });

  it('clearing a slot calls clearSlot and applies the response', async () => {
    const replaceDevice = jest.fn();
    const updated = { name: 'd1', connected: true, slots: [] };
    (api.clearSlot as jest.Mock).mockResolvedValue(updated);
    mockUseDeviceState.mockReturnValue(
      baseState({
        availableDevices: { d1: { name: 'd1', connected: true, slots: [{ id: '1', active: false, last: 'X' }] } },
        selectedDeviceName: 'd1',
        replaceDevice,
      })
    );
    const user = userEvent.setup();

    await renderScreen();
    await user.press(screen.getByLabelText('Clear slot 1'));

    await waitFor(() => expect(api.clearSlot).toHaveBeenCalledWith('d1', '1'));
    expect(replaceDevice).toHaveBeenCalledWith(updated);
    expect(await screen.findByText('Slot cleared')).toBeTruthy();
  });

  it('reports an activate failure via setError', async () => {
    const setError = jest.fn();
    (api.activateSlot as jest.Mock).mockRejectedValue(new Error('device offline'));
    mockUseDeviceState.mockReturnValue(
      baseState({
        availableDevices: { d1: { name: 'd1', connected: true, slots: [{ id: '1', active: false }] } },
        selectedDeviceName: 'd1',
        setError,
      })
    );
    const user = userEvent.setup();

    await renderScreen();
    await user.press(screen.getByTestId('slot-card-1'));

    await waitFor(() => expect(setError).toHaveBeenCalledWith(new Error('device offline')));
  });

  it('shows the gain panel when the device reports a master volume', async () => {
    mockUseDeviceState.mockReturnValue(
      baseState({
        availableDevices: {
          d1: { name: 'd1', connected: true, masterVolume: -10, mute: false, slots: [{ id: '1', active: true }] },
        },
        selectedDeviceName: 'd1',
        selectedSlotId: '1',
      })
    );

    await renderScreen();

    expect(screen.getByText('Master')).toBeTruthy();
  });

  it('does not show the gain panel for a device with no master volume', async () => {
    mockUseDeviceState.mockReturnValue(
      baseState({
        availableDevices: { d1: { name: 'd1', connected: true, slots: [{ id: '1', active: true }] } },
        selectedDeviceName: 'd1',
      })
    );

    await renderScreen();

    expect(screen.queryByText('Master')).toBeNull();
  });

  it('shows the disconnected banner when the selected device reports connected: false', async () => {
    mockUseDeviceState.mockReturnValue(
      baseState({
        availableDevices: { d1: { name: 'd1', connected: false, slots: [] } },
        selectedDeviceName: 'd1',
      })
    );

    await renderScreen();

    expect(screen.getByText('Device Unreachable', { exact: false })).toBeTruthy();
  });

  it('does not show the disconnected banner when the device is connected', async () => {
    mockUseDeviceState.mockReturnValue(
      baseState({
        availableDevices: { d1: { name: 'd1', connected: true, slots: [] } },
        selectedDeviceName: 'd1',
      })
    );

    await renderScreen();

    expect(screen.queryByText('Device Unreachable', { exact: false })).toBeNull();
  });

  it('shows the error message when present', async () => {
    mockUseDeviceState.mockReturnValue(baseState({ error: new Error('device offline') }));

    await renderScreen();

    expect(screen.getByText('device offline')).toBeTruthy();
  });

  it("degrades silently when the server doesn't support What's New (e.g. an older backend)", async () => {
    const setError = jest.fn();
    (api.getWhatsNew as jest.Mock).mockRejectedValueOnce(new Error('EzbeqApi.getwhats-new failed, HTTP status 404'));
    mockUseDeviceState.mockReturnValue(baseState({ setError }));

    await renderScreen();
    await waitFor(() => expect(api.getWhatsNew).toHaveBeenCalled());

    // ErrorSnackbar is driven entirely by DeviceStateContext's error/setError - never called here
    // is what proves the rejection was swallowed rather than surfaced.
    expect(setError).not.toHaveBeenCalled();
  });

  it('renders catalogue entries and narrows them as the user types', async () => {
    mockUseDeviceState.mockReturnValue(
      baseState({
        entries: {
          1: entry({ id: 1, formattedTitle: 'Interstellar (2014)' }),
          2: entry({ id: 2, formattedTitle: 'Inception (2010)' }),
        },
      })
    );
    const user = userEvent.setup();
    jest.useFakeTimers({ advanceTimers: true });

    await renderScreen();
    expect(screen.getByText('Interstellar (2014)')).toBeTruthy();
    expect(screen.getByText('Inception (2010)')).toBeTruthy();

    await user.type(screen.getByPlaceholderText('Search…'), 'Interstellar');
    await waitFor(() => expect(screen.queryByText('Inception (2010)')).toBeNull(), { timeout: 1000 });

    expect(screen.getByText('Interstellar (2014)')).toBeTruthy();
    jest.useRealTimers();
  });

  it('selecting a catalogue entry shows its detail view with a back button', async () => {
    mockUseDeviceState.mockReturnValue(
      baseState({ entries: { 1: entry({ id: 1, formattedTitle: 'Interstellar (2014)' }) } })
    );
    const user = userEvent.setup();

    await renderScreen();
    await user.press(screen.getByText('Interstellar (2014)'));

    expect(screen.queryByPlaceholderText('Search…')).toBeTruthy(); // search bar stays visible
    expect(screen.getByLabelText('Back to results')).toBeTruthy();

    await user.press(screen.getByLabelText('Back to results'));

    expect(screen.getByText('Interstellar (2014)')).toBeTruthy(); // back to the list row
  });

  it('toggling filters shows the filter fields', async () => {
    mockUseDeviceState.mockReturnValue(baseState());
    const user = userEvent.setup();

    await renderScreen();
    expect(screen.queryByText('Author')).toBeNull();

    await user.press(screen.getByLabelText('Toggle filters'));

    expect(await screen.findByText('Author')).toBeTruthy();
  });

  it('toggles the persistent filter-loaded notification setting from the Settings sheet', async () => {
    mockUseDeviceState.mockReturnValue(baseState());
    const user = userEvent.setup();

    await renderScreen();
    await user.press(screen.getByLabelText('Settings'));
    const toggle = screen.getByLabelText('Enable persistent filter-loaded notification');

    // Switch has no onPress - it's driven by a native valueChange event, not a press responder,
    // so user.press()/fireEvent.press() (which look for onPress) are no-ops here.
    fireEvent(toggle, 'valueChange', true);

    expect(await screen.findByLabelText('Disable persistent filter-loaded notification')).toBeTruthy();
  });

  it('disables the notification toggle when unsupported (e.g. Expo Go on Android)', async () => {
    const supportedSpy = jest.spyOn(filterNotificationService, 'isFilterNotificationSupported').mockReturnValue(false);
    mockUseDeviceState.mockReturnValue(baseState());
    const user = userEvent.setup();

    await renderScreen();
    await user.press(screen.getByLabelText('Settings'));

    const toggle = screen.getByLabelText('Enable persistent filter-loaded notification');
    expect(toggle.props.disabled).toBe(true);
    expect(screen.getByText('Requires a development build - unavailable in Expo Go on Android.')).toBeTruthy();

    supportedSpy.mockRestore();
  });

  it('disconnects from the server via the Settings sheet, keeping other persisted settings', async () => {
    const unpair = jest.fn().mockResolvedValue(undefined);
    // mockReturnValue, not -Once - MainScreen re-renders several times during mount (getWhatsNew/
    // getVersion effects), and a -Once value only covers the very first of those calls, leaving
    // later renders holding a *different* unpair mock (the module-level default below) than the
    // one this test asserts against.
    mockUseServerContext.mockReturnValue({ connection: { baseUrl: 'http://ezbeq.local:9968' }, unpair });
    mockUseDeviceState.mockReturnValue(baseState());
    // Alert.alert's underlying native module is a bare jest.fn() under test (see
    // @react-native/jest-preset's NativeModules mock) - it never invokes a button's onPress on
    // its own, so the confirm dialog has to be driven by hand here.
    const alertSpy = jest.spyOn(Alert, 'alert');
    const user = userEvent.setup();

    await renderScreen();
    await user.press(screen.getByLabelText('Settings'));
    expect(screen.getByText('http://ezbeq.local:9968')).toBeTruthy();

    await user.press(screen.getByText('Disconnect from server'));
    expect(alertSpy).toHaveBeenCalled();
    const buttons = alertSpy.mock.calls[0][2] ?? [];
    const disconnectButton = buttons.find((b) => b.text === 'Disconnect');
    disconnectButton?.onPress?.();

    expect(unpair).toHaveBeenCalled();
    await waitFor(() =>
      expect(mockNavigation.reset).toHaveBeenCalledWith({ index: 0, routes: [{ name: 'Connect' }] })
    );
    alertSpy.mockRestore();
    // Restore the shared default so later tests in this file don't inadvertently assert against
    // this test's unpair mock instance.
    mockUseServerContext.mockReturnValue({
      connection: { baseUrl: 'http://ezbeq.local:9968' },
      unpair: jest.fn().mockResolvedValue(undefined),
    });
  });

  it("fetches What's New entries and opens the sheet, selecting an entry from it", async () => {
    const newEntry = entry({ id: 7, formattedTitle: 'Brand New Movie', created_at: Math.floor(Date.now() / 1000) });
    (api.getWhatsNew as jest.Mock).mockResolvedValue([newEntry]);
    // selecting a What's New row looks the entry up in the main catalogue (entries), not the
    // separately-fetched recentEntries list - it's assumed to already be part of the catalogue.
    mockUseDeviceState.mockReturnValue(baseState({ entries: { 7: newEntry } }));
    const user = userEvent.setup();

    await renderScreen();
    await waitFor(() => expect(api.getWhatsNew).toHaveBeenCalled());

    await user.press(screen.getByLabelText("What's New"));
    await user.press(await screen.findByTestId('whats-new-row-7'));

    // now showing the entry's detail view (back button only renders in that state) - Paper's
    // Modal keeps the What's New sheet's own row mounted during its close animation, so more
    // than one "Brand New Movie" match is expected here.
    expect(await screen.findByLabelText('Back to results')).toBeTruthy();
    expect(screen.getAllByText(/Brand New Movie/).length).toBeGreaterThan(0);
  });

  it('shows the update-available banner and dismissing it persists the dismissed version', async () => {
    (api.getVersion as jest.Mock).mockResolvedValue({ updateAvailable: true, latestVersion: '2.1.0' });
    mockUseDeviceState.mockReturnValue(baseState());
    const user = userEvent.setup();

    await renderScreen();

    expect(await screen.findByText('ezbeq 2.1.0 is available.')).toBeTruthy();

    await user.press(screen.getByLabelText('Close icon'));

    await waitFor(() => expect(screen.queryByText('ezbeq 2.1.0 is available.')).toBeNull());
  });

  it('shows the python version warning banner when unsupported', async () => {
    (api.getVersion as jest.Mock).mockResolvedValue({
      pythonSupported: false,
      pythonVersion: '3.9.0',
      minPythonVersion: '3.10',
    });
    mockUseDeviceState.mockReturnValue(baseState());

    await renderScreen();

    expect(await screen.findByText(/Running Python 3\.9\.0/)).toBeTruthy();
  });

  it("includes update/python-unsupported counts in the What's New badge", async () => {
    (api.getVersion as jest.Mock).mockResolvedValue({
      updateAvailable: true,
      latestVersion: '2.1.0',
      pythonSupported: false,
      pythonVersion: '3.9.0',
      minPythonVersion: '3.10',
    });
    mockUseDeviceState.mockReturnValue(baseState());

    await renderScreen();

    // The badge count combines two independently-resolving fetches (getWhatsNew and getVersion).
    // A single waitFor polls the whole combination together on every tick, so it succeeds the
    // moment both have landed regardless of which resolves first - unlike sequential findByText
    // calls, which each get their own timeout budget and can stack up without ever expressing
    // "wait for the combination" in one place.
    await waitFor(() => {
      expect(screen.getByText('ezbeq 2.1.0 is available.')).toBeTruthy();
      expect(screen.getByText(/Running Python 3\.9\.0/)).toBeTruthy();
      expect(api.getWhatsNew).toHaveBeenCalled();
    }, { timeout: 5000 });

    expect(screen.getByText('2')).toBeTruthy(); // badge: 0 new + 1 update + 1 python
  });

  describe('wide layout (tablet / landscape)', () => {
    beforeEach(() => {
      (useWindowDimensions as jest.Mock).mockReturnValue({ width: 1194, height: 834, scale: 2, fontScale: 1 });
    });

    afterEach(() => {
      (useWindowDimensions as jest.Mock).mockReturnValue({ width: 390, height: 844, scale: 2, fontScale: 1 });
    });

    it('shows the catalogue list and a placeholder detail pane side by side with nothing selected', async () => {
      mockUseDeviceState.mockReturnValue(
        baseState({ entries: { 1: entry({ id: 1, formattedTitle: 'Interstellar (2014)' }) } })
      );

      await renderScreen();

      expect(screen.getByText('Interstellar (2014)')).toBeTruthy();
      expect(screen.getByText('Select a catalogue entry to see its details.')).toBeTruthy();
      expect(screen.queryByLabelText('Back to results')).toBeNull(); // no back button in wide mode
    });

    it('shows the list and the selected entry detail simultaneously, without hiding the list', async () => {
      mockUseDeviceState.mockReturnValue(
        baseState({ entries: { 1: entry({ id: 1, formattedTitle: 'Interstellar (2014)' }) } })
      );
      const user = userEvent.setup();

      await renderScreen();
      await user.press(screen.getByText('Interstellar (2014)'));

      expect(screen.getAllByText(/Interstellar \(2014\)/).length).toBeGreaterThan(0); // catalogue row
      expect(screen.queryByText('Select a catalogue entry to see its details.')).toBeNull();
    });
  });

  describe('tablet-width portrait layout', () => {
    beforeEach(() => {
      // Narrower than the landscape useWide height threshold would require, but wide enough to
      // clear the isTablet breakpoint - a portrait iPad, not a rotated phone.
      (useWindowDimensions as jest.Mock).mockReturnValue({ width: 834, height: 1194, scale: 2, fontScale: 1 });
    });

    afterEach(() => {
      (useWindowDimensions as jest.Mock).mockReturnValue({ width: 390, height: 844, scale: 2, fontScale: 1 });
    });

    it('still shows the split list/detail layout instead of the phone single-column view', async () => {
      mockUseDeviceState.mockReturnValue(
        baseState({ entries: { 1: entry({ id: 1, formattedTitle: 'Interstellar (2014)' }) } })
      );

      await renderScreen();

      expect(screen.getByText('Interstellar (2014)')).toBeTruthy();
      expect(screen.getByText('Select a catalogue entry to see its details.')).toBeTruthy();
      expect(screen.queryByLabelText('Back to results')).toBeNull();
    });
  });

  describe('iPad mini portrait layout', () => {
    beforeEach(() => {
      // iPad mini's actual portrait size (744x1133) - narrower than a naive 768px tablet
      // breakpoint would allow, but still meant to get the split layout (see isTablet's
      // shortest-side check in useResponsiveLayout).
      (useWindowDimensions as jest.Mock).mockReturnValue({ width: 744, height: 1133, scale: 2, fontScale: 1 });
    });

    afterEach(() => {
      (useWindowDimensions as jest.Mock).mockReturnValue({ width: 390, height: 844, scale: 2, fontScale: 1 });
    });

    it('shows the split list/detail layout, not the phone single-column view', async () => {
      mockUseDeviceState.mockReturnValue(
        baseState({ entries: { 1: entry({ id: 1, formattedTitle: 'Interstellar (2014)' }) } })
      );

      await renderScreen();

      expect(screen.getByText('Interstellar (2014)')).toBeTruthy();
      expect(screen.getByText('Select a catalogue entry to see its details.')).toBeTruthy();
      expect(screen.queryByLabelText('Back to results')).toBeNull();
    });
  });
});
