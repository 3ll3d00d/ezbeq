import Constants from 'expo-constants';

import type { VersionInfo } from '../types/ezbeq';

// The release tag this app build was cut from (see app.config.ts's extra.releaseVersion), or null
// for a local/dev build - those carry a placeholder `version` that isn't meaningful to compare.
export const getAppReleaseVersion = (): string | null => {
  const v = Constants.expoConfig?.extra?.releaseVersion;
  return typeof v === 'string' && v ? v : null;
};

type Parsed = { nums: [number, number, number]; pre: string };

const parse = (v: string): Parsed | null => {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(.*)$/.exec(v.trim());
  if (!m) return null;
  return { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4].replace(/^[-.+]/, '') };
};

// semver pre-release precedence: dot-separated identifiers compared left to right, numeric ones
// numerically (so rc.10 > rc.9), numeric below alphanumeric, and a longer list wins a shared prefix.
const comparePre = (a: string, b: string): number => {
  const as = a.split('.');
  const bs = b.split('.');
  for (let i = 0; i < Math.min(as.length, bs.length); i++) {
    if (as[i] === bs[i]) continue;
    const an = /^\d+$/.test(as[i]);
    const bn = /^\d+$/.test(bs[i]);
    if (an && bn) return Number(as[i]) - Number(bs[i]);
    if (an !== bn) return an ? -1 : 1;
    return as[i] > bs[i] ? 1 : -1;
  }
  return as.length - bs.length;
};

// True when `latest` is a strictly newer release than `current`. Mirrors the semver ordering
// ezbeq/update.py uses server-side: numeric major.minor.patch, then a pre-release suffix sorts
// before the plain release of the same number. Unparseable input on either side is "not newer"
// so a malformed tag can never raise a spurious update prompt.
export const isNewerVersion = (latest: string | null | undefined, current: string | null | undefined): boolean => {
  if (!latest || !current) return false;
  const l = parse(latest);
  const c = parse(current);
  if (!l || !c) return false;
  for (let i = 0; i < 3; i++) {
    if (l.nums[i] !== c.nums[i]) return l.nums[i] > c.nums[i];
  }
  if (l.pre === c.pre) return false;
  if (!l.pre) return true;
  if (!c.pre) return false;
  return comparePre(l.pre, c.pre) > 0;
};

// An update is available if either the server says it is behind the latest release, or this app
// build is. The server and app ship from the same release, but are installed independently - an
// updated server with a stale app would otherwise never prompt, since the server's own check
// reports itself current.
export const isUpdateAvailable = (versionInfo: VersionInfo, appVersion: string | null): boolean =>
  Boolean(versionInfo.latestVersion) &&
  (Boolean(versionInfo.updateAvailable) || isNewerVersion(versionInfo.latestVersion, appVersion));
