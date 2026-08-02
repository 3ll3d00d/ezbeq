import {beforeAll, describe, expect, it, vi} from 'vitest';

// App.jsx instantiates a module-level `new StateService(...)` (a real WebSocket connection)
// as a side effect of import, so WebSocket must be stubbed before the module is evaluated -
// a dynamic import after stubGlobal, rather than a static import, guarantees that ordering.
class FakeWebSocket {
    constructor() {
        this.readyState = 0;
    }
}

let mergeDeviceByName;
let shouldAcceptRestDeviceUpdate;

beforeAll(async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    // App.jsx statically imports the whole view tree (Levels -> uplot), which touches
    // matchMedia at module-eval time; jsdom doesn't implement it, so stub a minimal one
    vi.stubGlobal('matchMedia', () => ({
        matches: false,
        addEventListener: () => {},
        removeEventListener: () => {}
    }));
    ({mergeDeviceByName, shouldAcceptRestDeviceUpdate} = await import('./App'));
});

describe('mergeDeviceByName', () => {
    it('adds a new device keyed by name', () => {
        const devices = {d1: {name: 'd1', masterVolume: -10}};
        const merged = mergeDeviceByName(devices, {name: 'd2', masterVolume: -5});

        expect(merged).toEqual({
            d1: {name: 'd1', masterVolume: -10},
            d2: {name: 'd2', masterVolume: -5}
        });
    });

    it('replaces an existing device with the same name, leaving other devices untouched', () => {
        const devices = {
            d1: {name: 'd1', masterVolume: -10},
            d2: {name: 'd2', masterVolume: -5}
        };
        const merged = mergeDeviceByName(devices, {name: 'd1', masterVolume: -20});

        expect(merged).toEqual({
            d1: {name: 'd1', masterVolume: -20},
            d2: {name: 'd2', masterVolume: -5}
        });
    });

    it('does not mutate the input devices object', () => {
        const devices = {d1: {name: 'd1', masterVolume: -10}};
        const snapshot = JSON.parse(JSON.stringify(devices));

        mergeDeviceByName(devices, {name: 'd1', masterVolume: -20});

        expect(devices).toEqual(snapshot);
    });
});

describe('shouldAcceptRestDeviceUpdate', () => {
    it('accepts the update when the socket is not connected', () => {
        expect(shouldAcceptRestDeviceUpdate({isConnected: () => false})).toBe(true);
    });

    it('discards the update when the socket is connected (it would already be stale)', () => {
        expect(shouldAcceptRestDeviceUpdate({isConnected: () => true})).toBe(false);
    });

    it('accepts the update when there is no state service at all', () => {
        expect(shouldAcceptRestDeviceUpdate(null)).toBe(true);
    });
});
