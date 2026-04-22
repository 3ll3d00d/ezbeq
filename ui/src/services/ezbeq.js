const API_PREFIX = '/api';

/**
 * Encapsulates any calls to the ezbeq server.
 */
class EzBeqService {

    getAuthors = () => {
        return this.doGet('authors');
    };

    getLanguages = () => {
        return this.doGet('languages');
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

    doGet = async (payload, api_version = 1) => {
        const response = await fetch(`${API_PREFIX}/${api_version}/${payload}`, {
            method: 'GET'
        });
        if (!response.ok) {
            throw new Error(`EzBeq.get${payload} failed, HTTP status ${response.status}`);
        }
        return response.json();
    }

    appendTo = (url, name, values) => {
        if (values && values.length > 0) {
            const to_append = values.map(v => `${name}=${v}`).join('&');
            return `${url}${url.indexOf('?') === -1 ? '?' : '&'}${to_append}`;
        }
        return url;
    }

    search = async (authors = null, years = null, audioTypes = null) => {
        const searchUrl = this.appendTo(this.appendTo(this.appendTo(`${API_PREFIX}/1/search`, 'authors', authors), 'years', years), 'audioTypes', audioTypes);
        const response = await fetch(searchUrl, {
            method: 'GET',
        });
        if (!response.ok) {
            throw new Error(`EzBeq.search failed, HTTP status ${response.status}`);
        }
        return response.json();
    }

    load = async () => {
        return this.search();
    }

    sendFilter = async (device, id, slot, gains = null) => {
        if (gains) {
            return await this.doPatch(device, this.createPatchPayload(slot, gains, id));
        } else {
            const response = await fetch(`${API_PREFIX}/1/devices/${device}/filter/${slot}`, {
                method: 'PUT',
                body: JSON.stringify({entryId: id}),
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
            });
            if (!response.ok) {
                throw new Error(`EzBeq.sendFilter failed, HTTP status ${response.status}`);
            }
            return response.json();
        }
    }

    sendTextCommands = async (device, slot, inputs, outputs, commandType, commands, overwrite) => {
        const response = await fetch(`${API_PREFIX}/1/devices/${device}/commands`, {
            method: 'PUT',
            body: JSON.stringify({
                overwrite,
                slot: `${slot}`,
                inputs,
                outputs,
                commandType,
                commands
            }),
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
        });
        if (!response.ok) {
            throw new Error(`EzBeq.sendTextCommands failed, HTTP status ${response.status}`);
        }
        return response.json();
    };

    clearSlot = async (device, slot) => {
        const response = await fetch(`${API_PREFIX}/1/devices/${device}/filter/${slot}`, {
            method: 'DELETE'
        });
        if (!response.ok) {
            throw new Error(`EzBeq.clearSlot failed, HTTP status ${response.status}`);
        }
        return response.json();
    }

    activateSlot = async (device, slot) => {
        const response = await fetch(`${API_PREFIX}/1/devices/${device}/config/${slot}/active`, {
            method: 'PUT'
        });
        return this._parse_resp(response);
    }

    _parse_resp = async (response) => {
        if (!response.ok) {
            if (response.status >= 500) {
                const j = await response.json();
                const txt = j && 'message' in j ? j.message : response.status;
                throw new Error(`EzBeq.activateSlot failed, review ezbeq.log for full details - ${txt}`);
            } else {
                throw new Error(`EzBeq.activateSlot failed, invalid request (${response.status})`);
            }
        }
        return response.json();
    }

    setGains = async (device, slot, gains) => {
        return await this.doPatch(device, this.createPatchPayload(slot, gains));
    };

    // Send only the single changed field rather than all values
    patchSingle = async (device, parent, key, value, slotId) => {
        return await this.doPatch(device, this.buildTargetedPayload(parent, key, value, slotId));
    };

    buildTargetedPayload = (parent, key, value, slotId) => {
        if (parent === 'master') {
            if (key === 'mv') return {masterVolume: parseFloat(value)};
            if (key === 'mute') return {mute: Boolean(value)};
        }
        const isOutput = typeof parent === 'string' && parent.startsWith('out_');
        const channelId = isOutput ? parent.slice(4) : parent;
        const slot = {id: String(slotId)};
        if (key === 'mv') {
            slot[isOutput ? 'outputGains' : 'gains'] = [{id: String(channelId), value: parseFloat(value)}];
        } else if (key === 'mute') {
            slot[isOutput ? 'outputMutes' : 'mutes'] = [{id: String(channelId), value: Boolean(value)}];
        }
        return {slots: [slot]};
    };

    doPatch = async(device, payload) => {
        const response = await fetch(`${API_PREFIX}/3/devices/${device}`, {
            method: 'PATCH',
            body: JSON.stringify(payload),
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
        });
        return this._parse_resp(response);
    }

    createPatchPayload = (slotId, gains, entryId = null) => {
        const payload = {};
        if (gains.hasOwnProperty('master_mv')) {
            payload.masterVolume = parseFloat(gains.master_mv);
        }
        if (gains.hasOwnProperty('master_mute')) {
            payload.mute = gains.master_mute;
        }
        const slot = {
            id: String(slotId)
        }
        if (gains.hasOwnProperty('gains')) {
            slot.gains = gains.gains.map(g => ({id: String(g.id), value: parseFloat(g.value)}));
        }
        if (gains.hasOwnProperty('mutes')) {
            slot.mutes = gains.mutes.map(g => ({id: String(g.id), value: Boolean(g.value)}));
        }
        if (gains.hasOwnProperty('output_gains') && gains.output_gains.length > 0) {
            slot.outputGains = gains.output_gains.map(g => ({id: String(g.id), value: parseFloat(g.value)}));
        }
        if (gains.hasOwnProperty('output_mutes') && gains.output_mutes.length > 0) {
            slot.outputMutes = gains.output_mutes.map(g => ({id: String(g.id), value: Boolean(g.value)}));
        }
        if (slotId !== null && slotId !== undefined) {
            if (entryId) {
                payload.slots = [Object.assign({}, slot, {entry: entryId})]
            } else {
                payload.slots = [slot];
            }
        }
        return payload;
    };

    loadWithMV = async (device, id, slot, gains) => {
        return await this.sendFilter(device, id, slot, gains);
    };

    getWhatsNew = (since) => {
        const url = since ? `whats-new?since=${since}` : 'whats-new';
        return this.doGet(url);
    };

    getDevices = async () => {
        return this.doGet('devices', 2);
    }

    getLevels = async (device) => {
        return this.doGet(`devices/${device}/levels`);
    }
}

const ezBeqService = new EzBeqService();
export default ezBeqService;
