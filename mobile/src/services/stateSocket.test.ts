import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import WS from 'jest-websocket-mock';

import { StateSocket } from './stateSocket';

const URL = 'ws://localhost:1234/ws';

let server: WS;

const noopCallbacks = () => ({
  setErr: jest.fn(),
  replaceDevice: jest.fn(),
  setMeta: jest.fn(),
  loadEntries: jest.fn(),
});

beforeEach(() => {
  server = new WS(URL, { jsonProtocol: false });
});

afterEach(() => {
  WS.clean();
  jest.restoreAllMocks();
});

test('dispatches DeviceState/Catalogue/CatalogueEntries messages to the registered callbacks', async () => {
  const socket = new StateSocket(URL);
  const callbacks = noopCallbacks();
  socket.init(callbacks.setErr, callbacks.replaceDevice, callbacks.setMeta, callbacks.loadEntries);

  await server.connected;
  expect(socket.isConnected()).toBe(true);

  server.send(JSON.stringify({ message: 'DeviceState', data: { name: 'd1' } }));
  expect(callbacks.replaceDevice).toHaveBeenCalledWith({ name: 'd1' });

  server.send(JSON.stringify({ message: 'Catalogue', data: { version: '2' } }));
  expect(callbacks.setMeta).toHaveBeenCalledWith({ version: '2' });

  server.send(
    JSON.stringify({
      message: 'CatalogueEntries',
      data: [
        { id: 1, formattedTitle: 'a' },
        { id: 2, formattedTitle: 'b' },
      ],
    })
  );
  expect(callbacks.loadEntries).toHaveBeenCalledWith({
    1: { id: 1, formattedTitle: 'a' },
    2: { id: 2, formattedTitle: 'b' },
  });

  socket.close();
});

test('dispatches an Error message, preserving the persistent flag', async () => {
  const socket = new StateSocket(URL);
  const callbacks = noopCallbacks();
  socket.init(callbacks.setErr, callbacks.replaceDevice, callbacks.setMeta, callbacks.loadEntries);
  await server.connected;

  server.send(JSON.stringify({ message: 'Error', data: 'boom', persistent: true }));

  expect(callbacks.setErr).toHaveBeenCalledTimes(1);
  const err = callbacks.setErr.mock.calls[0][0] as Error & { persistent?: boolean };
  expect(err.message).toBe('boom');
  expect(err.persistent).toBe(true);

  socket.close();
});

test('loadCatalogue sends the load catalogue message once connected', async () => {
  const socket = new StateSocket(URL);
  await server.connected;

  socket.loadCatalogue();

  await expect(server).toReceiveMessage('load catalogue');
  socket.close();
});

test('reconnects with exponential backoff after the socket closes unexpectedly', async () => {
  const socket = new StateSocket(URL, { initialReconnectDelayMs: 5 });
  await server.connected;
  expect(socket.isConnected()).toBe(true);

  server.close();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(socket.isConnected()).toBe(false);

  // jest-websocket-mock's WS.clean() doesn't apply mid-test; start a fresh server on the same
  // URL to accept the client's reconnect attempt.
  const server2 = new WS(URL, { jsonProtocol: false });
  await server2.connected;
  expect(socket.isConnected()).toBe(true);

  socket.close();
});

test('does not reconnect after close() is called explicitly', async () => {
  const socket = new StateSocket(URL, { initialReconnectDelayMs: 5 });
  await server.connected;

  socket.close();
  await new Promise((resolve) => setTimeout(resolve, 50));

  expect(socket.isConnected()).toBe(false);
});

test('reconnects immediately when the app returns to the foreground', async () => {
  let appStateListener: ((state: string) => void) | undefined;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    appStateListener = listener as (state: string) => void;
    return { remove: jest.fn() } as never;
  });

  const socket = new StateSocket(URL, { initialReconnectDelayMs: 30000 });
  await server.connected;
  server.close();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(socket.isConnected()).toBe(false);

  const server2 = new WS(URL, { jsonProtocol: false });
  appStateListener?.('active');

  await server2.connected;
  expect(socket.isConnected()).toBe(true);

  socket.close();
});

