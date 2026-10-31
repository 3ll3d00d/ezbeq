import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import ReconnectingSocket, {connectionErrorCallbacks} from './socket';

class FakeWebSocket {
    constructor(url) {
        this.url = url;
        this.readyState = 0;
        this.send = vi.fn();
        this.close = vi.fn();
        FakeWebSocket.instances.push(this);
        FakeWebSocket.lastInstance = this;
    }

    open() {
        this.readyState = 1;
        this.onopen({});
    }

    // an unexpected close, e.g. Safari dropping the socket when the tab is backgrounded
    drop() {
        this.readyState = 3;
        this.onclose({code: 1006});
    }

    emitMessage(payload) {
        this.onmessage({data: JSON.stringify(payload)});
    }
}

// every socket registers page-level listeners, close them so they can't react to a later test's events
let sockets = [];

const makeSocket = () => {
    const callbacks = {
        onOpen: vi.fn(),
        onMessage: vi.fn(),
        onConnectionChange: vi.fn(),
        reportError: vi.fn(),
        clearError: vi.fn()
    };
    const socket = new ReconnectingSocket('ws://test', callbacks);
    sockets.push(socket);
    return {socket, ...callbacks};
};

const pingsSent = ws => ws.send.mock.calls.filter(c => c[0] === 'ping').length;

// opens the socket and lets one heartbeat round trip complete, so the socket knows the server answers pings
const openWithHeartbeat = () => {
    const ws = FakeWebSocket.lastInstance;
    ws.open();
    vi.advanceTimersByTime(30000);
    ws.emitMessage({message: 'Pong'});
    return ws;
};

beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.useFakeTimers();
});

afterEach(() => {
    // before restoring real timers, so close() cancels the fake ones
    sockets.forEach(s => s.close());
    sockets = [];
    vi.useRealTimers();
    vi.unstubAllGlobals();
    // a failed assertion can skip a test's own mockRestore, don't leave e.g. a hidden page behind for the next one
    vi.restoreAllMocks();
});

describe('ReconnectingSocket messages', () => {
    it('passes parsed messages on', () => {
        const {onMessage} = makeSocket();
        FakeWebSocket.lastInstance.open();

        FakeWebSocket.lastInstance.emitMessage({message: 'DeviceState', data: {}});

        expect(onMessage).toHaveBeenCalledWith({message: 'DeviceState', data: {}});
    });

    it('swallows heartbeat replies', () => {
        const {onMessage} = makeSocket();
        FakeWebSocket.lastInstance.open();

        FakeWebSocket.lastInstance.emitMessage({message: 'Pong'});

        expect(onMessage).not.toHaveBeenCalled();
    });

    it('reports open and connection changes', () => {
        const {onOpen, onConnectionChange} = makeSocket();

        FakeWebSocket.lastInstance.open();
        expect(onOpen).toHaveBeenCalledTimes(1);
        expect(onConnectionChange).toHaveBeenLastCalledWith(true);

        FakeWebSocket.lastInstance.drop();
        expect(onConnectionChange).toHaveBeenLastCalledWith(false);
    });

    it('reports connected only once the socket is OPEN', () => {
        const {socket} = makeSocket();
        expect(socket.isConnected()).toBe(false);

        FakeWebSocket.lastInstance.open();

        expect(socket.isConnected()).toBe(true);
    });
});

