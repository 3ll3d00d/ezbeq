import {beforeEach, describe, expect, it, vi} from 'vitest';
import StateService from './state';

// StateService reaches for the global WebSocket constructor directly, so tests drive it
// through a fake that records the instance and lets us fire the handlers it installs.
class FakeWebSocket {
    constructor(url) {
        this.url = url;
        this.readyState = 0;
        this.send = vi.fn();
        this.close = vi.fn();
        FakeWebSocket.lastInstance = this;
    }

    emitMessage(payload) {
        this.onmessage({data: JSON.stringify(payload)});
    }
}

beforeEach(() => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
});

const makeService = () => {
    const service = new StateService('ws://test');
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

    it('sends a load-catalogue request over the socket', () => {
        const {service, ws} = makeService();

        service.loadCatalogue();

        expect(ws.send).toHaveBeenCalledWith('load catalogue');
    });

    it('closes the underlying socket', () => {
        const {service, ws} = makeService();

        service.close();

        expect(ws.close).toHaveBeenCalled();
    });

    it('reports a connection error via setErr once initialised', () => {
        const {ws, setErr} = makeService();

        ws.onerror({});

        expect(setErr).toHaveBeenCalledTimes(1);
        expect(setErr.mock.calls[0][0].message).toMatch(/Failed to connect to ws:\/\/test/);
    });

    it('falls back to logging a connection error before init has been called', () => {
        const service = new StateService('ws://test');
        const ws = FakeWebSocket.lastInstance;
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        ws.onerror({});

        expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/Failed to connect to ws:\/\/test/));
        errorSpy.mockRestore();
    });
});
