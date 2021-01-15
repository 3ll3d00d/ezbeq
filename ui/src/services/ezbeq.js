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
            return `${url}${url.indexOf('?') === -1 ? '?' : '&'}${name}=${values.join(',')}`;
        }
        return url;
    }

    search = async (authors = null, years = null, audioTypes = null) => {
        const searchUrl = this.appendTo(this.appendTo(this.appendTo(`${API_PREFIX}/search`, 'authors', authors), 'years', years), 'audioTypes', audioTypes);
        const response = await fetch(searchUrl, {
            method: 'GET'
        });
        if (!response.ok) {
            throw new Error(`EzBeq.search failed, HTTP status ${response.status}`);
        }
        return await response.json();
    }

    load = async () => {
        return this.search();
    }

    send = async (id, slot) => {
        const response = await fetch(`${API_PREFIX}/minidsp/${id}/${slot}`, {
            method: 'GET'
        });
        if (!response.ok) {
            throw new Error(`EzBeq.send failed, HTTP status ${response.status}`);
        }
        return await response.json();
    }
}

export default new EzBeqService();