describe('ReconnectingSocket reconnection', () => {
    it('does not report an error for a socket error alone', () => {
        const {reportError} = makeSocket();

        FakeWebSocket.lastInstance.onerror({});

        expect(reportError).not.toHaveBeenCalled();
    });

    it('reconnects with exponential backoff after the socket closes', () => {
        makeSocket();

        FakeWebSocket.lastInstance.drop();
        vi.advanceTimersByTime(999);
        expect(FakeWebSocket.instances).toHaveLength(1);
        vi.advanceTimersByTime(1);
        expect(FakeWebSocket.instances).toHaveLength(2);

        FakeWebSocket.lastInstance.drop();
        vi.advanceTimersByTime(1999);
        expect(FakeWebSocket.instances).toHaveLength(2);
        vi.advanceTimersByTime(1);
        expect(FakeWebSocket.instances).toHaveLength(3);
    });

    it('caps the backoff', () => {
        makeSocket();

        for (let i = 0; i < 10; i++) {
            FakeWebSocket.lastInstance.drop();
            vi.advanceTimersByTime(30000);
        }

        expect(FakeWebSocket.instances).toHaveLength(11);
    });

    it('resets the backoff once a reconnect succeeds', () => {
        makeSocket();

        FakeWebSocket.lastInstance.drop();
        vi.advanceTimersByTime(1000);
        FakeWebSocket.lastInstance.open();
        FakeWebSocket.lastInstance.drop();
        vi.advanceTimersByTime(1000);

        expect(FakeWebSocket.instances).toHaveLength(3);
    });

    it('does not report an error when the reconnect succeeds within the grace period', () => {
        const {reportError} = makeSocket();

        FakeWebSocket.lastInstance.drop();
        vi.advanceTimersByTime(1000);
        FakeWebSocket.lastInstance.open();
        vi.advanceTimersByTime(20000);

        expect(reportError).not.toHaveBeenCalled();
    });

    it('reports a connection error once the socket stays down past the grace period', () => {
        const {reportError} = makeSocket();

        FakeWebSocket.lastInstance.drop();
        vi.advanceTimersByTime(9999);
        expect(reportError).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);

        expect(reportError).toHaveBeenCalledWith('Failed to connect to ws://test');
    });

    it('does not report a connection error while the page is hidden', () => {
        const {reportError} = makeSocket();
        const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');

        FakeWebSocket.lastInstance.drop();
        vi.advanceTimersByTime(60000);
        expect(reportError).not.toHaveBeenCalled();

        // still down once the page is back, the reconnect on return gets a full grace period
        visibility.mockReturnValue('visible');
        document.dispatchEvent(new Event('visibilitychange'));
        vi.advanceTimersByTime(9999);
        expect(reportError).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(reportError).toHaveBeenCalledTimes(1);
        visibility.mockRestore();
    });

    it('gives a reconnect attempt already under way a full grace period when the page becomes visible', () => {
        const {reportError} = makeSocket();
        const visibility = vi.spyOn(document, 'visibilityState', 'get');
        FakeWebSocket.lastInstance.drop();
        vi.advanceTimersByTime(9000);
        visibility.mockReturnValue('hidden');
        document.dispatchEvent(new Event('visibilitychange'));

        // a backoff reconnect starts just before the page is back, so that attempt is left to carry on
        FakeWebSocket.lastInstance.drop();
        vi.advanceTimersByTime(2000);
        const attempts = FakeWebSocket.instances.length;
        visibility.mockReturnValue('visible');
        document.dispatchEvent(new Event('visibilitychange'));
        expect(FakeWebSocket.instances).toHaveLength(attempts);
        vi.advanceTimersByTime(9999);

        expect(reportError).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(reportError).toHaveBeenCalledTimes(1);
    });

    it('does not run the grace period timer while the page is hidden', () => {
        makeSocket();
        const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');

        FakeWebSocket.lastInstance.drop();
        visibility.mockRestore();
        // only the reconnect backoff is pending
        expect(vi.getTimerCount()).toBe(1);
    });

    it('clears a reported connection error once reconnected', () => {
        const {reportError, clearError} = makeSocket();

        FakeWebSocket.lastInstance.drop();
        vi.advanceTimersByTime(10000);
        expect(reportError).toHaveBeenCalledTimes(1);
        expect(clearError).not.toHaveBeenCalled();
        FakeWebSocket.lastInstance.open();

        expect(clearError).toHaveBeenCalledTimes(1);
    });

    it('does not clear errors when reconnecting within the grace period', () => {
        const {clearError} = makeSocket();

        FakeWebSocket.lastInstance.open();
        FakeWebSocket.lastInstance.drop();
        vi.advanceTimersByTime(1000);
        FakeWebSocket.lastInstance.open();

        expect(clearError).not.toHaveBeenCalled();
    });

    it('reports a sustained outage once, not on every failed reconnect', () => {
        const {reportError} = makeSocket();

        for (let i = 0; i < 10; i++) {
            FakeWebSocket.lastInstance.drop();
            vi.advanceTimersByTime(30000);
        }
        expect(reportError).toHaveBeenCalledTimes(1);

        FakeWebSocket.lastInstance.open();
        FakeWebSocket.lastInstance.drop();
        vi.advanceTimersByTime(10000);
        expect(reportError).toHaveBeenCalledTimes(2);
    });

    it('logs a connection error when there is no reporter', () => {
        const socket = new ReconnectingSocket('ws://test');
        sockets.push(socket);
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        FakeWebSocket.lastInstance.drop();
        vi.advanceTimersByTime(10000);

        expect(errorSpy).toHaveBeenCalledWith('Failed to connect to ws://test');
        errorSpy.mockRestore();
    });

    it('ignores a late close from a socket it has already replaced', () => {
        makeSocket();
        const first = FakeWebSocket.lastInstance;
        const firstOnClose = first.onclose;

        first.drop();
        vi.advanceTimersByTime(1000);
        expect(first.onclose).toBeNull();
        firstOnClose({code: 1006});
        vi.advanceTimersByTime(1000);

        expect(FakeWebSocket.instances).toHaveLength(2);
    });

    it.each([
        ['the page is restored from the back-forward cache', () => window.dispatchEvent(new Event('pageshow'))],
        ['the network comes back', () => window.dispatchEvent(new Event('online'))],
        ['the page becomes visible', () => document.dispatchEvent(new Event('visibilitychange'))],
    ])('reconnects immediately when %s', (_, fire) => {
        makeSocket();
        FakeWebSocket.lastInstance.drop();

        fire();

        expect(FakeWebSocket.instances).toHaveLength(2);
    });

    it('does not reconnect when the page becomes hidden', () => {
        makeSocket();
        FakeWebSocket.lastInstance.drop();
        const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');

        document.dispatchEvent(new Event('visibilitychange'));

        expect(FakeWebSocket.instances).toHaveLength(1);
        visibility.mockRestore();
    });

    it('does not abandon a socket that is still connecting', () => {
        makeSocket();

        window.dispatchEvent(new Event('pageshow'));

        expect(FakeWebSocket.instances).toHaveLength(1);
    });

    it('replaces a connection attempt that has been stuck since before the page was hidden', () => {
        makeSocket();
        vi.setSystemTime(Date.now() + 60000);

        window.dispatchEvent(new Event('pageshow'));

        expect(FakeWebSocket.instances).toHaveLength(2);
    });

    it('keeps retrying when the socket cannot even be created', () => {
        const {socket, onConnectionChange} = makeSocket();
        vi.stubGlobal('WebSocket', class {
            constructor() {
                throw new Error('SecurityError');
            }
        });
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        FakeWebSocket.lastInstance.drop();
        vi.advanceTimersByTime(1000);
        expect(socket.isConnected()).toBe(false);
        expect(onConnectionChange).toHaveBeenLastCalledWith(false);
        vi.stubGlobal('WebSocket', FakeWebSocket);
        vi.advanceTimersByTime(2000);

        expect(FakeWebSocket.instances).toHaveLength(2);
        warnSpy.mockRestore();
    });

    it('does not postpone the error for an immediate reconnect on a page that was never hidden', () => {
        const {reportError} = makeSocket();
        FakeWebSocket.lastInstance.drop();
        vi.advanceTimersByTime(5000);

        window.dispatchEvent(new Event('online'));
        vi.advanceTimersByTime(4999);
        expect(reportError).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);

        expect(reportError).toHaveBeenCalledTimes(1);
    });

    it('withdraws its reported error when closed by the caller', () => {
        const {socket, clearError} = makeSocket();
        FakeWebSocket.lastInstance.drop();
        vi.advanceTimersByTime(10000);

        socket.close();

        expect(clearError).toHaveBeenCalledTimes(1);
    });

    it('stops reconnecting once closed by the caller', () => {
        const {socket, reportError} = makeSocket();
        const ws = FakeWebSocket.lastInstance;

        socket.close();
        expect(ws.close).toHaveBeenCalled();
        expect(ws.onmessage).toBeNull();
        window.dispatchEvent(new Event('online'));
        vi.advanceTimersByTime(60000);

        expect(FakeWebSocket.instances).toHaveLength(1);
        expect(reportError).not.toHaveBeenCalled();
    });
});

