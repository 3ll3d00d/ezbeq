// A websocket that keeps itself connected, shared by StateService and LevelsService. Same reconnect design as
// mobile/src/services/stateSocket.ts: exponential backoff, an immediate retry when the page becomes visible/is
// restored/comes back online, and a grace period before a connection failure is reported. Browsers (Safari
// especially - iOS kills sockets on lock/app switch, and its back-forward cache restores pages with their sockets
// already closed) drop the socket routinely, so a page reload can't be relied on as the recovery path.
//
// A heartbeat (ping -> Pong, see ezbeq/apis/ws.py) also catches a socket that still reports OPEN but is actually
// dead, which iOS can leave behind after a sleep and which would otherwise only be noticed when the OS gets round to
// closing it, potentially minutes later. It only acts once the server has answered a ping, so a server that predates
// the heartbeat isn't treated as dead every time it goes unanswered.
const MAX_RECONNECT_DELAY_MS = 30000;
const DEFAULT_INITIAL_RECONNECT_DELAY_MS = 1000;
// a disconnect that recovers within this window (e.g. a phone waking from lock) isn't worth an error, only one where
// the automatic reconnect isn't working
const DEFAULT_CONNECTION_ERROR_GRACE_MS = 10000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30000;
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 5000;
// WebSocket readyState values
const CONNECTING = 0;
const OPEN = 1;

class ReconnectingSocket {

    // onOpen(), onMessage(payload), onConnectionChange(connected) and reportError(message) are all optional
    constructor(url, callbacks = {}, options = {}) {
        this.url = url;
        this.callbacks = callbacks;
        this.initialReconnectDelayMs = options.initialReconnectDelayMs ?? DEFAULT_INITIAL_RECONNECT_DELAY_MS;
        this.connectionErrorGraceMs = options.connectionErrorGraceMs ?? DEFAULT_CONNECTION_ERROR_GRACE_MS;
        this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
        this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS;
        this.ws = null;
        this.reconnectAttempt = 0;
        this.reconnectTimer = null;
        this.connectionErrorTimer = null;
        // only report once per outage, not on every failed attempt while the server stays down
        this.connectionErrorReported = false;
        this.heartbeatTimer = null;
        this.heartbeatTimeoutTimer = null;
        this.pingSentAt = 0;
        this.serverAnswersPing = false;
        this.connectStartedAt = 0;
        this.closedByCaller = false;
        this.connect();
        document.addEventListener('visibilitychange', this.handleVisibilityChange);
        window.addEventListener('pageshow', this.handlePageReturn);
        window.addEventListener('online', this.handlePageReturn);
    }

    connect = () => {
        this.detach();
        this.connectStartedAt = Date.now();
        let ws;
        try {
            ws = new WebSocket(this.url);
        } catch (e) {
            console.warn(`Unable to create connection to ${this.url}`, e);
            this.ws = null;
            this.handleDisconnect();
            this.scheduleReconnect();
            return;
        }
        this.ws = ws;
        ws.onerror = e => {
            // onclose always follows, reconnect and error reporting are handled there
            console.warn(`Error on connection to ${this.url}`);
        };
        ws.onopen = e => {
            console.log(`Connected to ${this.url}`);
            this.reconnectAttempt = 0;
            this.clearConnectionErrorTimer();
            this.connectionErrorReported = false;
            this.heartbeatTimer = setInterval(this.checkAlive, this.heartbeatIntervalMs);
            this.callbacks.onConnectionChange?.(true);
            this.callbacks.onOpen?.();
        };
        ws.onclose = e => {
            console.log(`Closed connection to ${this.url} - ${e.code}`);
            this.handleDisconnect();
            this.scheduleReconnect();
        };
        ws.onmessage = event => {
            // any traffic proves the connection is alive
            this.clearHeartbeatTimeout();
            const payload = JSON.parse(event.data);
            if (payload.message === 'Pong') {
                this.serverAnswersPing = true;
            } else {
                this.callbacks.onMessage?.(payload);
            }
        };
    };

