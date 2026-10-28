// Same reconnect design as mobile/src/services/stateSocket.ts: exponential backoff, an immediate
// retry when the page becomes visible/is restored/comes back online, and a grace period before a
// connection failure is reported. Browsers (Safari especially - iOS kills sockets on lock/app
// switch, and its back-forward cache restores pages with their sockets already closed) drop the
// socket routinely, so a page reload can't be relied on as the recovery path. The server resends
// meta and full device state on every new connection, so a reconnect resyncs the UI by itself.
const MAX_RECONNECT_DELAY_MS = 30000;
const DEFAULT_INITIAL_RECONNECT_DELAY_MS = 1000;
// a disconnect that recovers within this window (e.g. a phone waking from lock) isn't worth an
// error, only one where the automatic reconnect isn't working
const DEFAULT_CONNECTION_ERROR_GRACE_MS = 10000;

class StateService {

    constructor(url, options = {}) {
        this.url = url;
        this.initialReconnectDelayMs = options.initialReconnectDelayMs ?? DEFAULT_INITIAL_RECONNECT_DELAY_MS;
        this.connectionErrorGraceMs = options.connectionErrorGraceMs ?? DEFAULT_CONNECTION_ERROR_GRACE_MS;
        this.ws = null;
        this.setErr = null;
        this.replaceDevice = null;
        this.loadEntries = null;
        this.setMeta = null;
        this.reconnectAttempt = 0;
        this.reconnectTimer = null;
        this.connectionErrorTimer = null;
        // only report once per outage, not on every failed attempt while the server stays down
        this.connectionErrorReported = false;
        this.closedByCaller = false;
        // a catalogue request made while the socket was down, sent as soon as it reopens
        this.catalogueRequested = false;
        this.connect();
        document.addEventListener('visibilitychange', this.handleVisibilityChange);
        window.addEventListener('pageshow', this.reconnectNow);
        window.addEventListener('online', this.reconnectNow);
    }

    init = (setErr, replaceDevice, setMeta, loadEntries) => {
        this.setErr = setErr;
        this.replaceDevice = replaceDevice;
        this.setMeta = setMeta;
        this.loadEntries = loadEntries;
    }

    connect = () => {
        // detach the old socket first so its late onclose can't start a second reconnect chain
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
        const ws = new WebSocket(this.url);
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
            if (this.catalogueRequested) {
                this.catalogueRequested = false;
                ws.send('load catalogue');
            }
        }
        ws.onclose = e => {
            console.log(`Closed connection to ${this.url} - ${e.code}`);
            if (this.closedByCaller) return;
            this.startConnectionErrorTimer();
            this.scheduleReconnect();
        }
        ws.onmessage = event => {
            const payload = JSON.parse(event.data);
            switch (payload.message) {
                case 'DeviceState':
                    console.debug(`Replacing Device ${payload.data.name}`);
                    this.replaceDevice(payload.data);
                    break;
                case 'Error':
                    const err = new Error(payload.data);
                    if (payload.persistent) {
                        err.persistent = true;
                    }
                    this.setErr(err);
                    break;
                case 'Catalogue':
                    if (payload.data) {
                        console.debug(`Updating catalogue to version ${payload.data.version}`);
                        this.setMeta(payload.data);
                    }
                    break;
                case 'CatalogueEntries':
                    if (payload.data) {
                        console.debug(`Received ${payload.data.length} catalogue entries at ${new Date(Date.now()).toISOString()}`);
                        this.loadEntries(Object.assign({}, ...payload.data.map(d => {
                            return {[d.id]: d};
                        })));
                    }
                    break;
                default:
                    console.warn(`Unknown ws message ${event.data}`)
            }
        };
    }

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
    }

    startConnectionErrorTimer = () => {
        if (this.connectionErrorTimer || this.connectionErrorReported) return;
        this.connectionErrorTimer = setTimeout(() => {
            this.connectionErrorTimer = null;
            this.connectionErrorReported = true;
            const msg = `Failed to connect to ${this.url}`;
            if (this.setErr) {
                this.setErr(new Error(msg));
            } else {
                console.error(msg);
            }
        }, this.connectionErrorGraceMs);
    }

    clearConnectionErrorTimer = () => {
        if (this.connectionErrorTimer) {
            clearTimeout(this.connectionErrorTimer);
            this.connectionErrorTimer = null;
        }
    }

    // skip the backoff wait, used when the page comes back into view or the network returns
    reconnectNow = () => {
        // CONNECTING or OPEN, nothing to do
        if (this.closedByCaller || (this.ws && this.ws.readyState <= 1)) return;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.reconnectAttempt = 0;
        // timers are frozen while a page is hidden (e.g. a locked iPhone) so the grace period is
        // likely already overdue, give the fresh attempt a full one rather than erroring immediately
        if (this.connectionErrorTimer) {
            this.clearConnectionErrorTimer();
            this.startConnectionErrorTimer();
        }
        this.connect();
    }

    handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
            this.reconnectNow();
        }
    }

    isConnected = () => this.ws !== null && this.ws.readyState === 1;

    loadCatalogue = () => {
        if (this.isConnected()) {
            this.ws.send('load catalogue');
        } else {
            this.catalogueRequested = true;
        }
    }

    close = () => {
        this.closedByCaller = true;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.clearConnectionErrorTimer();
        document.removeEventListener('visibilitychange', this.handleVisibilityChange);
        window.removeEventListener('pageshow', this.reconnectNow);
        window.removeEventListener('online', this.reconnectNow);
        this.ws.onmessage = null;
        this.ws.close();
    };
}

export default StateService;
