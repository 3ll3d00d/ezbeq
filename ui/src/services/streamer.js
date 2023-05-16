const NO_DATA_ERROR = new Error("No data in levels update");

const EMPTY_PAYLOAD = [[], [], [], [], [], [], []];

class LevelsService {

    constructor(setErr) {
        this.url = null;
        this.setErr = setErr;
        this.first = 0;
        this.chart = null;
        this.recording = true;
        this.devices = [];
        this.activeDevice = null;
        this.activeDuration = 60;
        this.data = {};
    }

    loadDevices = (devices) => {
        devices.forEach(d => {
           if (this.devices.indexOf(d) === -1) {
               this.devices.push(d);
               this.data[d] =  {
                   payload: EMPTY_PAYLOAD,
                   first: 0
               };
               if (this.ws && this.ws.readyState === 1) {
                   this.ws.send(`subscribe levels ${d}`);
               }
           }
        });
    };

    setRecording = (recording) => {
        this.recording = recording;
    };

    setActiveDuration = (activeDuration) => {
        this.activeDuration = activeDuration;
    };

    setChart = (chart) => {
        this.chart = chart;
    };

    setUrl = (url) => {
        if (this.url !== url) {
            this.url = url;
            if (this.close()) {
                this.initWebsocket();
            }
        }
    };

    initWebsocket = () => {
        if (this.ws && this.ws.readyState <= 1) {
            console.warn(`Connection to ${this.url} is already open`);
        } else {
            this.ws = new WebSocket(this.url);
            this.ws.onerror = e => {
                this.setErr(new Error(`Failed to connect to ${this.url}`));
            };
            this.ws.onopen = e => {
                console.log(`Connected to ${this.url}`);
                this.devices.forEach(d => this.ws.send(`subscribe levels ${d}`));
            }
            this.ws.onclose = e => {
                console.log(`Closed connection to ${this.url} - ${e.code}`);
            }
            this.ws.onmessage = e => {
                const payload = JSON.parse(e.data)
                if (payload) {
                    if (Object.keys(payload).length === 0) {
                        this.setErr(NO_DATA_ERROR);
                    } else if (payload.hasOwnProperty('masterVolume')) {
                        // ignore, status update from ezbeq
                    } else if (payload.hasOwnProperty('input_levels') || payload.hasOwnProperty('input')) {
                        if (payload.hasOwnProperty('name')) {
                            const newVals = payload.hasOwnProperty('input_levels')
                                ? [new Date().getTime() / 1000.0, ...payload.input_levels, ...payload.output_levels]
                                : [payload.ts, ...payload.input, ...payload.output];
                            const d = this.data[payload.name];
                            if (d) {
                                if (d.payload[0].length > 0) {
                                    d.payload = newVals.map((v, idx) => idx === 0 ? [...d.payload[idx], (v - d.first)] : [...d.payload[idx], v]);
                                } else {
                                    d.first = newVals[0];
                                    d.payload = newVals.map((v, idx) => idx === 0 ? [v - d.first] : [v]);
                                }
                                this.data[payload.name] = this.trimToDuration(d, this.activeDuration);
                                if (this.chart && this.recording && payload.name === this.activeDevice) {
                                    this.chart.setData(this.data[payload.name].payload);
                                }
                            } else {
                                console.warn(`No cached data for ${payload.name}`);
                            }
                        } else {
                            console.warn('No name in payload');
                            console.warn(payload);
                        }
                    } else if (this.activeDevice && payload.hasOwnProperty('master')) {
                        // ignore, status update from minidsprs
                    } else {
                        this.setErr(new Error(`Unexpected data ${payload}`));
                    }
                }
            }
        }
    };

    setActiveDevice = (name) => {
        if (this.devices.indexOf(name) > -1) {
            this.activeDevice = name;
        } else {
            this.setErr(new Error(`Unknown device ${name}`));
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
        if (this.ws && this.ws.readyState === 1) {
            console.log(`Closing connection to ${this.url}`);
            this.ws.close();
            this.ws = null;
            return true;
        } else {
            console.info('Ignoring close, ws not ready');
            return false;
        }
    };
}

export {
    EMPTY_PAYLOAD
};
export default LevelsService;
