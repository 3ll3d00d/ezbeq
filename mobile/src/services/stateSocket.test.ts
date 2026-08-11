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
  const socket = new StateSocket(URL, { initialReconnectDelayMs: 5, connectionErrorGraceMs: 50 });
  const callbacks = noopCallbacks();
  socket.init(callbacks.setErr, callbacks.replaceDevice, callbacks.setMeta, callbacks.loadEntries);
  await server.connected;

  server.close();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(socket.isConnected()).toBe(false);

  // Reconnects well inside the 50ms grace period - jest-websocket-mock's WS.clean() doesn't
  // apply mid-test, so a fresh server on the same URL stands in for the automatic reconnect.
  const server2 = new WS(URL, { jsonProtocol: false });
  await server2.connected;
  expect(socket.isConnected()).toBe(true);

  // Give the (now-cancelled) grace timer a chance to have fired if it wasn't actually cancelled.
  await new Promise((resolve) => setTimeout(resolve, 60));
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