    // drops the current socket, detaching first so its late onclose can't start a second reconnect chain
    detach = () => {
        this.stopHeartbeat();
        if (this.ws) {
            this.ws.onopen = null;
            this.ws.onerror = null;
            this.ws.onclose = null;
            this.ws.onmessage = null;
            try {
                this.ws.close();
            } catch (e) {
                // already closed/closing
            }
        }
    };

    handleDisconnect = () => {
        this.stopHeartbeat();
        this.callbacks.onConnectionChange?.(false);
        this.startConnectionErrorTimer();
    };

    scheduleReconnect = () => {
        if (this.reconnectTimer) return;
        const delay = Math.min(this.initialReconnectDelayMs * 2 ** this.reconnectAttempt, MAX_RECONNECT_DELAY_MS);
        this.reconnectAttempt += 1;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            if (!this.closedByCaller) {
                this.connect();
            }
        }, delay);
    };

    startConnectionErrorTimer = () => {
        if (this.connectionErrorTimer || this.connectionErrorReported) return;
        this.connectionErrorTimer = setTimeout(() => {
            this.connectionErrorTimer = null;
            this.connectionErrorReported = true;
            const msg = `Failed to connect to ${this.url}`;
            if (this.callbacks.reportError) {
                this.callbacks.reportError(msg);
            } else {
                console.error(msg);
            }
        }, this.connectionErrorGraceMs);
    };

    clearConnectionErrorTimer = () => {
        if (this.connectionErrorTimer) {
            clearTimeout(this.connectionErrorTimer);
            this.connectionErrorTimer = null;
        }
    };

    // asks the server for a reply, reconnecting if none arrives in time
    checkAlive = () => {
        if (!this.isConnected()) return;
        // restart rather than keep a pending timeout, it may have been frozen along with the page and be overdue
        this.clearHeartbeatTimeout();
        this.pingSentAt = Date.now();
        this.heartbeatTimeoutTimer = setTimeout(() => {
            this.heartbeatTimeoutTimer = null;
            if (!this.serverAnswersPing) return;
            if (Date.now() - this.pingSentAt > this.heartbeatTimeoutMs * 2) {
                // the page was frozen meanwhile so the reply may simply not have been delivered yet, ask again
                this.checkAlive();
                return;
            }
            console.warn(`No heartbeat reply from ${this.url}, reconnecting`);
            this.handleDisconnect();
            this.reconnectNow();
        }, this.heartbeatTimeoutMs);
        this.ws.send('ping');
    };

    clearHeartbeatTimeout = () => {
        if (this.heartbeatTimeoutTimer) {
            clearTimeout(this.heartbeatTimeoutTimer);
            this.heartbeatTimeoutTimer = null;
        }
    };

    stopHeartbeat = () => {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
        this.clearHeartbeatTimeout();
    };

    // skips the backoff wait
    reconnectNow = () => {
        if (this.closedByCaller) return;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.reconnectAttempt = 0;
        // timers are frozen while a page is hidden (e.g. a locked iPhone) so the grace period is likely already
        // overdue, give the fresh attempt a full one rather than erroring immediately
        if (this.connectionErrorTimer) {
            this.clearConnectionErrorTimer();
            this.startConnectionErrorTimer();
        }
        this.connect();
    };

    // the page is back in view or the network has returned, the socket may have died meanwhile even if it claims
    // to be open
    handlePageReturn = () => {
        if (this.closedByCaller) return;
        if (this.isConnected()) {
            this.checkAlive();
        } else if (!this.ws || this.ws.readyState !== CONNECTING
            || Date.now() - this.connectStartedAt > this.heartbeatTimeoutMs) {
            // a connection attempt left over from before the page was hidden may never complete
            this.reconnectNow();
        }
    };

    handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
            this.handlePageReturn();
        }
    };

    isConnected = () => this.ws !== null && this.ws.readyState === OPEN;

    send = msg => this.ws.send(msg);

    close = () => {
        this.closedByCaller = true;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.clearConnectionErrorTimer();
        document.removeEventListener('visibilitychange', this.handleVisibilityChange);
        window.removeEventListener('pageshow', this.handlePageReturn);
        window.removeEventListener('online', this.handlePageReturn);
        this.detach();
        this.ws = null;
    };
}

export default ReconnectingSocket;
