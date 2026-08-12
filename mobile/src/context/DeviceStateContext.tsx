import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { PropsWithChildren } from 'react';

import { useServerContext } from './ServerContext';
import { EzbeqApi } from '../services/ezbeqApi';
import { StateSocket } from '../services/stateSocket';
import type { CatalogueEntry, CatalogueMeta, DeviceCollection, DeviceState } from '../types/ezbeq';

// Devices poll retry schedule, mirroring StateSocket's own reconnect backoff (see
// DEFAULT_INITIAL_RECONNECT_DELAY_MS/MAX_RECONNECT_DELAY_MS in stateSocket.ts) - see the effect
// below for why a device (as opposed to the ezbeq server itself) needs its own retry loop.
const DEFAULT_DEVICES_POLL_INITIAL_DELAY_MS = 2000;
const DEFAULT_DEVICES_POLL_MAX_DELAY_MS = 30000;

// Ported verbatim from ui/src/App.jsx: only ever updates an already-known device, never adds
// one. A composite fanning an op out to its members (e.g. activating a slot) makes each member
// broadcast its own DeviceState over the websocket too, same as if it had been addressed
// directly - but a member hidden from the selector (composite exposeMembers: false, the default)
// was deliberately left out of the /api/2/devices response this state was seeded from, so it
// must stay out here as well, or it reappears the moment any op is applied to its composite.
export const mergeDeviceByName = (
  devices: DeviceCollection,
  replacement: DeviceState
): DeviceCollection =>
  Object.prototype.hasOwnProperty.call(devices, replacement.name)
    ? { ...devices, [replacement.name]: replacement }
    : devices;

type DeviceStateContextValue = {
  // null only while no server is paired yet - every screen reachable once RootNavigator has
  // routed past Connect/ScanQr can assume this is set.
  api: EzbeqApi | null;
  availableDevices: DeviceCollection;
  selectedDeviceName: string | null;
  setSelectedDeviceName: (name: string | null) => void;
  selectedSlotId: string | null;
  setSelectedSlotId: (id: string | null) => void;
  // Lets a screen apply a REST response (e.g. after an upload) immediately, ahead of the
  // WebSocket push that will arrive shortly after and (harmlessly) apply the same update again.
  replaceDevice: (device: DeviceState) => void;
  entries: Record<string, CatalogueEntry>;
  meta: CatalogueMeta;
  error: Error | null;
  setError: (err: Error | null) => void;
  // The mobile app's WebSocket connection to the ezbeq server, not any individual device's own
  // `connected` field (a minidsp/AVR being unreachable from the server) - see
  // DeviceDisconnectedBanner for that.
  wsConnected: boolean;
  // Re-sends the 'load catalogue' handshake over the open socket - lets a pull-to-refresh nudge a
  // fresh catalogue without waiting for the version-change effect that normally triggers it. A
  // no-op while the socket is down; the reconnect-resync effect above already covers that case.
  refreshCatalogue: () => void;
};

const DeviceStateContext = createContext<DeviceStateContextValue | null>(null);

type DeviceStateProviderProps = PropsWithChildren<{
  // Overridable so tests can exercise the retry-until-populated devices poll without waiting out
  // the production 2s/4s/8s/.../30s schedule - see StateSocketOptions in stateSocket.ts for the
  // same pattern.
  devicesPollInitialDelayMs?: number;
  devicesPollMaxDelayMs?: number;
}>;

