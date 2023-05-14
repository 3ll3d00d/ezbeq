import {EMPTY_PAYLOAD} from "./index";

const NO_DATA_ERROR = new Error("No data in levels update");

class StreamerService {

    constructor(url, setErr, selectedDeviceName, direct) {
        console.log(`Initialising StreamerService :: ${url}`)
        this.ws = new WebSocket(url);
        this.first = 0;
        this.chart = null;
        this.recording = true;
        this.activeDuration = 60;
        this.data = {
            payload: EMPTY_PAYLOAD,
            first: 0
        };
        this.ws.onerror = e => {
            setErr(new Error(`Failed to connect to ${url}`));
        };
        this.ws.onopen = e => {
            console.log(`Connected to ${url}`);
            if (!direct) {
                this.ws.send(`subscribe levels ${selectedDeviceName}`);
            }
        }
        this.ws.onclose = e => {
            console.log(`Closed connection to ${url} - ${e.code}`);
        }
        this.ws.onmessage = e => {
            const payload = JSON.parse(e.data)
            if (this.recording && payload) {
                if (Object.keys(payload).length === 0) {
                    setErr(NO_DATA_ERROR);
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
                    if (this.chart) {
                        this.chart.setData(d.payload);
                    }
                } else if (direct && payload.hasOwnProperty('master')) {
                    // ignore, status update from minidsprs
                } else {
                    setErr(new Error(`Unexpected data ${payload}`));
                }
            }
        }
    }

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
        console.log(`Closing streamer`)
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    };
}

export default StreamerService;
