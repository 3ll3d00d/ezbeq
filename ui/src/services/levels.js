import ReconnectingSocket, {connectionErrorCallbacks} from './socket';

const NO_DATA_ERROR = new Error("No data in levels update");

class LevelsService {

    constructor(setErr, url, theme) {
        this.url = url;
        this.setErr = setErr;
        this.first = 0;
        this.chart = null;
        this.paused = false;
        this.devices = [];
        this.seriesByDeviceName = {};
        this.activeDeviceName = null;
        this.activeDuration = 60;
        this.dataByDeviceName = {};
        this.seriesDirty = true;
        this.socket = null;
        this.setConnected = null;
        this.colours = [
            theme.palette.primary.light,
            theme.palette.secondary.light,
            theme.palette.error.light,
            theme.palette.warning.light,
            theme.palette.info.light,
            theme.palette.success.light
        ];
    }

    createSeriesForDevice = (device, label) => {
        return {
            label: label,
            stroke: this.colours[Object.keys(this.seriesByDeviceName[device]).length % this.colours.length],
            points: {show: false},
            scale: 'dB'
        };
    };

    ensureSeriesForDevice = (device, series) => {
        if (this.seriesByDeviceName.hasOwnProperty(device)) {
            const existingSeriesNames = Object.keys(this.seriesByDeviceName[device]);
            const toAdd = series.filter(s => existingSeriesNames.indexOf(s) === -1);
            const toDelete = existingSeriesNames.filter(s => series.indexOf(s) === -1);
            toAdd.forEach(s => {
                this.seriesByDeviceName[device][s] = this.createSeriesForDevice(device, s);
                this.seriesDirty = true;
            });
            toDelete.forEach(s => {
                delete this.seriesByDeviceName[device][s];
                this.seriesDirty = true;
            });
        } else {
            // must build the same {name: descriptor} shape as the branch above (not a raw
            // array of names) - createSeriesForDevice/ensureAllSeriesAreLoadedToChart both
            // index into this by series name and read a .label off each entry
            this.seriesByDeviceName[device] = {};
            series.forEach(s => {
                this.seriesByDeviceName[device][s] = this.createSeriesForDevice(device, s);
            });
            this.seriesDirty = true;
        }
    };

    loadDevices = (devices) => {
        Object.keys(devices).forEach(d => {
            if (this.devices.indexOf(d) === -1) {
                this.devices.push(d);
                this.dataByDeviceName[d] = {
                    payload: [],
                    first: 0
                };
                this.seriesByDeviceName[d] = [];
                if (this.socket && this.socket.isConnected()) {
                    this.socket.send(`subscribe levels ${d}`);
                }
            }
        });
    };

    pause = (paused) => {
        this.paused = paused;
    };

    setActiveDuration = (activeDuration) => {
        this.activeDuration = activeDuration;
    };

    setChart = (chart) => {
        this.chart = chart;
        this.seriesDirty = true;
        if (this.activeDeviceName && this.chart) {
            const series = this.seriesByDeviceName[this.activeDeviceName];
            if (series) {
                this.ensureAllSeriesAreLoadedToChart(this.activeDeviceName);
            }
            const data = this.dataByDeviceName[this.activeDeviceName];
            if (data && data.payload) {
                this.chart.setData(data.payload)
            }
        }
    };

    ensureAllSeriesAreLoadedToChart = (deviceName) => {
        if (this.chart && this.seriesDirty) {
            const series = this.seriesByDeviceName[deviceName];
            const seriesNames = Object.keys(series).map(s => series[s].label);
            const chartNames = this.chart.series.map(s => s.label);
            const toDelete = chartNames.filter(s => s !== 'Time' && seriesNames.indexOf(s) === -1);
            const toAdd = seriesNames.filter(s => chartNames.indexOf(s) === -1);
            toAdd.forEach(name => {
                console.log(`Adding new series ${name}`);
                this.chart.addSeries(this.seriesByDeviceName[deviceName][name]);
            })
            toDelete.forEach(name => {
                console.log(`Deleting series ${name}`);
                this.chart.delSeries(chartNames.indexOf(c => c.label === name));
            })
        }
    };

    setConnectedCallback = (cb) => {
        this.setConnected = cb;
    };

    initWebsocket = () => {
        if (this.socket) {
            console.warn(`Connection to ${this.url} is already open`);
            return;
        }
        this.socket = new ReconnectingSocket(this.url, {
            onOpen: () => this.devices.forEach(d => this.socket.send(`subscribe levels ${d}`)),
            onMessage: this.handleMessage,
            onConnectionChange: connected => {
                if (this.setConnected) this.setConnected(connected);
            },
            ...connectionErrorCallbacks(() => this.setErr)
        });
    };

    handleMessage = (msg) => {
        if (msg.hasOwnProperty('message') && msg.message === 'Levels') {
            const payload = msg.data;
            if (payload) {
                if (Object.keys(payload).length === 0) {
                    this.setErr(NO_DATA_ERROR);
                } else if (payload.hasOwnProperty('levels') && payload.hasOwnProperty('name')) {
                    const deviceName = payload.name;
                    const series = Object.keys(payload.levels);
                    this.ensureSeriesForDevice(deviceName, series);
                    const newVals = [payload.ts, ...series.map(s => payload.levels[s])]
                    if (this.dataByDeviceName.hasOwnProperty(deviceName)) {
                        const d = this.dataByDeviceName[deviceName];
                        // convert to relative timestamps vs the first available
                        if (d.payload && d.payload.length > 0) {
                            d.payload = newVals.map((v, idx) => idx === 0 ? [...d.payload[idx], (v - d.first)] : [...d.payload[idx], v]);
                        } else {
                            d.first = newVals[0];
                            d.payload = newVals.map((v, idx) => idx === 0 ? [v - d.first] : [v]);
                        }
                        this.dataByDeviceName[deviceName] = this.trimToDuration(d, this.activeDuration);
                        if (this.chart && deviceName === this.activeDeviceName) {
                            this.ensureAllSeriesAreLoadedToChart(deviceName);
                            if (!this.paused) {
                                this.chart.setData(this.dataByDeviceName[deviceName].payload);
                            }
                        }
                    } else {
                        console.warn(`No cached data for ${deviceName}`);
                    }
                } else {
                    this.setErr(new Error(`Unexpected data ${payload}`));
                }
            }
        }
    };

    setActiveDevice = (deviceName) => {
        if (deviceName) {
            if (this.devices.indexOf(deviceName) > -1) {
                this.activeDeviceName = deviceName;
            } else {
                this.setErr(new Error(`Unknown device ${deviceName}`));
            }
        }
    };

    trimToDuration = (data, duration) => {
        const time = data.payload[0];
        const firstTs = time[0];
        const lastTs = time[time.length - 1];
        const newFirstTs = lastTs - duration;
        if (newFirstTs > firstTs) {
            const firstIdx = time.findIndex(t => t >= newFirstTs);
            return {first: data.first, payload: data.payload.map(d1 => d1.slice(firstIdx))};
        } else {
            return {first: data.first, payload: data.payload};
        }
    };

    close = () => {
        if (this.socket) {
            console.log(`Closing connection to ${this.url}`);
            this.socket.close();
            this.socket = null;
        }
    };
}

export default LevelsService;
