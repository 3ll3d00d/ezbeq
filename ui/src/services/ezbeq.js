const API_PREFIX = '/api/1';

/**
 * Encapsulates any calls to the ezbeq server.
 */
class EzBeqService {

    getAuthors = () => {
        return this.doGet('authors');
    };

    getYears = () => {
        return this.doGet('years');
    };

    getAudioTypes = () => {
        return this.doGet('audiotypes');
    };

    getContentTypes = () => {
        return this.doGet('contenttypes');
    };

    getMeta = () => {
        return this.doGet('meta');
    }

    getVersion = () => {
        return this.doGet('version');
    }

    doGet = async (payload) => {
        const response = await fetch(`${API_PREFIX}/${payload}`, {
            method: 'GET'
        });
        if (!response.ok) {
            throw new Error(`EzBeq.get${payload} failed, HTTP status ${response.status}`);
        }
        return await response.json();
    }

    appendTo = (url, name, values) => {
        if (values && values.length > 0) {
            const to_append = values.map(v => `${name}=${v}`).join('&');
            return `${url}${url.indexOf('?') === -1 ? '?' : '&'}${to_append}`;
        }
        return url;
    }

    search = async (authors = null, years = null, audioTypes = null) => {
        const searchUrl = this.appendTo(this.appendTo(this.appendTo(`${API_PREFIX}/search`, 'authors', authors), 'years', years), 'audioTypes', audioTypes);
        const response = await fetch(searchUrl, {
            method: 'GET',
        });
        if (!response.ok) {
            throw new Error(`EzBeq.search failed, HTTP status ${response.status}`);
        }
        return await response.json();
    }

    load = async () => {
        return this.search();
    }

    sendFilter = async (id, slot) => {
        const response = await fetch(`${API_PREFIX}/device/${slot}`, {
            method: 'PUT',
            body: JSON.stringify({
                id: id,
                command: 'load'
            }),
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
        });
        if (!response.ok) {
            throw new Error(`EzBeq.sendFilter failed, HTTP status ${response.status}`);
        }
        return await response.json();
    }

    clearSlot = async (slot) => {
        const response = await fetch(`${API_PREFIX}/device/${slot}`, {
            method: 'DELETE'
        });
        if (!response.ok) {
            throw new Error(`EzBeq.clearSlot failed, HTTP status ${response.status}`);
        }
        return await response.json();
    }

    activateSlot = async (slot) => {
        const response = await fetch(`${API_PREFIX}/device/${slot}`, {
            method: 'PUT',
            body: JSON.stringify({
                command: 'activate'
            }),
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
        });
        if (!response.ok) {
            throw new Error(`EzBeq.activateSlot failed, HTTP status ${response.status}`);
        }
        return await response.json();
    }

    resetInputGain = async (slot) => {
        return this.setGains(slot, {
            'inputOne_mv': '0.0',
            'inputTwo_mv': '0.0',
            'inputOne_mute': false,
            'inputTwo_mute': false
        });
    };

    setGains = async (slot, gains) => {
        const payload = [];
        if (gains.master_mv) {
            payload.push({"channel": "master", "value": `${gains.master_mv}`, "command": "gain"});
        }
        payload.push({"channel": "1", "value": `${gains.inputOne_mv}`, "command": "gain"});
        payload.push({"channel": "2", "value": `${gains.inputTwo_mv}`, "command": "gain"});
        if (gains.master_mute) {
            payload.push({"channel": "master", "value": gains.master_mute ? 'on' : 'off', "command": "mute"});
        }
        payload.push({"channel": "1", "value": gains.inputOne_mute ? 'on' : 'off', "command": "mute"});
        payload.push({"channel": "2", "value": gains.inputTwo_mute ? 'on' : 'off', "command": "mute"});

        const response = await fetch(`${API_PREFIX}/device/${slot}`, {
            method: 'PUT',
            body: JSON.stringify(payload),
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
        });
        if (!response.ok) {
            throw new Error(`EzBeq.activateSlot failed, HTTP status ${response.status}`);
        }
        return await response.json();
    };

    loadWithMV = async (slot, gains, id) => {
        await this.sendFilter(id, slot);
        return await this.setGains(slot, gains);
    };

    getDeviceConfig = async () => {
        return this.doGet('devices');
    }
}

export default new EzBeqService();