export const DeviceStateProvider = ({
  children,
  devicesPollInitialDelayMs = DEFAULT_DEVICES_POLL_INITIAL_DELAY_MS,
  devicesPollMaxDelayMs = DEFAULT_DEVICES_POLL_MAX_DELAY_MS,
}: DeviceStateProviderProps) => {
  const { connection, wsUrl } = useServerContext();
  const [availableDevices, setAvailableDevices] = useState<DeviceCollection>({});
  const [selectedDeviceName, setSelectedDeviceName] = useState<string | null>(null);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [entries, setEntries] = useState<Record<string, CatalogueEntry>>({});
  const [meta, setMeta] = useState<CatalogueMeta>({});
  const [error, setError] = useState<Error | null>(null);
  const [wsConnected, setWsConnected] = useState(false);

  const socketRef = useRef<StateSocket | null>(null);
  // Tracks which catalogue version loadCatalogue() has actually been sent for - see the meta
  // effect below.
  const loadedCatalogueVersionRef = useRef<CatalogueMeta['version']>(undefined);

  const api = useMemo(() => (connection ? new EzbeqApi(connection.baseUrl) : null), [connection]);

  // Functional setState form so a burst of near-simultaneous replaceDevice calls (e.g. a
  // composite fanning one op out to several members) don't each read the same stale closure and
  // clobber one another - see mergeDeviceByName's docs above.
  const replaceDevice = useMemo(
    () => (device: DeviceState) =>
      setAvailableDevices((current) => mergeDeviceByName(current, device)),
    []
  );

  const loadEntries = useMemo(
    () => (newEntries: Record<string, CatalogueEntry>) =>
      setEntries((current) => ({ ...current, ...newEntries })),
    []
  );

  useEffect(() => {
    if (!connection || !wsUrl || !api) return undefined;

    // A fresh pairing always needs a fresh catalogue request, even if the new server happens to
    // report the same version string as whatever the previous connection last loaded.
    loadedCatalogueVersionRef.current = undefined;
    const socket = new StateSocket(wsUrl);
    socketRef.current = socket;

    let cancelled = false;
    let devicesPollTimer: ReturnType<typeof setTimeout> | null = null;
    let devicesPollAttempt = 0;

    // A device (e.g. jriver with its MCWS connection down) can be unreachable while the ezbeq
    // *server* - and so this websocket - is perfectly healthy throughout, so neither call site
    // below is guaranteed a second chance: the cold-start poll only ever runs once, and
    // onConnectionChange only fires again on an actual server-websocket reconnect, which a
    // still-down *device* never triggers. Without an independent retry loop here, a device that's
    // down at launch stayed missing from availableDevices - and the slot list stuck on its loading
    // spinner - until the app was force-restarted, even minutes after the device came back up.
    const fetchDevices = () => {
      if (devicesPollTimer) {
        clearTimeout(devicesPollTimer);
        devicesPollTimer = null;
      }
      api
        .getDevices()
        .then((devices) => {
          if (cancelled) return;
          setAvailableDevices(devices);
          if (Object.keys(devices).length === 0) {
            scheduleDevicesRetry();
          } else {
            devicesPollAttempt = 0;
          }
        })
        .catch((e) => {
          if (cancelled) return;
          setError(e);
          scheduleDevicesRetry();
        });
    };

    const scheduleDevicesRetry = () => {
      const delay = Math.min(
        devicesPollInitialDelayMs * 2 ** devicesPollAttempt,
        devicesPollMaxDelayMs
      );
      devicesPollAttempt += 1;
      devicesPollTimer = setTimeout(fetchDevices, delay);
    };

    // Every successful (re)connection resyncs devices via REST, not just the second-and-later
    // ones - anything the server pushed while the socket was down is simply gone, not queued for
    // redelivery, and that's just as true of the *first* connection as any later reconnect. This
    // used to be skipped on the first connect on the theory that the cold-start poll below already
    // covers it - true when the server is already up, but if it's still down when this effect
    // runs, that one-shot REST call fails with nothing to retry it, and the socket's own
    // backoff/reconnect finally succeeding was exactly the moment nothing resynced devices. (The
    // catalogue doesn't have this problem: it arrives as unprompted WS pushes, not a gated REST
    // fetch - which is why it recovers on its own but devices/slots previously didn't.)
    const onConnectionChange = (connected: boolean) => {
      setWsConnected(connected);
      if (connected) {
        fetchDevices();
      }
    };
    socket.init(setError, replaceDevice, setMeta, loadEntries, onConnectionChange);

    // Cold-start poll, fired in parallel with the socket's own connection attempt so devices show
    // up as fast as possible on the common case (server already up) rather than waiting on the WS
    // handshake first. Always applied, even if the socket has connected (and pushed its own
    // DeviceState) by the time it resolves: mergeDeviceByName can only update an already-known
    // device, never add one, so a WS push that beat this fetch to a device this component has
    // never seen before is silently dropped - if this then also deferred to "the socket's push is
    // fresher", nothing would ever seed availableDevices and the app would sit on the loading
    // screen forever.
    fetchDevices();

    return () => {
      cancelled = true;
      if (devicesPollTimer) {
        clearTimeout(devicesPollTimer);
      }
      socket.close();
      socketRef.current = null;
    };
  }, [connection, wsUrl, api, replaceDevice, loadEntries, devicesPollInitialDelayMs, devicesPollMaxDelayMs]);

  useEffect(() => {
    const names = Object.keys(availableDevices);
    if (names.length > 0 && !selectedDeviceName) {
      setSelectedDeviceName(names[0]);
    }
  }, [availableDevices, selectedDeviceName]);

  // Ported from ui/src/App.jsx: selectedSlotId tracks whichever slot the device itself reports
  // as active, rather than being set directly by the tap handler - the handler only calls the
  // API, and the resulting DeviceState update (REST response or WS push) is what actually moves
  // the selection, same as any other device-reported field.
  useEffect(() => {
    const slots = selectedDeviceName ? availableDevices[selectedDeviceName]?.slots : undefined;
    const active = slots?.find((s) => s.active === true);
    if (active) {
      setSelectedSlotId(active.id);
    }
  }, [selectedDeviceName, availableDevices]);

  const refreshCatalogue = useMemo(() => () => socketRef.current?.loadCatalogue(), []);

  // Ported from ui/src/App.jsx: the server pushes a 'Catalogue' message (-> meta) unprompted on
  // every connect/reconnect, but never the entries themselves - those only arrive in response to
  // an explicit 'load catalogue' send. (Re-)send whenever meta reports a version we haven't
  // already loaded - covers both the initial load and a catalogue changing server-side while the
  // app is open, without re-requesting on every reconnect that reports the same, already-loaded
  // version.
  useEffect(() => {
    if (meta.version && meta.version !== loadedCatalogueVersionRef.current) {
      loadedCatalogueVersionRef.current = meta.version;
      socketRef.current?.loadCatalogue();
    }
  }, [meta]);

  const value = useMemo(
    () => ({
      api,
      availableDevices,
      selectedDeviceName,
      setSelectedDeviceName,
      selectedSlotId,
      setSelectedSlotId,
      replaceDevice,
      entries,
      meta,
      error,
      setError,
      wsConnected,
      refreshCatalogue,
    }),
    [
      api,
      availableDevices,
      selectedDeviceName,
      selectedSlotId,
      replaceDevice,
      entries,
      meta,
      error,
      wsConnected,
      refreshCatalogue,
    ]
  );

  return <DeviceStateContext.Provider value={value}>{children}</DeviceStateContext.Provider>;
};

export const useDeviceState = (): DeviceStateContextValue => {
  const ctx = useContext(DeviceStateContext);
  if (!ctx) {
    throw new Error('useDeviceState must be used within a DeviceStateProvider');
  }
  return ctx;
};
