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

describe('StateService catalogue loading', () => {
    const entries = n => Array.from({length: n}, (_, i) => ({id: `e${i}`}));

    const connectWithCatalogue = count => {
        const ctx = makeService();
        ctx.ws.open();
        ctx.ws.emitMessage({message: 'Catalogue', data: {version: 1, count}});
        return ctx;
    };

    const reconnect = () => {
        FakeWebSocket.lastInstance.drop();
        window.dispatchEvent(new Event('online'));
        FakeWebSocket.lastInstance.open();
        return FakeWebSocket.lastInstance;
    };

    it('requests the catalogue again when the socket drops mid-download', () => {
        const {service, ws} = connectWithCatalogue(3);
        service.loadCatalogue();
        ws.emitMessage({message: 'CatalogueEntries', data: entries(2)});

        const next = reconnect();

        expect(next.send).toHaveBeenCalledWith('load catalogue');
    });

    it('counts a restarted download from zero', () => {
        const {service, ws} = connectWithCatalogue(3);
        service.loadCatalogue();
        ws.emitMessage({message: 'CatalogueEntries', data: entries(2)});
        const next = reconnect();
        next.emitMessage({message: 'CatalogueEntries', data: entries(2)});

        const last = reconnect();

        expect(last.send).toHaveBeenCalledWith('load catalogue');
    });

    it('does not request it again once it has all arrived', () => {
        const {service, ws} = connectWithCatalogue(3);
        service.loadCatalogue();
        ws.emitMessage({message: 'CatalogueEntries', data: entries(2)});
        ws.emitMessage({message: 'CatalogueEntries', data: entries(1)});

        const next = reconnect();

        expect(next.send).not.toHaveBeenCalledWith('load catalogue');
    });

    it('does not request one that was never asked for', () => {
        connectWithCatalogue(3);

        const next = reconnect();

        expect(next.send).not.toHaveBeenCalledWith('load catalogue');
    });

    it('keeps requesting on reconnect when the catalogue size is unknown', () => {
        const {service, ws} = makeService();
        ws.open();
        service.loadCatalogue();
        ws.emitMessage({message: 'CatalogueEntries', data: entries(2)});

        const next = reconnect();

        expect(next.send).toHaveBeenCalledWith('load catalogue');
    });

    it('treats an empty catalogue as complete', () => {
        const {service} = connectWithCatalogue(0);
        service.loadCatalogue();

        const next = reconnect();

        expect(next.send).not.toHaveBeenCalledWith('load catalogue');
    });

});

describe('StateService connection errors', () => {
    it('clears its connection error once reconnected, via a functional update of the error state', () => {
        vi.useFakeTimers();
        let err = null;
        const setErr = vi.fn(v => {
            err = typeof v === 'function' ? v(err) : v;
        });
        const service = new StateService('ws://test');
        service.init(setErr, vi.fn(), vi.fn(), vi.fn());

        FakeWebSocket.lastInstance.drop();
        vi.advanceTimersByTime(10000);
        expect(err).toEqual(new Error('Failed to connect to ws://test'));
        FakeWebSocket.lastInstance.open();

        expect(err).toBeNull();
        service.close();
        vi.useRealTimers();
    });
});
