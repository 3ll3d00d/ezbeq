import { render, screen } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';
import type { ReactElement } from 'react';

import SettingsSheet, { formatAppVersion, formatCatalogueVersion } from './SettingsSheet';
import type { CatalogueMeta, VersionInfo } from '../../types/ezbeq';

const renderSheet = (element: ReactElement) => render(<PaperProvider>{element}</PaperProvider>);

const baseProps = {
  visible: true,
  onClose: jest.fn(),
  serverBaseUrl: 'http://192.168.1.50:9968',
  onDisconnect: jest.fn(),
  filterNotificationEnabled: false,
  filterNotificationSupported: true,
  onToggleFilterNotification: jest.fn(),
};

describe('formatCatalogueVersion', () => {
  it('formats the catalogue timestamp and short sha', () => {
    // 2020-01-02T03:04:05Z
    expect(formatCatalogueVersion({ loaded: 1577934245, version: 'abcdef1234567' })).toBe(
      '20200102_030405 / abcdef1'
    );
  });

  it('shows "?" for the timestamp when meta has no loaded time', () => {
    expect(formatCatalogueVersion({ version: 'abcdef1234567' })).toBe('? / abcdef1');
  });

  it('returns null when there is no meta at all', () => {
    expect(formatCatalogueVersion(null)).toBeNull();
  });
});

describe('formatAppVersion', () => {
  it('shows the app version when known', () => {
    expect(formatAppVersion({ version: '1.2.3' })).toBe('v1.2.3');
  });

  it('falls back to the git ref when the version is UNKNOWN', () => {
    expect(formatAppVersion({ version: 'UNKNOWN', branch: 'main', sha: 'abc1234' })).toBe('git: main@abc1234');
  });

  it('combines version and git ref when both are known', () => {
    expect(formatAppVersion({ version: '1.2.3', branch: 'main', sha: 'abc1234' })).toBe(
      'v1.2.3 git: main@abc1234'
    );
  });

  it('returns null when neither version nor git info is available', () => {
    expect(formatAppVersion({})).toBeNull();
  });
});

describe('SettingsSheet', () => {
  it('shows the About section with app and catalogue version', async () => {
    const versionInfo: VersionInfo = { version: '1.2.3', branch: 'main', sha: 'abc1234' };
    const catalogueMeta: CatalogueMeta = { loaded: 1577934245, version: 'abcdef1234567' };
    await renderSheet(<SettingsSheet {...baseProps} versionInfo={versionInfo} catalogueMeta={catalogueMeta} />);

    expect(screen.getByText('About')).toBeTruthy();
    expect(screen.getByText('App version')).toBeTruthy();
    expect(screen.getByText('v1.2.3 git: main@abc1234')).toBeTruthy();
    expect(screen.getByText('Catalogue version')).toBeTruthy();
    expect(screen.getByText('20200102_030405 / abcdef1')).toBeTruthy();
  });

  it('omits the About section entirely when there is nothing to show', async () => {
    await renderSheet(<SettingsSheet {...baseProps} versionInfo={{}} catalogueMeta={null as unknown as CatalogueMeta} />);

    expect(screen.queryByText('About')).toBeNull();
  });
});