test('reports connection changes via onConnectionChange, including across a reconnect', async () => {
  const onConnectionChange = jest.fn();
  const socket = new StateSocket(URL, { initialReconnectDelayMs: 5 });
  const callbacks = noopCallbacks();
  socket.init(callbacks.setErr, callbacks.replaceDevice, callbacks.setMeta, callbacks.loadEntries, onConnectionChange);
  await server.connected;
  expect(onConnectionChange).toHaveBeenLastCalledWith(true);

  server.close();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(onConnectionChange).toHaveBeenLastCalledWith(false);

  const server2 = new WS(URL, { jsonProtocol: false });
  await server2.connected;
  expect(onConnectionChange).toHaveBeenLastCalledWith(true);

  socket.close();
});

test('suppresses a connection error when the socket reconnects within the grace period', async () => {
  // The grace-period timer runs on the real (wall-clock) setTimeout, racing against a chain of
  // exponential-backoff reconnect attempts (5ms, 10ms, 20ms, ...) that each need the mock socket
  // to detect "no server yet" and fail before the next one fires - a 50ms grace period left only
  // a ~10ms margin around that chain even under ideal scheduling, which a loaded CI runner's timer
  // jitter regularly ate into (observed as a real, non-flaky-locally CI failure). Widen the grace
  // period well past the worst-case reconnect chain so the outcome no longer depends on exact
  // millisecond scheduling.
  const socket = new StateSocket(URL, { initialReconnectDelayMs: 5, connectionErrorGraceMs: 300 });
  const callbacks = noopCallbacks();
  socket.init(callbacks.setErr, callbacks.replaceDevice, callbacks.setMeta, callbacks.loadEntries);
  await server.connected;

  server.close();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(socket.isConnected()).toBe(false);

  // Reconnects well inside the grace period - jest-websocket-mock's WS.clean() doesn't apply
  // mid-test, so a fresh server on the same URL stands in for the automatic reconnect.
  const server2 = new WS(URL, { jsonProtocol: false });
  await server2.connected;
  expect(socket.isConnected()).toBe(true);

  // Give the (now-cancelled) grace timer a generous chance to have fired if it wasn't actually
  // cancelled.
  await new Promise((resolve) => setTimeout(resolve, 350));
  expect(callbacks.setErr).not.toHaveBeenCalled();

  socket.close();
});

test('reports a connection error once the socket stays down past the grace period', async () => {
  const socket = new StateSocket(URL, { initialReconnectDelayMs: 500000, connectionErrorGraceMs: 30 });
  const callbacks = noopCallbacks();
  socket.init(callbacks.setErr, callbacks.replaceDevice, callbacks.setMeta, callbacks.loadEntries);
  await server.connected;

  server.close();

  await new Promise((resolve) => setTimeout(resolve, 60));
  expect(callbacks.setErr).toHaveBeenCalledTimes(1);
  const err = callbacks.setErr.mock.calls[0][0] as Error;
  expect(err.message).toBe(`Failed to connect to ${URL}`);

  socket.close();
});

test('does not surface a phantom connection error after close() is called explicitly', async () => {
  // Reproduces the switch-server flow: DeviceStateContext tears down the old socket (close())
  // the moment `connection` changes, well before the old socket's async onclose event actually
  // fires. That onclose must not go on to arm a grace-period timer for a socket nobody wants
  // reconnected - see the closedByCaller guard in stateSocket.ts.
  const socket = new StateSocket(URL, { initialReconnectDelayMs: 5, connectionErrorGraceMs: 30 });
  const callbacks = noopCallbacks();
  socket.init(callbacks.setErr, callbacks.replaceDevice, callbacks.setMeta, callbacks.loadEntries);
  await server.connected;

  socket.close();

  await new Promise((resolve) => setTimeout(resolve, 60));
  expect(callbacks.setErr).not.toHaveBeenCalled();
});

