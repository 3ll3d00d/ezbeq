import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import LevelsService from './levels';

const theme = {
    palette: {
        primary: {light: '#p'}, secondary: {light: '#s'}, error: {light: '#e'},
        warning: {light: '#w'}, info: {light: '#i'}, success: {light: '#su'}
    }
};

class FakeWebSocket {
    constructor(url) {
        this.url = url;
        this.readyState = 0;
        this.send = vi.fn();
        this.close = vi.fn(() => { this.readyState = 3; });
        FakeWebSocket.lastInstance = this;
    }

    open() {
        this.readyState = 1;
        this.onopen({});
    }

    // a real socket's readyState transitions to CLOSED before onclose fires; simulate that so
    // initWebsocket()'s "already open/connecting" guard behaves as it would for a real close
    triggerClose(code) {
        this.readyState = 3;
        this.onclose({code});
    }

    emitMessage(payload) {
        this.onmessage({data: JSON.stringify(payload)});
    }
}

const newService = (setErr = vi.fn()) => new LevelsService(setErr, 'ws://test', theme);

// loadDevices takes an object keyed by device name (it does its own Object.keys(...)
// internally, matching how Chart.jsx calls it with the raw availableDevices object)
const devicesObj = (...names) => Object.fromEntries(names.map(n => [n, {}]));

describe('ensureSeriesForDevice', () => {
    it('builds a {name: descriptor} object for a device seen for the first time', () => {
        const service = newService();
        service.ensureSeriesForDevice('d1', ['L', 'R']);

        expect(service.seriesByDeviceName.d1.L).toEqual({label: 'L', stroke: '#p', points: {show: false}, scale: 'dB'});
        expect(service.seriesByDeviceName.d1.R).toEqual({label: 'R', stroke: '#s', points: {show: false}, scale: 'dB'});
    });

    it('cycles through the theme colours as series accumulate', () => {
        const service = newService();
        service.ensureSeriesForDevice('d1', ['a', 'b', 'c', 'd', 'e', 'f', 'g']);
        expect(service.seriesByDeviceName.d1.g.stroke).toBe('#p'); // wraps back to colour 0 after 6
    });

    it('adds newly-reported series and removes ones no longer present, for a known device', () => {
        const service = newService();
        service.ensureSeriesForDevice('d1', ['L', 'R']);

        service.ensureSeriesForDevice('d1', ['L', 'C']);

        expect(Object.keys(service.seriesByDeviceName.d1).sort()).toEqual(['C', 'L']);
    });

    it('marks the series dirty whenever the set changes, for both new and existing devices', () => {
        const service = newService();
        service.seriesDirty = false;
        service.ensureSeriesForDevice('d1', ['L']);
        expect(service.seriesDirty).toBe(true);

        service.seriesDirty = false;
        service.ensureSeriesForDevice('d1', ['L', 'R']);
        expect(service.seriesDirty).toBe(true);
    });
});

describe('loadDevices', () => {
    it('registers each new device with empty data/series state', () => {
        const service = newService();
        service.loadDevices(devicesObj('d1', 'd2'));

        expect(service.devices).toEqual(['d1', 'd2']);
        expect(service.dataByDeviceName.d1).toEqual({payload: [], first: 0});
        expect(service.seriesByDeviceName.d1).toEqual([]);
    });

    it('does not re-register or duplicate an already-known device', () => {
        const service = newService();
        service.loadDevices(devicesObj('d1'));
        service.dataByDeviceName.d1.payload = ['already-has-data'];

        service.loadDevices(devicesObj('d1', 'd2'));

        expect(service.devices).toEqual(['d1', 'd2']);
        expect(service.dataByDeviceName.d1.payload).toEqual(['already-has-data']);
    });

    it('subscribes over an already-open socket for a newly loaded device', () => {
        const service = newService();
        service.ws = {readyState: 1, send: vi.fn()};

        service.loadDevices(devicesObj('d1'));

        expect(service.ws.send).toHaveBeenCalledWith('subscribe levels d1');
    });

    it('does not try to subscribe when there is no open socket yet', () => {
        const service = newService();
        expect(() => service.loadDevices(devicesObj('d1'))).not.toThrow();
    });
});

