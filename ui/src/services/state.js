import ReconnectingSocket from './socket';

// The server resends meta and full device state on every new connection (see register in ezbeq/apis/ws.py), so a
// reconnect resyncs the UI by itself - except for a catalogue that was still streaming when the socket dropped, which
// is requested again since the meta it gets back will have the same version and so won't trigger a fresh load.
class StateService {

    constructor(url, options = {}) {
        this.url = url;
        this.setErr = null;
        this.replaceDevice = null;
        this.loadEntries = null;
        this.setMeta = null;
        // entry count of the latest catalogue, from its meta
        this.catalogueCount = null;
        // a catalogue has been requested and not all of it has arrived yet
        this.catalogueIncomplete = false;
        this.catalogueReceived = 0;
        this.socket = new ReconnectingSocket(url, {
            onOpen: this.handleOpen,
            onMessage: this.handleMessage,
            reportError: msg => this.setErr ? this.setErr(new Error(msg)) : console.error(msg)
        }, options);
    }

    init = (setErr, replaceDevice, setMeta, loadEntries) => {
        this.setErr = setErr;
        this.replaceDevice = replaceDevice;
        this.setMeta = setMeta;
        this.loadEntries = loadEntries;
    }

    handleOpen = () => {
        if (this.catalogueIncomplete) {
            this.requestCatalogue();
        }
    }

    handleMessage = payload => {
        switch (payload.message) {
            case 'DeviceState':
                console.debug(`Replacing Device ${payload.data.name}`);
                this.replaceDevice(payload.data);
                break;
            case 'Error':
                const err = new Error(payload.data);
                if (payload.persistent) {
                    err.persistent = true;
                }
                this.setErr(err);
                break;
            case 'Catalogue':
                if (payload.data) {
                    console.debug(`Updating catalogue to version ${payload.data.version}`);
                    this.catalogueCount = payload.data.count;
                    this.setMeta(payload.data);
                }
                break;
            case 'CatalogueEntries':
                if (payload.data) {
                    console.debug(`Received ${payload.data.length} catalogue entries at ${new Date(Date.now()).toISOString()}`);
                    this.catalogueReceived += payload.data.length;
                    this.updateCatalogueProgress();
                    this.loadEntries(Object.assign({}, ...payload.data.map(d => {
                        return {[d.id]: d};
                    })));
                }
                break;
            default:
                console.warn(`Unknown ws message ${JSON.stringify(payload)}`)
        }
    }

    requestCatalogue = () => {
        this.catalogueReceived = 0;
        this.socket.send('load catalogue');
        // an empty catalogue is complete already, the server sends nothing for it
        this.updateCatalogueProgress();
    }

    // without a count there's no way to know it's complete, so it keeps being requested on reconnect
    updateCatalogueProgress = () => {
        if (this.catalogueCount !== null && this.catalogueCount !== undefined
            && this.catalogueReceived >= this.catalogueCount) {
            this.catalogueIncomplete = false;
        }
    }

    isConnected = () => this.socket.isConnected();

    // sent once the socket is open if it isn't already
    loadCatalogue = () => {
        this.catalogueIncomplete = true;
        if (this.isConnected()) {
            this.requestCatalogue();
        }
    }

    close = () => this.socket.close();
}

export default StateService;
