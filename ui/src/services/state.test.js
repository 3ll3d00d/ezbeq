import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import StateService from './state';

// StateService reaches for the global WebSocket constructor directly, so tests drive it
// through a fake that records the instance and lets us fire the handlers it installs.
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

// every service registers page-level listeners, close them so they can't react to a later test's events
let services = [];
const track = service => {
    services.push(service);
    return service;
};

beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
});

const closeServices = () => {
    services.forEach(s => s.close());
    services = [];
};

afterEach(closeServices);

const makeService = () => {
    const service = track(new StateService('ws://test'));
    const setErr = vi.fn();
    const replaceDevice = vi.fn();
    const setMeta = vi.fn();
    const loadEntries = vi.fn();
    service.init(setErr, replaceDevice, setMeta, loadEntries);
    return {service, ws: FakeWebSocket.lastInstance, setErr, replaceDevice, setMeta, loadEntries};
};

describe('StateService ws message dispatch', () => {
    it('replaces the device on a DeviceState message', () => {
        const {ws, replaceDevice} = makeService();
        const device = {name: 'd1', masterVolume: -10};

        ws.emitMessage({message: 'DeviceState', data: device});

        expect(replaceDevice).toHaveBeenCalledWith(device);
    });

    it('raises a non-persistent error for a plain Error message', () => {
        const {ws, setErr} = makeService();

        ws.emitMessage({message: 'Error', data: 'device offline'});

        expect(setErr).toHaveBeenCalledTimes(1);
        const err = setErr.mock.calls[0][0];
        expect(err.message).toBe('device offline');
        expect(err.persistent).toBeUndefined();
    });

    it('marks an Error message persistent when the payload says so', () => {
        const {ws, setErr} = makeService();

        ws.emitMessage({message: 'Error', data: 'device offline', persistent: true});

        expect(setErr.mock.calls[0][0].persistent).toBe(true);
    });

    it('updates the catalogue meta on a Catalogue message with data', () => {
        const {ws, setMeta} = makeService();
        const meta = {version: 42};

        ws.emitMessage({message: 'Catalogue', data: meta});

        expect(setMeta).toHaveBeenCalledWith(meta);
    });

    it('ignores a Catalogue message with no data', () => {
        const {ws, setMeta} = makeService();

        ws.emitMessage({message: 'Catalogue', data: null});

        expect(setMeta).not.toHaveBeenCalled();
    });

    it('loads catalogue entries keyed by id on a CatalogueEntries message', () => {
        const {ws, loadEntries} = makeService();

        ws.emitMessage({message: 'CatalogueEntries', data: [{id: 'a', title: 'A'}, {id: 'b', title: 'B'}]});

        expect(loadEntries).toHaveBeenCalledWith({a: {id: 'a', title: 'A'}, b: {id: 'b', title: 'B'}});
    });

    it('ignores a CatalogueEntries message with no data', () => {
        const {ws, loadEntries} = makeService();

        ws.emitMessage({message: 'CatalogueEntries', data: null});

        expect(loadEntries).not.toHaveBeenCalled();
    });

    it('does not throw on an unrecognised message type', () => {
        const {ws} = makeService();

        expect(() => ws.emitMessage({message: 'SomethingElse', data: {}})).not.toThrow();
    });
});

describe('StateService other behavior', () => {
    it('reports connected only once the socket readyState is OPEN', () => {
        const {service, ws} = makeService();
        expect(service.isConnected()).toBe(false);

        ws.readyState = 1;

        expect(service.isConnected()).toBe(true);
    });

    it('sends a load-catalogue request over an open socket', () => {
        const {service, ws} = makeService();
        ws.readyState = 1;

        service.loadCatalogue();

        expect(ws.send).toHaveBeenCalledWith('load catalogue');
    });

    it('defers a load-catalogue request until the socket opens', () => {
        const {service, ws} = makeService();

        service.loadCatalogue();
        expect(ws.send).not.toHaveBeenCalled();

        ws.open();

        expect(ws.send).toHaveBeenCalledWith('load catalogue');
    });

    it('closes the underlying socket', () => {
        const {service, ws} = makeService();

        service.close();

        expect(ws.close).toHaveBeenCalled();
    });
});