test('reconnects immediately when connectivity is restored', async () => {
  let netInfoListener: ((state: { isConnected: boolean }) => void) | undefined;
  (NetInfo.addEventListener as jest.Mock).mockImplementation((listener) => {
    netInfoListener = listener;
    return jest.fn();
  });

  const socket = new StateSocket(URL, { initialReconnectDelayMs: 30000 });
  await server.connected;
  server.close();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(socket.isConnected()).toBe(false);

  const server2 = new WS(URL, { jsonProtocol: false });
  netInfoListener?.({ isConnected: true });

  await server2.connected;
  expect(socket.isConnected()).toBe(true);

  socket.close();
});

// a stand in for a React error state setter, applying functional updates
const errState = () => {
  const state: { err: Error | null; setErr: jest.Mock } = { err: null, setErr: jest.fn() };
  state.setErr.mockImplementation((v: Error | null | ((current: Error | null) => Error | null)) => {
    state.err = typeof v === 'function' ? v(state.err) : v;
  });
  return state;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// the grace period is short so the outage is reported well within the sleeps below, even on a
// loaded CI runner
const GRACE_MS = 30;
const WAIT_MS = 200;

const reportedOutage = async () => {
  const socket = new StateSocket(URL, { initialReconnectDelayMs: 500000, connectionErrorGraceMs: GRACE_MS });
  const state = errState();
  const callbacks = noopCallbacks();
  socket.init(state.setErr, callbacks.replaceDevice, callbacks.setMeta, callbacks.loadEntries);
  await server.connected;
  server.close();
  await sleep(WAIT_MS);
  expect(state.err).toEqual(new Error(`Failed to connect to ${URL}`));
  return { socket, state };
};

const reconnect = async (socket: StateSocket) => {
  const server2 = new WS(URL, { jsonProtocol: false });
  (socket as unknown as { reconnectNow: () => void }).reconnectNow();
  await server2.connected;
};

test('clears a reported connection error once the socket reconnects', async () => {
  const { socket, state } = await reportedOutage();

  await reconnect(socket);

  expect(state.err).toBeNull();
  socket.close();
});

test('leaves a different error alone when the socket reconnects', async () => {
  const { socket, state } = await reportedOutage();
  const other = new Error('something else');
  state.err = other;

  await reconnect(socket);

  expect(state.err).toBe(other);
  socket.close();
});

test('withdraws its reported connection error when closed', async () => {
  const { socket, state } = await reportedOutage();

  socket.close();

  expect(state.err).toBeNull();
});

test.each(['background', 'inactive'])(
  'does not report a connection error while the app is %s',
  async (hiddenState) => {
    let appStateListener: ((state: string) => void) | undefined;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
      appStateListener = listener as (state: string) => void;
      return { remove: jest.fn() } as never;
    });
    // a plain property in the react-native jest setup, so set directly and restored in finally
    const mutableAppState = AppState as { currentState: string };
    const originalState = mutableAppState.currentState;
    mutableAppState.currentState = 'active';
    const socket = new StateSocket(URL, { initialReconnectDelayMs: 500000, connectionErrorGraceMs: GRACE_MS });
    try {
      const callbacks = noopCallbacks();
      socket.init(callbacks.setErr, callbacks.replaceDevice, callbacks.setMeta, callbacks.loadEntries);
      await server.connected;

      mutableAppState.currentState = hiddenState;
      appStateListener?.(hiddenState);
      server.close();
      await sleep(WAIT_MS);
      expect(callbacks.setErr).not.toHaveBeenCalled();

      // still down once back in the foreground, a full grace period then applies
      mutableAppState.currentState = 'active';
      appStateListener?.('active');
      expect(callbacks.setErr).not.toHaveBeenCalled();
      await sleep(WAIT_MS);
      expect(callbacks.setErr).toHaveBeenCalledTimes(1);
    } finally {
      socket.close();
      mutableAppState.currentState = originalState;
    }
  }
);
