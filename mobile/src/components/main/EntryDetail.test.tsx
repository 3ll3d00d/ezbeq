import { Linking } from 'react-native';
import { render, screen, userEvent, waitFor } from '@testing-library/react-native';

import EntryDetail from './EntryDetail';
import type { EzbeqApi } from '../../services/ezbeqApi';
import type { CatalogueEntry, DeviceState } from '../../types/ezbeq';

jest.spyOn(Linking, 'openURL').mockResolvedValue(true);

const entry = (overrides: Partial<CatalogueEntry> = {}): CatalogueEntry => ({
  id: 1,
  title: 'Some Movie',
  formattedTitle: 'Some Movie (2020)',
  author: 'mkane',
  year: 2020,
  audioTypes: ['Atmos'],
  contentType: 'film',
  ...overrides,
});

const device = (overrides: Partial<DeviceState> = {}): DeviceState => ({
  name: 'd1',
  type: 'minidsp',
  connected: true,
  slots: [{ id: '1', active: true }],
  ...overrides,
});

const noop = () => {};

test('renders nothing when there is no selected entry', async () => {
  const { toJSON } = await render(
    <EntryDetail
      api={{} as EzbeqApi}
      selectedEntry={null}
      selectedDevice={null}
      selectedSlotId={null}
      onDeviceUpdate={noop}
      onError={noop}
      onSuccess={noop}
    />
  );

  expect(toJSON()).toBeNull();
});

test('renders title/year, edition, and extra metadata', async () => {
  await render(
    <EntryDetail
      api={{} as EzbeqApi}
      selectedEntry={entry({ edition: "Director's Cut", rating: 'PG-13', author: 'mkane' })}
      selectedDevice={null}
      selectedSlotId={null}
      onDeviceUpdate={noop}
      onError={noop}
      onSuccess={noop}
    />
  );

  expect(screen.getByText('Some Movie (2020)')).toBeTruthy();
  expect(screen.getByText("Director's Cut")).toBeTruthy();
  expect(screen.getByText(/PG-13/)).toBeTruthy();
  expect(screen.getByText(/mkane/)).toBeTruthy();
});

test('renders a warning and note in the secondary text block', async () => {
  await render(
    <EntryDetail
      api={{} as EzbeqApi}
      selectedEntry={entry({ note: 'Uses a custom crossover', warning: 'Bass heavy' })}
      selectedDevice={null}
      selectedSlotId={null}
      onDeviceUpdate={noop}
      onError={noop}
      onSuccess={noop}
    />
  );

  expect(screen.getByText(/Uses a custom crossover/)).toBeTruthy();
  expect(screen.getByText(/Warning: Bass heavy/)).toBeTruthy();
});

test('renders link buttons only for the URLs present, and pressing one opens it', async () => {
  const user = userEvent.setup();
  await render(
    <EntryDetail
      api={{} as EzbeqApi}
      selectedEntry={entry({ avsUrl: 'https://avsforum.example/thread', theMovieDB: undefined, beqcUrl: undefined })}
      selectedDevice={null}
      selectedSlotId={null}
      onDeviceUpdate={noop}
      onError={noop}
      onSuccess={noop}
    />
  );

  expect(screen.queryByText('TMDb')).toBeNull();
  expect(screen.queryByText('Catalogue')).toBeNull();
  await user.press(screen.getByText('Discuss'));

  expect(Linking.openURL).toHaveBeenCalledWith('https://avsforum.example/thread');
});

test('renders an image per entry.images entry', async () => {
  await render(
    <EntryDetail
      api={{} as EzbeqApi}
      selectedEntry={entry({ images: ['https://example.com/1.jpg', 'https://example.com/2.jpg'] })}
      selectedDevice={null}
      selectedSlotId={null}
      onDeviceUpdate={noop}
      onError={noop}
      onSuccess={noop}
    />
  );

  const images = screen.getAllByTestId(/entry-image-/);
  expect(images).toHaveLength(2);
  expect(images[0].props.source).toEqual({ uri: 'https://example.com/1.jpg' });
  expect(images[1].props.source).toEqual({ uri: 'https://example.com/2.jpg' });
  // resizeMode="contain" (not the Card.Cover default "cover") so images render in full - a
  // "cover" crop was clipping poster art and any title text baked near an image's edge.
  expect(images[0].props.resizeMode).toBe('contain');
});