describe('StateService reconnection', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        // before restoring real timers, so close() cancels the fake ones
        closeServices();
        vi.useRealTimers();
    });

    it('does not report an error for a socket error alone', () => {
        const {ws, setErr} = makeService();

        ws.onerror({});

        expect(setErr).not.toHaveBeenCalled();
    });

    it('reconnects with exponential backoff after the socket closes', () => {
        makeService();

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

    it('resets the backoff once a reconnect succeeds', () => {
        makeService();

        FakeWebSocket.lastInstance.drop();
        vi.advanceTimersByTime(1000);
        FakeWebSocket.lastInstance.open();
        FakeWebSocket.lastInstance.drop();
        vi.advanceTimersByTime(1000);

        expect(FakeWebSocket.instances).toHaveLength(3);
    });

    it('does not report an error when the reconnect succeeds within the grace period', () => {
        const {setErr} = makeService();

        FakeWebSocket.lastInstance.drop();
        vi.advanceTimersByTime(1000);
        FakeWebSocket.lastInstance.open();
        vi.advanceTimersByTime(20000);

        expect(setErr).not.toHaveBeenCalled();
    });

    it('reports a connection error once the socket stays down past the grace period', () => {
        const {setErr} = makeService();

        FakeWebSocket.lastInstance.drop();
        vi.advanceTimersByTime(9999);
        expect(setErr).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);

        expect(setErr).toHaveBeenCalledTimes(1);
        expect(setErr.mock.calls[0][0].message).toMatch(/Failed to connect to ws:\/\/test/);
    });

    it('reports a sustained outage once, not on every failed reconnect', () => {
        const {setErr} = makeService();

        for (let i = 0; i < 10; i++) {
            FakeWebSocket.lastInstance.drop();
            vi.advanceTimersByTime(30000);
        }
        expect(setErr).toHaveBeenCalledTimes(1);

        FakeWebSocket.lastInstance.open();
        FakeWebSocket.lastInstance.drop();
        vi.advanceTimersByTime(10000);
        expect(setErr).toHaveBeenCalledTimes(2);
    });

    it('gives an immediate reconnect a fresh grace period', () => {
        const {setErr} = makeService();
        FakeWebSocket.lastInstance.drop();
        vi.advanceTimersByTime(900);

        window.dispatchEvent(new Event('pageshow'));
        vi.advanceTimersByTime(9500);
        expect(setErr).not.toHaveBeenCalled();
        FakeWebSocket.lastInstance.open();
        vi.advanceTimersByTime(10000);

        expect(setErr).not.toHaveBeenCalled();
    });

    it('stops dispatching messages once closed by the caller', () => {
        const {service, ws} = makeService();

        service.close();

        expect(ws.onmessage).toBeNull();
    });

    it('falls back to logging a connection error before init has been called', () => {
        track(new StateService('ws://test'));
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        FakeWebSocket.lastInstance.drop();
        vi.advanceTimersByTime(10000);

        expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/Failed to connect to ws:\/\/test/));
        errorSpy.mockRestore();
    });

    it('ignores a late close from a socket it has already replaced', () => {
        makeService();
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
        makeService();
        FakeWebSocket.lastInstance.drop();

        fire();

        expect(FakeWebSocket.instances).toHaveLength(2);
    });

    it('does not reconnect when the page becomes hidden', () => {
        makeService();
        FakeWebSocket.lastInstance.drop();
        const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');

        document.dispatchEvent(new Event('visibilitychange'));

        expect(FakeWebSocket.instances).toHaveLength(1);
        visibility.mockRestore();
    });

    it('does not open a second socket on a page event while connected', () => {
        makeService();
        FakeWebSocket.lastInstance.open();

        window.dispatchEvent(new Event('pageshow'));

        expect(FakeWebSocket.instances).toHaveLength(1);
    });

    it('stops reconnecting once closed by the caller', () => {
        const {service, setErr} = makeService();

        service.close();
        FakeWebSocket.lastInstance.drop();
        window.dispatchEvent(new Event('online'));
        vi.advanceTimersByTime(60000);

        expect(FakeWebSocket.instances).toHaveLength(1);
        expect(setErr).not.toHaveBeenCalled();
    });
});
