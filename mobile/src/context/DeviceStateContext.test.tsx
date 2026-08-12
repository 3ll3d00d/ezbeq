import { act, render, screen, userEvent, waitFor } from '@testing-library/react-native';
import { Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { DeviceStateProvider, mergeDeviceByName, useDeviceState } from './DeviceStateContext';
import { ServerProvider } from './ServerContext';
import { EzbeqApi } from '../services/ezbeqApi';
import { StateSocket } from '../services/stateSocket';

jest.mock('../services/ezbeqApi');
jest.mock('../services/stateSocket');

describe('mergeDeviceByName', () => {
  it('replaces an existing device with the same name, leaving other devices untouched', () => {
    const devices = { d1: { name: 'd1', masterVolume: -10 }, d2: { name: 'd2', masterVolume: -5 } } as any;

    const merged = mergeDeviceByName(devices, { name: 'd1', masterVolume: -20 } as any);

    expect(merged).toEqual({ d1: { name: 'd1', masterVolume: -20 }, d2: { name: 'd2', masterVolume: -5 } });
  });

  it('ignores a DeviceState for a device that is not already known', () => {
    const devices = { bass_array: { name: 'bass_array', type: 'composite', masterVolume: -10 } } as any;

    const merged = mergeDeviceByName(devices, { name: 'sub1', type: 'minidsp', masterVolume: -10 } as any);

    expect(merged).toBe(devices);
  });

  it('does not mutate the input devices object', () => {
    const devices = { d1: { name: 'd1', masterVolume: -10 } } as any;
    const snapshot = JSON.parse(JSON.stringify(devices));

    mergeDeviceByName(devices, { name: 'd1', masterVolume: -20 } as any);

    expect(devices).toEqual(snapshot);
  });
});

const Consumer = () => {
  const { availableDevices, selectedDeviceName, selectedSlotId, entries, error, wsConnected, refreshCatalogue } =
    useDeviceState();
  return (
    <View>
      <Text testID="devices">{JSON.stringify(availableDevices)}</Text>
      <Text testID="selected">{selectedDeviceName ?? 'none'}</Text>
      <Text testID="selectedSlot">{selectedSlotId ?? 'none'}</Text>
      <Text testID="entries">{JSON.stringify(entries)}</Text>
      <Text testID="error">{error?.message ?? 'none'}</Text>
      <Text testID="wsConnected">{String(wsConnected)}</Text>
      <Text testID="refresh" onPress={refreshCatalogue}>
        refresh
      </Text>
    </View>
  );
};

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

const pairServer = () =>
  AsyncStorage.setItem('ezbeq:serverConnection', JSON.stringify({ baseUrl: 'http://host:8080' }));

const renderProvider = async () =>
  render(
    <ServerProvider>
      <DeviceStateProvider>
        <Consumer />
      </DeviceStateProvider>
    </ServerProvider>
  );

beforeEach(async () => {
  await AsyncStorage.clear();
  (EzbeqApi as jest.Mock).mockReset();
  (StateSocket as jest.Mock).mockReset();
  lastSocket = undefined;
  mockStateSocket();
});

test('seeds devices from the REST cold-start poll when the socket is not connected', async () => {
  (EzbeqApi as jest.Mock).mockImplementation(() => ({
    getDevices: jest.fn().mockResolvedValue({ d1: { name: 'd1', connected: true, slots: [] } }),
  }));
  await pairServer();

  await renderProvider();

  await waitFor(() => expect(screen.getByTestId('devices')).toHaveTextContent('d1', { exact: false }));
  expect(screen.getByTestId('selected')).toHaveTextContent('d1');
});

test('still seeds devices from the REST cold-start poll even if the socket connects first', async () => {
  // mergeDeviceByName can only update an already-known device, never add one (see its docs) - so
  // if the socket races ahead and pushes a DeviceState before this resolves, that push is
  // dropped, and this REST response is the only thing that can ever seed a first-time device.
  // Regression test for a real bug: this used to be discarded whenever the socket had already
  // connected by the time it resolved, leaving availableDevices empty forever on a fast (e.g.
  // local) connection.
  (EzbeqApi as jest.Mock).mockImplementation(() => ({
    getDevices: jest.fn().mockResolvedValue({ d1: { name: 'd1', connected: true, slots: [] } }),
  }));
  (StateSocket as jest.Mock).mockImplementation(function (this: any) {
    this.init = jest.fn((setErr, replaceDevice, setMeta, loadEntries) => {
      this.callbacks = { setErr, replaceDevice, setMeta, loadEntries };
    });
    this.isConnected = jest.fn(() => true);
    this.close = jest.fn();
    lastSocket = this;
  });
  await pairServer();

  await renderProvider();

  await waitFor(() => expect(screen.getByTestId('devices')).toHaveTextContent('d1', { exact: false }));
});

test('applies a DeviceState broadcast pushed over the websocket for an already-known device', async () => {
  // mergeDeviceByName only ever updates an already-known device, never adds one - see its docs -
  // so the REST seed here must already include d1 for the broadcast below to take effect.
  (EzbeqApi as jest.Mock).mockImplementation(() => ({
    getDevices: jest.fn().mockResolvedValue({ d1: { name: 'd1', connected: true, masterVolume: -10, slots: [] } }),
  }));
  await pairServer();
  await renderProvider();
  await waitFor(() => expect(lastSocket).toBeDefined());
  await waitFor(() => expect(screen.getByTestId('devices')).toHaveTextContent('-10', { exact: false }));

  await act(async () => {
    lastSocket.callbacks.replaceDevice({ name: 'd1', connected: true, masterVolume: -6, slots: [] });
  });

  expect(screen.getByTestId('devices')).toHaveTextContent('-6', { exact: false });
});

test('a websocket Error message surfaces through the error field', async () => {
  (EzbeqApi as jest.Mock).mockImplementation(() => ({ getDevices: jest.fn().mockResolvedValue({}) }));
  await pairServer();
  await renderProvider();
  await waitFor(() => expect(lastSocket).toBeDefined());

  await act(async () => {
    lastSocket.callbacks.setErr(new Error('device offline'));
  });

  expect(screen.getByTestId('error')).toHaveTextContent('device offline');
});

test('merges CatalogueEntries pushes into entries', async () => {
  (EzbeqApi as jest.Mock).mockImplementation(() => ({ getDevices: jest.fn().mockResolvedValue({}) }));
  await pairServer();
  await renderProvider();
  await waitFor(() => expect(lastSocket).toBeDefined());

  await act(async () => {
    lastSocket.callbacks.loadEntries({ 1: { id: 1, formattedTitle: 'a' } });
  });

  expect(screen.getByTestId('entries')).toHaveTextContent('a', { exact: false });
});

test('derives selectedSlotId from whichever slot the device reports as active', async () => {
  (EzbeqApi as jest.Mock).mockImplementation(() => ({
    getDevices: jest.fn().mockResolvedValue({
      d1: {
        name: 'd1',
        connected: true,
        slots: [
          { id: '1', active: false },
          { id: '2', active: true },
        ],
      },
    }),
  }));
  await pairServer();

  await renderProvider();

  await waitFor(() => expect(screen.getByTestId('selectedSlot')).toHaveTextContent('2'));
});

test('moves selectedSlotId when a DeviceState broadcast reports a different active slot', async () => {
  (EzbeqApi as jest.Mock).mockImplementation(() => ({
    getDevices: jest.fn().mockResolvedValue({
      d1: {
        name: 'd1',
        connected: true,
        slots: [
          { id: '1', active: true },
          { id: '2', active: false },
        ],
      },
    }),
  }));
  await pairServer();
  await renderProvider();
  await waitFor(() => expect(lastSocket).toBeDefined());
  await waitFor(() => expect(screen.getByTestId('selectedSlot')).toHaveTextContent('1'));

  await act(async () => {
    lastSocket.callbacks.replaceDevice({
      name: 'd1',
      connected: true,
      slots: [
        { id: '1', active: false },
        { id: '2', active: true },
      ],
    });
  });

  expect(screen.getByTestId('selectedSlot')).toHaveTextContent('2');
});

test('wsConnected reflects the socket open/close callbacks', async () => {
  (EzbeqApi as jest.Mock).mockImplementation(() => ({ getDevices: jest.fn().mockResolvedValue({}) }));
  await pairServer();
  await renderProvider();
  await waitFor(() => expect(lastSocket).toBeDefined());
  expect(screen.getByTestId('wsConnected')).toHaveTextContent('false');

  await act(async () => {
    lastSocket.callbacks.onConnectionChange(true);
  });
  expect(screen.getByTestId('wsConnected')).toHaveTextContent('true');

  await act(async () => {
    lastSocket.callbacks.onConnectionChange(false);
  });
  expect(screen.getByTestId('wsConnected')).toHaveTextContent('false');
});

test('resyncs devices via REST on every successful connection, including the first', async () => {
  const getDevices = jest
    .fn()
    .mockResolvedValueOnce({ d1: { name: 'd1', connected: true, masterVolume: -10, slots: [] } })
    .mockResolvedValueOnce({ d1: { name: 'd1', connected: true, masterVolume: -3, slots: [] } })
    .mockResolvedValueOnce({ d1: { name: 'd1', connected: true, masterVolume: -1, slots: [] } });
  (EzbeqApi as jest.Mock).mockImplementation(() => ({ getDevices }));
  await pairServer();
  await renderProvider();
  await waitFor(() => expect(lastSocket).toBeDefined());
  await waitFor(() => expect(getDevices).toHaveBeenCalledTimes(1)); // the cold-start poll

  await act(async () => {
    lastSocket.callbacks.onConnectionChange(true); // first connect - also resyncs, not just later reconnects
  });
  await waitFor(() => expect(getDevices).toHaveBeenCalledTimes(2));
  expect(screen.getByTestId('devices')).toHaveTextContent('-3', { exact: false });

  await act(async () => {
    lastSocket.callbacks.onConnectionChange(false); // drop
  });
  await act(async () => {
    lastSocket.callbacks.onConnectionChange(true); // reconnect - resyncs again
  });

  await waitFor(() => expect(getDevices).toHaveBeenCalledTimes(3));
  expect(screen.getByTestId('devices')).toHaveTextContent('-1', { exact: false });
});

test('recovers devices once the socket connects even if the cold-start REST poll failed outright', async () => {
  // Regression test for a real bug: if the server was still down when this provider mounted, the
  // cold-start poll (a one-shot REST call, fired in parallel with the socket's own connection
  // attempt) failed with nothing to retry it. The socket's own backoff/reconnect eventually
  // succeeding used to be silently ignored on exactly this, the *first* successful connection -
  // so availableDevices (and everything downstream of it, like SlotsGrid) stayed empty forever,
  // even once the server came back. The catalogue didn't show the same symptom because it arrives
  // as unprompted WS pushes rather than a REST fetch gated the same way, which is why "catalogue
  // loads but slots never do" was the reported symptom rather than nothing loading at all.
  const getDevices = jest
    .fn()
    .mockRejectedValueOnce(new Error('Network request failed'))
    .mockResolvedValueOnce({ d1: { name: 'd1', connected: true, slots: [] } });
  (EzbeqApi as jest.Mock).mockImplementation(() => ({ getDevices }));
  await pairServer();
  await renderProvider();
  await waitFor(() => expect(lastSocket).toBeDefined());
  await waitFor(() => expect(getDevices).toHaveBeenCalledTimes(1));
  expect(screen.getByTestId('devices')).toHaveTextContent('{}');

  await act(async () => {
    lastSocket.callbacks.onConnectionChange(true); // the socket's own reconnect finally succeeds
  });

  await waitFor(() => expect(screen.getByTestId('devices')).toHaveTextContent('d1', { exact: false }));
});

test('keeps retrying the devices poll with backoff until a device shows up', async () => {
  // Regression test for a real bug: a device backed by e.g. jriver that's still down when the app
  // launches (its DSP catalogue loads fine over the websocket, but /api/2/devices comes back
  // without it) left availableDevices - and so the slot list - empty forever. The cold-start poll
  // and the one onConnectionChange(true) fired when the ezbeq *server's* websocket first connects
  // are both one-shot; neither has any reason to run again once that websocket is up, even though
  // the underlying device might only come online seconds later. Nothing used to retry the REST
  // fetch itself, so the slot list stuck on "Waiting for device data..." until a full app restart.
  const getDevices = jest
    .fn()
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({ d1: { name: 'd1', connected: true, slots: [{ id: '1' }] } });
  (EzbeqApi as jest.Mock).mockImplementation(() => ({ getDevices }));
  await pairServer();

  await render(
    <ServerProvider>
      <DeviceStateProvider devicesPollInitialDelayMs={5} devicesPollMaxDelayMs={20}>
        <Consumer />
      </DeviceStateProvider>
    </ServerProvider>
  );

  await waitFor(() => expect(screen.getByTestId('devices')).toHaveTextContent('d1', { exact: false }));
  expect(getDevices).toHaveBeenCalledTimes(3);
});

test('stops retrying the devices poll once a device shows up, and resumes it if a later fetch comes back empty', async () => {
  const getDevices = jest
    .fn()
    .mockResolvedValueOnce({ d1: { name: 'd1', connected: true, slots: [] } }) // cold start
    .mockResolvedValueOnce({}); // a later reconnect finds the device gone again
  (EzbeqApi as jest.Mock).mockImplementation(() => ({ getDevices }));
  await pairServer();

  await render(
    <ServerProvider>
      <DeviceStateProvider devicesPollInitialDelayMs={100000} devicesPollMaxDelayMs={100000}>
        <Consumer />
      </DeviceStateProvider>
    </ServerProvider>
  );
  await waitFor(() => expect(lastSocket).toBeDefined());
  await waitFor(() => expect(getDevices).toHaveBeenCalledTimes(1));

  // No retry was scheduled while a device was known - a long-lived interval wouldn't have quietly
  // kept polling in the background this whole time.
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(getDevices).toHaveBeenCalledTimes(1);

  await act(async () => {
    lastSocket.callbacks.onConnectionChange(true);
  });

  await waitFor(() => expect(getDevices).toHaveBeenCalledTimes(2));
  expect(screen.getByTestId('devices')).toHaveTextContent('{}');
});

test('sends the load catalogue handshake as soon as a Catalogue message reports a version', async () => {
  // Regression test for a real bug: the server pushes meta (version) unprompted on connect, but
  // never the entries themselves - those only arrive in response to an explicit 'load catalogue'
  // send, which nothing was ever triggering automatically. The catalogue never loaded until a
  // user happened to pull-to-refresh.
  (EzbeqApi as jest.Mock).mockImplementation(() => ({ getDevices: jest.fn().mockResolvedValue({}) }));
  await pairServer();
  await renderProvider();
  await waitFor(() => expect(lastSocket).toBeDefined());
  expect(lastSocket.loadCatalogue).not.toHaveBeenCalled();

  await act(async () => {
    lastSocket.callbacks.setMeta({ version: 'v1' });
  });

  expect(lastSocket.loadCatalogue).toHaveBeenCalledTimes(1);
});

test('does not re-send the load catalogue handshake for a repeated, already-loaded version', async () => {
  (EzbeqApi as jest.Mock).mockImplementation(() => ({ getDevices: jest.fn().mockResolvedValue({}) }));
  await pairServer();
  await renderProvider();
  await waitFor(() => expect(lastSocket).toBeDefined());

  await act(async () => {
    lastSocket.callbacks.setMeta({ version: 'v1' });
  });
  await act(async () => {
    // e.g. a reconnect - the server re-pushes meta unprompted, same version
    lastSocket.callbacks.setMeta({ version: 'v1' });
  });

  expect(lastSocket.loadCatalogue).toHaveBeenCalledTimes(1);
});

test('re-sends the load catalogue handshake when the reported version changes', async () => {
  (EzbeqApi as jest.Mock).mockImplementation(() => ({ getDevices: jest.fn().mockResolvedValue({}) }));
  await pairServer();
  await renderProvider();
  await waitFor(() => expect(lastSocket).toBeDefined());

  await act(async () => {
    lastSocket.callbacks.setMeta({ version: 'v1' });
  });
  await act(async () => {
    lastSocket.callbacks.setMeta({ version: 'v2' });
  });

  expect(lastSocket.loadCatalogue).toHaveBeenCalledTimes(2);
});

test('refreshCatalogue re-sends the load catalogue handshake over the open socket', async () => {
  (EzbeqApi as jest.Mock).mockImplementation(() => ({ getDevices: jest.fn().mockResolvedValue({}) }));
  await pairServer();
  const user = userEvent.setup();
  await renderProvider();
  await waitFor(() => expect(lastSocket).toBeDefined());

  await user.press(screen.getByTestId('refresh'));

  expect(lastSocket.loadCatalogue).toHaveBeenCalled();
});

test('useDeviceState throws when used outside a DeviceStateProvider', async () => {
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  await expect(render(<Consumer />)).rejects.toThrow(
    'useDeviceState must be used within a DeviceStateProvider'
  );
  consoleError.mockRestore();
});
