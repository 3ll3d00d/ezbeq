import {beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';

// App.jsx instantiates a module-level `new StateService(...)` (a real WebSocket connection)
// as a side effect of import, so WebSocket must be stubbed before the module is evaluated -
// a dynamic import after stubGlobal, rather than a static import, guarantees that ordering.
class FakeWebSocket {
    constructor() {
        this.readyState = 0;
    }
}

vi.mock('./services/ezbeq', () => ({
    default: {
        getDevices: vi.fn(() => Promise.resolve({})),
        getVersion: vi.fn(() => Promise.resolve({})),
        getWhatsNew: vi.fn(() => Promise.resolve([])),
        getAuthors: vi.fn(() => Promise.resolve([])),
        getLanguages: vi.fn(() => Promise.resolve([])),
        getYears: vi.fn(() => Promise.resolve([])),
        getAudioTypes: vi.fn(() => Promise.resolve([])),
        getContentTypes: vi.fn(() => Promise.resolve([])),
        getLevels: vi.fn(() => Promise.resolve({}))
    }
}));

let App;
let mergeDeviceByName;
let shouldAcceptRestDeviceUpdate;
let ezbeq;

beforeAll(async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    // App.jsx statically imports the whole view tree (Levels -> uplot), which touches
    // matchMedia at module-eval time; jsdom doesn't implement it, so stub a minimal one
    vi.stubGlobal('matchMedia', () => ({
        matches: false,
        addEventListener: () => {},
        removeEventListener: () => {}
    }));
    ({default: App, mergeDeviceByName, shouldAcceptRestDeviceUpdate} = await import('./App'));
    ({default: ezbeq} = await import('./services/ezbeq'));
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

    it('merges a composite device state (with a members breakdown) by name like any other device', () => {
        const devices = {sub1: {name: 'sub1', masterVolume: -10}};
        const composite = {
            name: 'bass_array',
            type: 'composite',
            masterVolume: -10,
            slots: [{id: '1', active: true, last: 'Empty'}],
            members: {
                sub1: {name: 'sub1', type: 'minidsp', masterVolume: -10},
                sub2: {name: 'sub2', type: 'minidsp', masterVolume: -10}
            }
        };
        const merged = mergeDeviceByName(devices, composite);

        expect(merged).toEqual({
            sub1: {name: 'sub1', masterVolume: -10},
            bass_array: composite
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

// Full render: confirms App actually wires ezbeq.getDevices()'s response through to the
// rendered view, and that switching nav tabs swaps which top-level view is shown. Levels/Chart
// (uPlot, needs a canvas 2d context jsdom doesn't provide) is out of scope here - only
// catalogue/control are exercised.
describe('App', () => {
    const gainDevice = () => ({
        d1: {name: 'd1', type: 'minidsp', connected: true, masterVolume: -10, mute: false, slots: []}
    });

    beforeEach(() => {
        ezbeq.getDevices.mockReset().mockResolvedValue({});
        ezbeq.getVersion.mockReset().mockResolvedValue({});
    });

    it('renders the catalogue view by default', async () => {
        render(<App/>);
        expect(await screen.findByPlaceholderText('Search…')).toBeInTheDocument();
    });

    it("wires a device from getDevices() through to the rendered Slots gain panel", async () => {
        ezbeq.getDevices.mockResolvedValue(gainDevice());
        const {container} = render(<App/>);

        await waitFor(() => expect(container.querySelector('input[type="range"]')).toBeInTheDocument());
    });

    it('switches to the Control (Minidsp) view and back via the header nav menu', async () => {
        ezbeq.getDevices.mockResolvedValue(gainDevice());
        const {container} = render(<App/>);
        // wait for the device to actually load - Header only shows the nav menu once it
        // knows the selected device's type supports more than one tab
        await waitFor(() => expect(container.querySelector('input[type="range"]')).toBeInTheDocument());

        fireEvent.click(screen.getByRole('button', {name: 'show more'}));
        fireEvent.click(screen.getByText('Control'));

        expect(await screen.findByText('Advanced')).toBeInTheDocument();
        expect(screen.queryByPlaceholderText('Search…')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', {name: 'show more'}));
        fireEvent.click(screen.getByText('Catalogue'));

        expect(await screen.findByPlaceholderText('Search…')).toBeInTheDocument();
    });

    it('shows the disconnected banner when the selected device reports connected: false', async () => {
        ezbeq.getDevices.mockResolvedValue({
            d1: {name: 'd1', type: 'minidsp', connected: false, masterVolume: -10, mute: false, slots: []}
        });
        render(<App/>);

        expect(await screen.findByText('Device Unreachable')).toBeInTheDocument();
    });
});
