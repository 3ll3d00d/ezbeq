import type {
  CatalogueEntry,
  CatalogueMeta,
  DeviceCollection,
  GainsPayload,
  VersionInfo,
} from '../types/ezbeq';

// Ported from ui/src/services/ezbeq.js, keeping method names identical so future diffs against
// the web source stay easy to reason about. The only structural differences: the API prefix is a
// configurable baseUrl (there's no window.location to derive it from on mobile - see
// ServerContext), and every request has a timeout (a flaky LAN host has no implicit "reload the
// tab" recovery on mobile the way a stuck browser fetch does).
const DEFAULT_TIMEOUT_MS = 8000;

const fetchWithTimeout = (
  input: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
};

const jsonHeaders = { 'Content-Type': 'application/json', Accept: 'application/json' };

export class EzbeqApi {
  constructor(private readonly baseUrl: string) {}

  private apiUrl = (path: string, apiVersion = 1) => `${this.baseUrl}/api/${apiVersion}/${path}`;

  getAuthors = (): Promise<string[]> => this.doGet('authors');

  getLanguages = (): Promise<string[]> => this.doGet('languages');

  getYears = (): Promise<string[]> => this.doGet('years');

  getAudioTypes = (): Promise<string[]> => this.doGet('audiotypes');

  getContentTypes = (): Promise<string[]> => this.doGet('contenttypes');

  getMeta = (): Promise<CatalogueMeta> => this.doGet('meta');

  getVersion = (): Promise<VersionInfo> => this.doGet('version');

  doGet = async (payload: string, apiVersion = 1) => {
    const response = await fetchWithTimeout(this.apiUrl(payload, apiVersion));
    if (!response.ok) {
      throw new Error(`EzbeqApi.get${payload} failed, HTTP status ${response.status}`);
    }
    return response.json();
  };

  appendTo = (url: string, name: string, values?: string[] | null): string => {
    if (values && values.length > 0) {
      const toAppend = values.map((v) => `${name}=${v}`).join('&');
      return `${url}${url.indexOf('?') === -1 ? '?' : '&'}${toAppend}`;
    }
    return url;
  };

  search = async (
    authors: string[] | null = null,
    years: string[] | null = null,
    audioTypes: string[] | null = null
  ): Promise<CatalogueEntry[]> => {
    const searchUrl = this.appendTo(
      this.appendTo(this.appendTo(this.apiUrl('search'), 'authors', authors), 'years', years),
      'audioTypes',
      audioTypes
    );
    const response = await fetchWithTimeout(searchUrl);
    if (!response.ok) {
      throw new Error(`EzbeqApi.search failed, HTTP status ${response.status}`);
    }
    return response.json();
  };

  load = async (): Promise<CatalogueEntry[]> => this.search();

  sendFilter = async (device: string, id: string, slot: string, gains: GainsPayload | null = null) => {
    if (gains) {
      return this.doPatch(device, this.createPatchPayload(slot, gains, id));
    }
    const response = await fetchWithTimeout(`${this.baseUrl}/api/1/devices/${device}/filter/${slot}`, {
      method: 'PUT',
      body: JSON.stringify({ entryId: id }),
      headers: jsonHeaders,
    });
    if (!response.ok) {
      throw new Error(`EzbeqApi.sendFilter failed, HTTP status ${response.status}`);
    }
    return response.json();
  };

  sendTextCommands = async (
    device: string,
    slot: string,
    inputs: unknown,
    outputs: unknown,
    commandType: string,
    commands: unknown,
    overwrite: boolean
  ) => {
    const response = await fetchWithTimeout(`${this.baseUrl}/api/1/devices/${device}/commands`, {
      method: 'PUT',
      body: JSON.stringify({ overwrite, slot: `${slot}`, inputs, outputs, commandType, commands }),
      headers: jsonHeaders,
    });
    if (!response.ok) {
      throw new Error(`EzbeqApi.sendTextCommands failed, HTTP status ${response.status}`);
    }
    return response.json();
  };

