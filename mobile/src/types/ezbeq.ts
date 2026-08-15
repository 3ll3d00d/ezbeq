// Shapes mirror the backend's JSON responses (see ezbeq/apis/devices.py, ezbeq/apis/ws.py) and
// the web UI's usage of them (ui/src/services/ezbeq.js, ui/src/services/state.js) - kept in one
// place so the REST client, WebSocket client, and DeviceStateContext agree on them.

export type GainValue = { id: string; value: number };
export type MuteValue = { id: string; value: boolean };

export type SlotState = {
  id: string;
  name?: string;
  last?: string;
  author?: string;
  active: boolean;
  gains?: GainValue[];
  mutes?: MuteValue[];
  outputGains?: GainValue[];
  outputMutes?: MuteValue[];
};

export type DeviceState = {
  name: string;
  type: string;
  connected: boolean;
  masterVolume?: number;
  mute?: boolean;
  slots?: SlotState[];
};

export type DeviceCollection = Record<string, DeviceState>;

export type CatalogueEntry = {
  id: number;
  title?: string;
  formattedTitle: string;
  sortTitle?: string;
  altTitle?: string;
  collection?: string;
  author: string;
  year: number;
  audioTypes: string[];
  contentType: string;
  freshness?: string;
  language?: string;
  edition?: string;
  url?: string;
  avsUrl?: string;
  beqcUrl?: string;
  theMovieDB?: string;
  overview?: string;
  images?: string[];
  rating?: string;
  runtime?: number;
  genres?: string[];
  season?: string;
  episodes?: string;
  mvAdjust?: number;
  note?: string;
  warning?: string;
  created_at?: number;
  updated_at?: number;
  [key: string]: unknown;
};

export type CatalogueMeta = {
  version?: string | number;
  loaded?: number;
  count?: number;
  [key: string]: unknown;
};

export type VersionInfo = {
  version?: string;
  branch?: string;
  sha?: string;
  updateAvailable?: boolean;
  latestVersion?: string;
  pythonSupported?: boolean;
  pythonVersion?: string;
  minPythonVersion?: string;
};

// The shape Gain.jsx/gains.js build up locally before PATCHing - snake_case to match the wire
// format ui/src/services/gains.js already uses (kept as-is when gains.ts is ported in a later
// step, so this type is shared rather than redefined).
export type GainsPayload = {
  master_mv?: number | string;
  master_mute?: boolean;
  gains?: GainValue[];
  mutes?: MuteValue[];
  output_gains?: GainValue[];
  output_mutes?: MuteValue[];
};
