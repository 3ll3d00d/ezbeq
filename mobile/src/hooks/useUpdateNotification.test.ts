import { act, renderHook } from '@testing-library/react-native';
import { Linking } from 'react-native';

import { isNotificationSupported } from '../services/notifications';
import { addUpdateNotificationTapListener, notifyUpdateAvailableOnce } from '../services/updateNotification';
import { useUpdateNotification } from './useUpdateNotification';

jest.mock('../services/notifications', () => ({ isNotificationSupported: jest.fn().mockReturnValue(true) }));
jest.mock('../services/updateNotification', () => ({
  addUpdateNotificationTapListener: jest.fn().mockReturnValue(jest.fn()),
  notifyUpdateAvailableOnce: jest.fn().mockResolvedValue(true),
}));

const flush = () => act(async () => {});

type Params = Parameters<typeof useUpdateNotification>[0];
const baseParams = (overrides: Partial<Params> = {}): Params => ({
  ready: true,
  enabled: true,
  updateAvailable: true,
  latestVersion: '2.13.5',
  onError: jest.fn(),
  ...overrides,
});

afterEach(() => jest.clearAllMocks());

test('notifies for the latest version when an update is available', async () => {
  await renderHook(() => useUpdateNotification(baseParams()));
  await flush();
  expect(notifyUpdateAvailableOnce).toHaveBeenCalledWith('2.13.5');
  expect(addUpdateNotificationTapListener).toHaveBeenCalled();
});

test.each([
  ['persisted settings have not loaded yet', { ready: false }],
  ['disabled', { enabled: false }],
  ['no update', { updateAvailable: false }],
  ['no version', { latestVersion: undefined }],
])('does not notify when %s', async (_, overrides) => {
  await renderHook(() => useUpdateNotification(baseParams(overrides)));
  await flush();
  expect(notifyUpdateAvailableOnce).not.toHaveBeenCalled();
});

test('is fully inert when notifications are unsupported', async () => {
  (isNotificationSupported as jest.Mock).mockReturnValueOnce(false);
  await renderHook(() => useUpdateNotification(baseParams()));
  await flush();
  expect(notifyUpdateAvailableOnce).not.toHaveBeenCalled();
  expect(addUpdateNotificationTapListener).not.toHaveBeenCalled();
});

test('reports a failure to notify via onError', async () => {
  const err = new Error('boom');
  (notifyUpdateAvailableOnce as jest.Mock).mockRejectedValueOnce(err);
  const params = baseParams();
  await renderHook(() => useUpdateNotification(params));
  await flush();
  expect(params.onError).toHaveBeenCalledWith(err);
});

test('opens the release page on tap, reporting a failure to open via onError', async () => {
  const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValueOnce(true);
  const params = baseParams();
  await renderHook(() => useUpdateNotification(params));
  const onUrl = (addUpdateNotificationTapListener as jest.Mock).mock.calls[0][0];

  onUrl('https://example.com/a');
  expect(openURL).toHaveBeenCalledWith('https://example.com/a');

  const err = new Error('no browser');
  openURL.mockRejectedValueOnce(err);
  onUrl('https://example.com/b');
  await flush();
  expect(params.onError).toHaveBeenCalledWith(err);
  openURL.mockRestore();
});