describe('ReconnectingSocket heartbeat', () => {
    it('pings periodically while open', () => {
        makeSocket();
        const ws = FakeWebSocket.lastInstance;
        ws.open();

        vi.advanceTimersByTime(30000);
        expect(pingsSent(ws)).toBe(1);
        ws.emitMessage({message: 'Pong'});
        vi.advanceTimersByTime(30000);

        expect(pingsSent(ws)).toBe(2);
        expect(FakeWebSocket.instances).toHaveLength(1);
    });

    it('stays connected while replies arrive', () => {
        makeSocket();
        const ws = FakeWebSocket.lastInstance;
        ws.open();

        vi.advanceTimersByTime(30000);
        vi.advanceTimersByTime(4999);
        ws.emitMessage({message: 'Pong'});
        vi.advanceTimersByTime(10000);

        expect(FakeWebSocket.instances).toHaveLength(1);
    });

    it('treats any message as a reply', () => {
        makeSocket();
        const ws = FakeWebSocket.lastInstance;
        ws.open();

        vi.advanceTimersByTime(30000);
        ws.emitMessage({message: 'Levels', data: {}});
        vi.advanceTimersByTime(5000);

        expect(FakeWebSocket.instances).toHaveLength(1);
    });

    it('reconnects when a ping goes unanswered', () => {
        const {onConnectionChange} = makeSocket();
        const ws = openWithHeartbeat();

        vi.advanceTimersByTime(30000);
        vi.advanceTimersByTime(5000);

        expect(onConnectionChange).toHaveBeenLastCalledWith(false);
        expect(ws.close).toHaveBeenCalled();
        expect(FakeWebSocket.instances).toHaveLength(2);
    });

    it('checks a socket that claims to be open as soon as the page returns', () => {
        makeSocket();
        const ws = openWithHeartbeat();

        window.dispatchEvent(new Event('pageshow'));
        expect(pingsSent(ws)).toBe(2);
        expect(FakeWebSocket.instances).toHaveLength(1);
        vi.advanceTimersByTime(5000);

        expect(FakeWebSocket.instances).toHaveLength(2);
    });

    it('gives a ping a fresh timeout when the page returns', () => {
        makeSocket();
        const ws = openWithHeartbeat();
        vi.advanceTimersByTime(34000);

        window.dispatchEvent(new Event('pageshow'));
        vi.advanceTimersByTime(4000);
        ws.emitMessage({message: 'Pong'});
        vi.advanceTimersByTime(5000);

        expect(FakeWebSocket.instances).toHaveLength(1);
    });

    it('stops pinging once the socket closes', () => {
        makeSocket();
        const ws = FakeWebSocket.lastInstance;
        ws.open();
        ws.drop();

        vi.advanceTimersByTime(30000);

        expect(pingsSent(ws)).toBe(0);
    });

    it('does not treat a server that never answers pings as dead', () => {
        makeSocket();
        const ws = FakeWebSocket.lastInstance;
        ws.open();

        vi.advanceTimersByTime(120000);

        expect(pingsSent(ws)).toBe(4);
        expect(FakeWebSocket.instances).toHaveLength(1);
    });

    it('asks again rather than reconnecting when the timeout was held up by a frozen page', () => {
        makeSocket();
        const ws = openWithHeartbeat();
        vi.advanceTimersByTime(30000);

        // the page is frozen for a minute, the clock moves on but no timers run
        vi.setSystemTime(Date.now() + 60000);
        vi.advanceTimersByTime(5000);

        expect(pingsSent(ws)).toBe(3);
        expect(FakeWebSocket.instances).toHaveLength(1);
    });

});

