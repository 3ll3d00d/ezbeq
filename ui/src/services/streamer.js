const NO_DATA_ERROR = new Error("No data in levels update");

const EMPTY_PAYLOAD = [[], [], [], [], [], [], []];

class StreamerService {

    constructor(setErr) {
        this.url = null;
        this.setErr = setErr;
        this.first = 0;
        this.chart = null;
        this.recording = true;
        this.selectedDeviceName = null;
        this.activeDuration = 60;
        this.data = {
            payload: EMPTY_PAYLOAD,
            first: 0
        };
    }

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
                if (this.selectedDeviceName) {
                    this.ws.send(`subscribe levels ${this.selectedDeviceName}`);
                }
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
                        const newVals = payload.hasOwnProperty('input_levels')
                            ? [new Date().getTime() / 1000.0, ...payload.input_levels, ...payload.output_levels]
                            : [payload.ts, ...payload.input, ...payload.output];
                        const d = this.data;
                        if (d.payload[0].length > 0) {
                            d.payload = newVals.map((v, idx) => idx === 0 ? [...d.payload[idx], (v - d.first)] : [...d.payload[idx], v]);
                        } else {
                            d.first = newVals[0];
                            d.payload = newVals.map((v, idx) => idx === 0 ? [v - d.first] : [v]);
                        }
                        this.data = this.trimToDuration(d, this.activeDuration);
                        if (this.chart && this.recording) {
                            this.chart.setData(d.payload);
                        }
                    } else if (this.selectedDeviceName && payload.hasOwnProperty('master')) {
                        // ignore, status update from minidsprs
                    } else {
                        this.setErr(new Error(`Unexpected data ${payload}`));
                    }
                }
            }
        }
    };

    setSelectedDeviceName = (selectedDeviceName) => {
        const previous = this.selectedDeviceName;
        this.selectedDeviceName = selectedDeviceName;
        if (previous !== selectedDeviceName && selectedDeviceName && this.ws && this.ws.readyState === 1) {
            this.ws.send(`subscribe levels ${selectedDeviceName}`);
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
export default StreamerService;
