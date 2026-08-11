import { AppState, type AppStateStatus } from 'react-native';
import NetInfo, { type NetInfoSubscription } from '@react-native-community/netinfo';

import type { CatalogueEntry, CatalogueMeta, DeviceState } from '../types/ezbeq';

// Ported from ui/src/services/state.js - same message contract (DeviceState/Error/Catalogue/
// CatalogueEntries) and the same "load catalogue" handshake once a version is known. Unlike the
// web version, which never reconnects (a page reload is the implicit recovery), this adds
// exponential-backoff reconnection plus immediate reconnect attempts on app-foreground and
// connectivity-restored events, since mobile network conditions are far less stable than a
// LAN-tethered browser tab.

const MAX_RECONNECT_DELAY_MS = 30000;
const DEFAULT_INITIAL_RECONNECT_DELAY_MS = 1000;
// How long the socket can be down before a connection-failure error actually surfaces to the
// user. A device wake from lock (or any brief network blip) closes the socket and immediately
// reconnects successfully within a beat or two - reporting an error on every such blip would be
// pure noise. Only a disconnect that outlasts this grace period (i.e. the automatic reconnect
// isn't working) is worth interrupting the user for.
const DEFAULT_CONNECTION_ERROR_GRACE_MS = 10000;

export type StateSocketCallbacks = {
  setErr: (err: Error) => void;
  replaceDevice: (device: DeviceState) => void;
  setMeta: (meta: CatalogueMeta) => void;
  loadEntries: (entries: Record<string, CatalogueEntry>) => void;
  // Fired on every open/close transition, including reconnects - lets a caller (e.g.
  // DeviceStateContext) resync via REST after a reconnect, since anything the server pushed
  // while the socket was down is simply gone, not queued up for redelivery.
  onConnectionChange?: (connected: boolean) => void;
};

export type StateSocketOptions = {
  // Overridable so tests can exercise real backoff/reconnect timing without waiting out the
  // production 1s/2s/4s.../30s schedule.
  initialReconnectDelayMs?: number;
  // Overridable so tests can exercise the grace period without waiting out the production 10s
  // default - see DEFAULT_CONNECTION_ERROR_GRACE_MS.
  connectionErrorGraceMs?: number;
};

export class StateSocket {
  private readonly url: string;
  private readonly initialReconnectDelayMs: number;
  private readonly connectionErrorGraceMs: number;
  private ws: WebSocket | null = null;
  private callbacks: StateSocketCallbacks | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  // Set the moment the socket goes down, cleared the moment it comes back up - fires the
  // connection-failure error only if the socket is still down once the grace period elapses,
  // regardless of how many individual reconnect attempts happened in between.
  private connectionErrorTimer: ReturnType<typeof setTimeout> | null = null;
  private closedByCaller = false;
  private appStateSubscription: { remove: () => void } | null = null;
  private netInfoUnsubscribe: NetInfoSubscription | null = null;

  constructor(url: string, options: StateSocketOptions = {}) {
    this.url = url;
    this.initialReconnectDelayMs = options.initialReconnectDelayMs ?? DEFAULT_INITIAL_RECONNECT_DELAY_MS;
    this.connectionErrorGraceMs = options.connectionErrorGraceMs ?? DEFAULT_CONNECTION_ERROR_GRACE_MS;
    this.connect();
    this.appStateSubscription = AppState.addEventListener('change', this.handleAppStateChange);
    this.netInfoUnsubscribe = NetInfo.addEventListener(this.handleNetInfoChange);
  }

  init = (
    setErr: StateSocketCallbacks['setErr'],
    replaceDevice: StateSocketCallbacks['replaceDevice'],
    setMeta: StateSocketCallbacks['setMeta'],
    loadEntries: StateSocketCallbacks['loadEntries'],
    onConnectionChange?: StateSocketCallbacks['onConnectionChange']
  ) => {
    this.callbacks = { setErr, replaceDevice, setMeta, loadEntries, onConnectionChange };
  };

  private connect = () => {
    // Detach the previous socket's handlers before replacing it, so a stale onclose (fired after
    // we've already moved on) can't trigger a second, redundant reconnect chain.
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      this.ws.onmessage = null;
      try {
        this.ws.close();
      } catch {
        // already closed/closing - nothing to do
      }
    }

    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.clearConnectionErrorTimer();
      this.callbacks?.onConnectionChange?.(true);
    };
    ws.onerror = () => {
      // No-op: a failed connection attempt always fires onclose right after this, which is
      // where reconnect scheduling and the grace-period error timer actually live. Reporting
      // here too would fire on every single failed attempt instead of only a sustained outage.
    };
    ws.onclose = () => {
      this.callbacks?.onConnectionChange?.(false);
      this.startConnectionErrorTimer();
      if (!this.closedByCaller) {
        this.scheduleReconnect();
      }
    };
    ws.onmessage = (event: WebSocketMessageEvent) => {
      const payload = JSON.parse(event.data);
      switch (payload.message) {
        case 'DeviceState':
          this.callbacks?.replaceDevice(payload.data);
          break;
        case 'Error': {
          const err = new Error(payload.data) as Error & { persistent?: boolean };
          if (payload.persistent) {
            err.persistent = true;
          }
          this.callbacks?.setErr(err);
          break;
        }
        case 'Catalogue':
          if (payload.data) {
            this.callbacks?.setMeta(payload.data);
          }
          break;
        case 'CatalogueEntries':
          if (payload.data) {
            this.callbacks?.loadEntries(
              Object.assign({}, ...payload.data.map((d: CatalogueEntry) => ({ [d.id]: d })))
            );
          }
          break;
        default:
          console.warn(`Unknown ws message ${event.data}`);
      }
    };
  };

  private scheduleReconnect = () => {
    if (this.reconnectTimer) return;
    const delay = Math.min(
      this.initialReconnectDelayMs * 2 ** this.reconnectAttempt,
      MAX_RECONNECT_DELAY_MS
    );
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closedByCaller) {
        this.connect();
      }
    }, delay);
  };

  private startConnectionErrorTimer = () => {
    if (this.connectionErrorTimer) return;
    this.connectionErrorTimer = setTimeout(() => {
      this.connectionErrorTimer = null;
      this.callbacks?.setErr(new Error(`Failed to connect to ${this.url}`));
    }, this.connectionErrorGraceMs);
  };

  private clearConnectionErrorTimer = () => {
    if (this.connectionErrorTimer) {
      clearTimeout(this.connectionErrorTimer);
      this.connectionErrorTimer = null;
    }
  };

  private reconnectNow = () => {
    if (this.closedByCaller || this.isConnected()) return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempt = 0;
    this.connect();
  };

  private handleAppStateChange = (state: AppStateStatus) => {
    if (state === 'active') {
      this.reconnectNow();
    }
  };

  private handleNetInfoChange = (state: { isConnected: boolean | null }) => {
    if (state.isConnected) {
      this.reconnectNow();
    }
  };

  isConnected = () => this.ws?.readyState === WebSocket.OPEN;

  loadCatalogue = () => {
    this.ws?.send('load catalogue');
  };

  close = () => {
    this.closedByCaller = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.clearConnectionErrorTimer();
    this.appStateSubscription?.remove();
    this.netInfoUnsubscribe?.();
    this.ws?.close();
  };
}
