class StateService {

    constructor(url) {
        this.url = url;
        this.ws = new WebSocket(url);
        this.setErr = null;
        this.replaceDevice = null;
        this.setMeta = null;
        this.ws.onerror = e => {
            const msg = `Failed to connect to ${this.url}`;
            if (this.setErr) {
                this.setErr(new Error(msg));
            } else {
                console.error(msg);
            }
        };
        this.ws.onopen = e => {
            console.log(`Connected to ${this.url}`);
        }
        this.ws.onclose = e => {
            console.log(`Closed connection to ${this.url} - ${e.code}`);
        }
        this.ws.onmessage = event => {
            const payload = JSON.parse(event.data);
            switch (payload.message) {
                case 'DeviceState':
                    console.debug(`Replacing Device ${payload.data.name}`);
                    this.replaceDevice(payload.data);
                    break;
                case 'Error':
                    this.setErr(new Error(payload.data));
                    break;
                case 'Catalogue':
                    if (payload.data) {
                        console.debug(`Updating catalogue to version ${payload.data.version}`);
                        this.setMeta(payload.data);
                    }
                    break;
                default:
                    console.warn(`Unknown ws message ${event.data}`)
            }
        };
    }

    init = (setErr, replaceDevice, setMeta) => {
        this.setErr = setErr;
        this.replaceDevice = replaceDevice;
        this.setMeta = setMeta;
    }

    isConnected = () => this.ws.readyState === 1;

    close = () => {
        this.ws.close();
    };
}

export default StateService;