  clearSlot = async (device: string, slot: string) => {
    const response = await fetchWithTimeout(`${this.baseUrl}/api/1/devices/${device}/filter/${slot}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      throw new Error(`EzbeqApi.clearSlot failed, HTTP status ${response.status}`);
    }
    return response.json();
  };

  activateSlot = async (device: string, slot: string) => {
    const response = await fetchWithTimeout(
      `${this.baseUrl}/api/1/devices/${device}/config/${slot}/active`,
      { method: 'PUT' }
    );
    return this.parseResponse(response);
  };

  private parseResponse = async (response: Response) => {
    if (!response.ok) {
      if (response.status >= 500) {
        const body = await response.json().catch(() => null);
        const message = body && typeof body === 'object' && 'message' in body ? body.message : response.status;
        throw new Error(`EzbeqApi request failed, review ezbeq.log for full details - ${message}`);
      }
      throw new Error(`EzbeqApi request failed, invalid request (${response.status})`);
    }
    return response.json();
  };

  setGains = async (device: string, slot: string, gains: GainsPayload) =>
    this.doPatch(device, this.createPatchPayload(slot, gains));

  // Sends only the single changed field rather than all values.
  patchSingle = async (
    device: string,
    parent: string,
    key: 'mv' | 'mute',
    value: unknown,
    slotId: string
  ) => this.doPatch(device, this.buildTargetedPayload(parent, key, value, slotId));

  buildTargetedPayload = (parent: string, key: 'mv' | 'mute', value: unknown, slotId: string) => {
    if (parent === 'master') {
      if (key === 'mv') return { masterVolume: parseFloat(String(value)) };
      if (key === 'mute') return { mute: Boolean(value) };
    }
    const isOutput = parent.startsWith('out_');
    const channelId = isOutput ? parent.slice(4) : parent;
    const slot: Record<string, unknown> = { id: String(slotId) };
    if (key === 'mv') {
      slot[isOutput ? 'outputGains' : 'gains'] = [{ id: String(channelId), value: parseFloat(String(value)) }];
    } else if (key === 'mute') {
      slot[isOutput ? 'outputMutes' : 'mutes'] = [{ id: String(channelId), value: Boolean(value) }];
    }
    return { slots: [slot] };
  };

  doPatch = async (device: string, payload: unknown) => {
    const response = await fetchWithTimeout(`${this.baseUrl}/api/3/devices/${device}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
      headers: jsonHeaders,
    });
    return this.parseResponse(response);
  };

  createPatchPayload = (
    slotId: string | null | undefined,
    gains: GainsPayload,
    entryId: string | null = null
  ) => {
    const payload: Record<string, unknown> = {};
    if (gains.master_mv !== undefined) {
      payload.masterVolume = parseFloat(String(gains.master_mv));
    }
    if (gains.master_mute !== undefined) {
      payload.mute = gains.master_mute;
    }
    const slot: Record<string, unknown> = { id: String(slotId) };
    if (gains.gains) {
      slot.gains = gains.gains.map((g) => ({ id: String(g.id), value: parseFloat(String(g.value)) }));
    }
    if (gains.mutes) {
      slot.mutes = gains.mutes.map((g) => ({ id: String(g.id), value: Boolean(g.value) }));
    }
    if (gains.output_gains && gains.output_gains.length > 0) {
      slot.outputGains = gains.output_gains.map((g) => ({ id: String(g.id), value: parseFloat(String(g.value)) }));
    }
    if (gains.output_mutes && gains.output_mutes.length > 0) {
      slot.outputMutes = gains.output_mutes.map((g) => ({ id: String(g.id), value: Boolean(g.value) }));
    }
    if (slotId !== null && slotId !== undefined) {
      payload.slots = entryId ? [{ ...slot, entry: entryId }] : [slot];
    }
    return payload;
  };

  loadWithMV = async (device: string, id: string, slot: string, gains: GainsPayload) =>
    this.sendFilter(device, id, slot, gains);

  getWhatsNew = (since?: number): Promise<CatalogueEntry[]> => {
    const url = since ? `whats-new?since=${since}` : 'whats-new';
    return this.doGet(url);
  };

  getDevices = async (): Promise<DeviceCollection> => this.doGet('devices', 2);

  getLevels = async (device: string) => this.doGet(`devices/${device}/levels`);
}

export const createEzbeqApi = (baseUrl: string): EzbeqApi => new EzbeqApi(baseUrl);