describe('pause / setActiveDuration / setActiveDevice', () => {
    it('sets the paused flag', () => {
        const service = newService();
        service.pause(true);
        expect(service.paused).toBe(true);
    });

    it('sets the active duration', () => {
        const service = newService();
        service.setActiveDuration(120);
        expect(service.activeDuration).toBe(120);
    });

    it('sets the active device when it is known', () => {
        const service = newService();
        service.loadDevices(devicesObj('d1'));
        service.setActiveDevice('d1');
        expect(service.activeDeviceName).toBe('d1');
    });

    it('reports an error and does not set the active device when it is unknown', () => {
        const setErr = vi.fn();
        const service = newService(setErr);
        service.setActiveDevice('unknown');
        expect(service.activeDeviceName).toBeNull();
        expect(setErr).toHaveBeenCalledWith(new Error('Unknown device unknown'));
    });

    it('does nothing when given a falsy device name', () => {
        const setErr = vi.fn();
        const service = newService(setErr);
        service.setActiveDevice(null);
        expect(setErr).not.toHaveBeenCalled();
    });
});

describe('trimToDuration', () => {
    it('leaves the payload untouched when it is already within the duration window', () => {
        const service = newService();
        const data = {first: 0, payload: [[0, 1, 2], [10, 20, 30]]};
        expect(service.trimToDuration(data, 60)).toEqual(data);
    });

    it('trims every series to only the points within duration seconds of the latest one', () => {
        const service = newService();
        const data = {first: 0, payload: [[0, 10, 20, 30, 100], [1, 2, 3, 4, 5]]};
        const trimmed = service.trimToDuration(data, 60);
        // last ts is 100, window is [40, 100] -> only the ts=100 point (idx 4) qualifies
        expect(trimmed.payload).toEqual([[100], [5]]);
        expect(trimmed.first).toBe(0);
    });
});

describe('setChart / ensureAllSeriesAreLoadedToChart', () => {
    const fakeChart = (existingLabels = ['Time']) => ({
        series: existingLabels.map(label => ({label})),
        addSeries: vi.fn(),
        delSeries: vi.fn(),
        setData: vi.fn()
    });

    it('pushes the active device data into a newly attached chart', () => {
        const service = newService();
        service.loadDevices(devicesObj('d1'));
        service.setActiveDevice('d1');
        service.dataByDeviceName.d1.payload = [[1], [2]];
        const chart = fakeChart();

        service.setChart(chart);

        expect(chart.setData).toHaveBeenCalledWith([[1], [2]]);
    });

    it('adds series present in the data but missing from the chart', () => {
        const service = newService();
        service.loadDevices(devicesObj('d1'));
        service.setActiveDevice('d1');
        service.ensureSeriesForDevice('d1', ['L']);
        const chart = fakeChart(['Time']);

        service.setChart(chart);

        expect(chart.addSeries).toHaveBeenCalledWith(service.seriesByDeviceName.d1.L);
    });

    it('does nothing when there is no active device yet', () => {
        const service = newService();
        const chart = fakeChart();
        expect(() => service.setChart(chart)).not.toThrow();
        expect(chart.setData).not.toHaveBeenCalled();
    });
});