describe('connectionErrorCallbacks', () => {
    // a stand in for a React state setter, applying functional updates
    const errState = () => {
        const state = {err: null};
        state.setErr = vi.fn(v => {
            state.err = typeof v === 'function' ? v(state.err) : v;
        });
        return state;
    };

    it('reports the error via setErr', () => {
        const state = errState();
        const {reportError} = connectionErrorCallbacks(() => state.setErr);

        reportError('Failed to connect to ws://test');

        expect(state.err).toEqual(new Error('Failed to connect to ws://test'));
    });

    it('clears the error it reported', () => {
        const state = errState();
        const {reportError, clearError} = connectionErrorCallbacks(() => state.setErr);

        reportError('Failed to connect to ws://test');
        clearError();

        expect(state.err).toBeNull();
    });

    it('leaves a different error that has replaced it alone', () => {
        const state = errState();
        const {reportError, clearError} = connectionErrorCallbacks(() => state.setErr);
        const other = new Error('Something else');

        reportError('Failed to connect to ws://test');
        state.setErr(other);
        clearError();

        expect(state.err).toBe(other);
    });

    it('logs the error when there is no setErr yet', () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const {reportError, clearError} = connectionErrorCallbacks(() => null);

        reportError('Failed to connect to ws://test');
        clearError();

        expect(errorSpy).toHaveBeenCalledWith('Failed to connect to ws://test');
        errorSpy.mockRestore();
    });
});