test('renders no images when entry.images is absent', async () => {
  await render(
    <EntryDetail
      api={{} as EzbeqApi}
      selectedEntry={entry()}
      selectedDevice={null}
      selectedSlotId={null}
      onDeviceUpdate={noop}
      onError={noop}
      onSuccess={noop}
    />
  );

  expect(screen.queryAllByTestId(/entry-image-/)).toHaveLength(0);
});

test('does not show uploader controls when no device is selected', async () => {
  await render(
    <EntryDetail
      api={{} as EzbeqApi}
      selectedEntry={entry()}
      selectedDevice={null}
      selectedSlotId={null}
      onDeviceUpdate={noop}
      onError={noop}
      onSuccess={noop}
    />
  );

  expect(screen.queryByText('Upload')).toBeNull();
});

test('uploading without gains calls sendFilter and reports success', async () => {
  const sendFilter = jest.fn().mockResolvedValue(device());
  const api = { sendFilter } as unknown as EzbeqApi;
  const onDeviceUpdate = jest.fn();
  const onSuccess = jest.fn();
  const user = userEvent.setup();
  await render(
    <EntryDetail
      api={api}
      selectedEntry={entry({ id: 42 })}
      selectedDevice={device()}
      selectedSlotId="1"
      onDeviceUpdate={onDeviceUpdate}
      onError={noop}
      onSuccess={onSuccess}
    />
  );

  await user.press(screen.getByText('Upload'));

  await waitFor(() => expect(sendFilter).toHaveBeenCalledWith('d1', '42', '1'));
  expect(onDeviceUpdate).toHaveBeenCalledWith(device());
  expect(onSuccess).toHaveBeenCalledWith('Filter loaded');
});

test('uploading with "Set Input Gain" checked sends the entry\'s mvAdjust via loadWithMV', async () => {
  const loadWithMV = jest.fn().mockResolvedValue(device());
  const api = { loadWithMV } as unknown as EzbeqApi;
  const gainDevice = device({
    slots: [
      {
        id: '1',
        active: true,
        gains: [{ id: 'g1', value: 0 }],
        mutes: [{ id: 'g1', value: false }],
      },
    ],
  });
  const user = userEvent.setup();
  await render(
    <EntryDetail
      api={api}
      selectedEntry={entry({ id: 42, mvAdjust: -3.5 })}
      selectedDevice={gainDevice}
      selectedSlotId="1"
      onDeviceUpdate={jest.fn()}
      onError={noop}
      onSuccess={jest.fn()}
    />
  );

  await user.press(screen.getByLabelText('Set Input Gain'));
  await user.press(screen.getByText('Upload'));

  await waitFor(() =>
    expect(loadWithMV).toHaveBeenCalledWith('d1', '42', '1', {
      gains: [{ id: 'g1', value: -3.5 }],
      mutes: [{ id: 'g1', value: false }],
    })
  );
});

test('disables "Set Input Gain" when the slot accepts gains but the entry has no MV adjustment', async () => {
  const gainDevice = device({
    slots: [
      {
        id: '1',
        active: true,
        gains: [{ id: 'g1', value: 0 }],
        mutes: [{ id: 'g1', value: false }],
      },
    ],
  });
  await render(
    <EntryDetail
      api={{} as EzbeqApi}
      selectedEntry={entry({ id: 42 })}
      selectedDevice={gainDevice}
      selectedSlotId="1"
      onDeviceUpdate={noop}
      onError={noop}
      onSuccess={noop}
    />
  );

  expect(screen.getByLabelText('Set Input Gain')).toBeDisabled();
});

test('reports an upload failure via onError', async () => {
  const sendFilter = jest.fn().mockRejectedValue(new Error('device offline'));
  const api = { sendFilter } as unknown as EzbeqApi;
  const onError = jest.fn();
  const user = userEvent.setup();
  await render(
    <EntryDetail
      api={api}
      selectedEntry={entry()}
      selectedDevice={device()}
      selectedSlotId="1"
      onDeviceUpdate={jest.fn()}
      onError={onError}
      onSuccess={jest.fn()}
    />
  );

  await user.press(screen.getByText('Upload'));

  await waitFor(() => expect(onError).toHaveBeenCalledWith(new Error('device offline')));
});