describe('WebSocket lifecycle', () => {
    beforeEach(() => {
        vi.stubGlobal('WebSocket', FakeWebSocket);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('resubscribes to every known device and reports connected on open', () => {
        const setConnected = vi.fn();
        const service = newService();
        service.loadDevices(devicesObj('d1', 'd2'));
        service.setConnectedCallback(setConnected);

        service.initWebsocket();
        FakeWebSocket.lastInstance.open();

        expect(setConnected).toHaveBeenCalledWith(true);
        expect(FakeWebSocket.lastInstance.send).toHaveBeenCalledWith('subscribe levels d1');
        expect(FakeWebSocket.lastInstance.send).toHaveBeenCalledWith('subscribe levels d2');
    });

    it('does not open a second socket while one is already connecting/open', () => {
        const service = newService();
        service.initWebsocket();
        const first = FakeWebSocket.lastInstance;

        service.initWebsocket();

        expect(FakeWebSocket.lastInstance).toBe(first);
    });

    it('processes a Levels message into dataByDeviceName and updates the chart when active', () => {
        const service = newService();
        service.loadDevices(devicesObj('d1'));
        service.setActiveDevice('d1');
        const chart = {series: [{label: 'Time'}], addSeries: vi.fn(), delSeries: vi.fn(), setData: vi.fn()};
        service.setChart(chart);
        service.initWebsocket();

        FakeWebSocket.lastInstance.emitMessage({message: 'Levels', data: {name: 'd1', ts: 1000, levels: {L: -10, R: -12}}});

        expect(service.dataByDeviceName.d1.payload).toEqual([[0], [-10], [-12]]);
        expect(chart.setData).toHaveBeenLastCalledWith([[0], [-10], [-12]]);
    });

    it('does not push chart data while paused', () => {
        const service = newService();
        service.loadDevices(devicesObj('d1'));
        service.setActiveDevice('d1');
        const chart = {series: [{label: 'Time'}], addSeries: vi.fn(), delSeries: vi.fn(), setData: vi.fn()};
        service.setChart(chart); // pushes the (empty) initial payload once, ignore that call
        chart.setData.mockClear();
        service.pause(true);
        service.initWebsocket();

        FakeWebSocket.lastInstance.emitMessage({message: 'Levels', data: {name: 'd1', ts: 1000, levels: {L: -10}}});

        expect(chart.setData).not.toHaveBeenCalled();
        expect(service.dataByDeviceName.d1.payload).toEqual([[0], [-10]]); // still tracked, just not rendered
    });

    it('reports an error for an empty Levels payload', () => {
        const setErr = vi.fn();
        const service = newService(setErr);
        service.initWebsocket();

        FakeWebSocket.lastInstance.emitMessage({message: 'Levels', data: {}});

        expect(setErr).toHaveBeenCalledWith(new Error('No data in levels update'));
    });

    it('reports an error for a malformed Levels payload', () => {
        const setErr = vi.fn();
        const service = newService(setErr);
        service.initWebsocket();

        FakeWebSocket.lastInstance.emitMessage({message: 'Levels', data: {unexpected: true}});

        expect(setErr).toHaveBeenCalled();
        expect(setErr.mock.calls[0][0].message).toMatch(/Unexpected data/);
    });

    it('ignores non-Levels messages', () => {
        const setErr = vi.fn();
        const service = newService(setErr);
        service.initWebsocket();

        expect(() => FakeWebSocket.lastInstance.emitMessage({message: 'SomethingElse', data: {}})).not.toThrow();
        expect(setErr).not.toHaveBeenCalled();
    });

    it('reports a connection error via setErr', () => {
        const setErr = vi.fn();
        const service = newService(setErr);
        service.initWebsocket();

        FakeWebSocket.lastInstance.onerror({});

        expect(setErr).toHaveBeenCalledWith(new Error('Failed to connect to ws://test'));
    });

    it('schedules a reconnect with exponential backoff on an unintentional close', () => {
        vi.useFakeTimers();
        const setConnected = vi.fn();
        const service = newService();
        service.setConnectedCallback(setConnected);
        service.initWebsocket();
        const first = FakeWebSocket.lastInstance;

        first.triggerClose(1006);
        expect(setConnected).toHaveBeenCalledWith(false);
        expect(FakeWebSocket.lastInstance).toBe(first); // not yet reconnected

        vi.advanceTimersByTime(1000);
        expect(FakeWebSocket.lastInstance).not.toBe(first); // reconnected after the initial 1s delay
    });

    it('doubles the reconnect delay on repeated closes, capped at the max', () => {
        vi.useFakeTimers();
        const service = newService();
        service.initWebsocket();

        FakeWebSocket.lastInstance.triggerClose(1006); // delay becomes 2000
        expect(service.reconnectDelay).toBe(2000);
        vi.advanceTimersByTime(2000);

        FakeWebSocket.lastInstance.triggerClose(1006); // delay becomes 4000
        expect(service.reconnectDelay).toBe(4000);
    });

    it('does not schedule a reconnect after an intentional close', () => {
        vi.useFakeTimers();
        const service = newService();
        service.initWebsocket();
        FakeWebSocket.lastInstance.readyState = 1;

        service.close();
        const instanceCountBefore = FakeWebSocket.lastInstance;
        vi.advanceTimersByTime(60000);

        expect(FakeWebSocket.lastInstance).toBe(instanceCountBefore);
    });

    it('close() closes an open socket and returns true', () => {
        const service = newService();
        service.initWebsocket();
        FakeWebSocket.lastInstance.readyState = 1;
        const ws = FakeWebSocket.lastInstance;

        expect(service.close()).toBe(true);
        expect(ws.close).toHaveBeenCalled();
        expect(service.ws).toBeNull();
    });

    it('close() is a no-op that returns false when the socket is not open', () => {
        const service = newService();
        expect(service.close()).toBe(false);
    });
});
