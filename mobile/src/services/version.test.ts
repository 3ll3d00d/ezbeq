import Constants from 'expo-constants';

import { getAppReleaseVersion, isNewerVersion, isUpdateAvailable } from './version';

jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: {} } } }));

const setExtra = (extra: Record<string, unknown> | undefined) => {
  (Constants as unknown as { expoConfig: unknown }).expoConfig = extra === undefined ? null : { extra };
};

describe('getAppReleaseVersion', () => {
  it('returns the release tag baked in at build time', () => {
    setExtra({ releaseVersion: '2.13.4' });
    expect(getAppReleaseVersion()).toBe('2.13.4');
  });

  it('returns null for untagged builds or a missing config', () => {
    setExtra({ releaseVersion: null });
    expect(getAppReleaseVersion()).toBeNull();
    setExtra({ releaseVersion: '' });
    expect(getAppReleaseVersion()).toBeNull();
    setExtra(undefined);
    expect(getAppReleaseVersion()).toBeNull();
  });
});

describe('isNewerVersion', () => {
  it.each([
    ['2.13.5', '2.13.4', true],
    ['2.14.0', '2.13.9', true],
    ['3.0.0', '2.99.99', true],
    ['v2.13.5', '2.13.4', true],
    ['2.13.4', '2.13.4', false],
    ['2.13.3', '2.13.4', false],
    ['2.12.10', '2.13.0', false],
    ['2.13.4', '2.13.4-rc1', true],
    ['2.13.4-rc1', '2.13.4', false],
    ['2.13.4-rc2', '2.13.4-rc1', true],
    ['2.13.4-rc1', '2.13.4-rc2', false],
    ['2.13.4-rc1', '2.13.4-rc1', false],
    ['2.13.4-rc.10', '2.13.4-rc.9', true],
    ['2.13.4-rc.9', '2.13.4-rc.10', false],
    ['2.13.4-rc.1', '2.13.4-1', true],
    ['2.13.4-1', '2.13.4-rc.1', false],
    ['2.13.4-rc.1.1', '2.13.4-rc.1', true],
    ['2.13.4-rc.1', '2.13.4-rc.1.1', false],
    ['2.13.4-beta', '2.13.4-alpha', true],
  ])('%s newer than %s is %s', (latest, current, expected) => {
    expect(isNewerVersion(latest, current)).toBe(expected);
  });

  it('is false whenever either side is missing or unparseable', () => {
    expect(isNewerVersion(undefined, '2.13.4')).toBe(false);
    expect(isNewerVersion('2.13.5', null)).toBe(false);
    expect(isNewerVersion('garbage', '2.13.4')).toBe(false);
    expect(isNewerVersion('2.13.5', 'garbage')).toBe(false);
  });
});

describe('isUpdateAvailable', () => {
  it('trusts the server when it reports itself out of date', () => {
    expect(isUpdateAvailable({ updateAvailable: true, latestVersion: '2.13.5' }, null)).toBe(true);
  });

  it('flags a stale app even when the server is current', () => {
    expect(isUpdateAvailable({ updateAvailable: false, latestVersion: '2.13.5' }, '2.13.4')).toBe(true);
  });

  it('is false when both are current, or there is no latest version to compare against', () => {
    expect(isUpdateAvailable({ updateAvailable: false, latestVersion: '2.13.5' }, '2.13.5')).toBe(false);
    expect(isUpdateAvailable({ updateAvailable: true }, '2.13.4')).toBe(false);
    expect(isUpdateAvailable({}, '2.13.4')).toBe(false);
  });
});
