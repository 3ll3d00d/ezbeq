import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import {
  describeReason,
  EntryOptimisationChip,
  isOptimisable,
  OptimisationControl,
  type OptimisationSearch,
  SlotCoefficientsChip,
  slotOptimises,
  useEntryOptimisation,
  useOptimisedEntryIds,
} from './Optimisation';
import type { EzbeqApi } from '../../services/ezbeqApi';
import type { CatalogueEntry, DeviceOptimisation, DeviceState } from '../../types/ezbeq';

const optimisation = (overrides: Partial<DeviceOptimisation> = {}): DeviceOptimisation => ({
  profile: 'float32-96k',
  label: 'float32 @ 96 kHz',
  available: true,
  reason: null,
  ...overrides,
});

const device = (opt?: DeviceOptimisation): DeviceState => ({
  name: 'd1',
  type: 'minidsp',
  connected: true,
  slots: [],
  ...(opt ? { optimisation: opt } : {}),
});

// slot 1 optimises, slot 2 does not
const slotted = (opt?: DeviceOptimisation): DeviceState => ({
  ...device(opt),
  slots: [
    { id: '1', active: true, optimise: true },
    { id: '2', active: false, optimise: false },
  ],
});

const entry = { id: 7, formattedTitle: 'Some Movie' } as unknown as CatalogueEntry;

const makeApi = (overrides: Partial<EzbeqApi> = {}) =>
  ({
    setOptimise: jest.fn(),
    getEntryOptimisation: jest.fn(),
    getOptimisedEntries: jest.fn(),
    ...overrides,
  }) as unknown as EzbeqApi;

describe('describeReason', () => {
  it('is null when optimised filters are in use', () => {
    expect(describeReason(null)).toBeNull();
    expect(describeReason(optimisation())).toBeNull();
  });

  it.each(['no_profile', 'profile_unavailable', 'rate_mismatch', 'precision_mismatch'])(
    'describes %s',
    (reason) => {
      expect(describeReason(optimisation({ reason }))).toMatch(/authored coefficients are loaded/);
    }
  );

  it('describes an unknown reason', () => {
    expect(describeReason(optimisation({ reason: 'other' }))).toBe('Optimised filters are not in use (other)');
  });

  it('names the composite member', () => {
    expect(describeReason(optimisation({ reason: 'no_profile', member: 'sub2' }))).toMatch(/^sub2: No optimised/);
  });
});

describe('OptimisationControl', () => {
  const renderControl = (dev: DeviceState, selectedSlotId: string | null, api = makeApi(), onDeviceUpdate = jest.fn(), onError = jest.fn()) =>
    render(
      <OptimisationControl
        api={api}
        device={dev}
        selectedSlotId={selectedSlotId}
        onDeviceUpdate={onDeviceUpdate}
        onError={onError}
      />
    );

  it('renders nothing for devices which are sent filter parameters', async () => {
    await renderControl(device(), '1');
    expect(screen.queryByTestId('optimisation-switch')).toBeNull();
  });

  it('shows a labelled switch for the selected slot', async () => {
    await renderControl(slotted(optimisation()), '1');
    expect(screen.getByText('Optimise')).toBeTruthy();
    expect(screen.getByTestId('optimisation-switch').props.value).toBe(true);
    expect(screen.getByLabelText('Load filters optimised for float32 @ 96 kHz into slot 1')).toBeTruthy();
  });

  it('reflects the setting of the selected slot', async () => {
    await renderControl(slotted(optimisation()), '2');
    expect(screen.getByTestId('optimisation-switch').props.value).toBe(false);
  });

  it('treats a slot which does not report the setting as optimising', async () => {
    await renderControl({ ...device(optimisation()), slots: [{ id: '1', active: true }] }, '1');
    expect(screen.getByTestId('optimisation-switch').props.value).toBe(true);
  });

  it('is disabled when no slot is selected', async () => {
    await renderControl(slotted(optimisation()), null);
    expect(screen.getByTestId('optimisation-switch').props.disabled).toBe(true);
  });

  it('shows a disabled switch explaining why when the device cannot be optimised', async () => {
    await renderControl(slotted(optimisation({ profile: null, label: null, available: false, reason: 'no_profile' })), '1');
    const toggle = screen.getByTestId('optimisation-switch');
    expect(toggle.props.value).toBe(false);
    expect(toggle.props.disabled).toBe(true);
    expect(screen.getByLabelText(/No optimised filters are published/)).toBeTruthy();
  });

  it('toggles optimisation for the selected slot and updates the device', async () => {
    const updated = slotted(optimisation());
    const api = makeApi({ setOptimise: jest.fn().mockResolvedValue(updated) });
    const onDeviceUpdate = jest.fn();
    await renderControl(slotted(optimisation()), '1', api, onDeviceUpdate);
    // a Switch is driven by valueChange, it has no press handler
    await act(async () => {
      fireEvent(screen.getByTestId('optimisation-switch'), 'valueChange', false);
    });
    await waitFor(() => expect(onDeviceUpdate).toHaveBeenCalledWith(updated));
    expect(api.setOptimise).toHaveBeenCalledWith('d1', '1', false);
    await waitFor(() => expect(screen.getByTestId('optimisation-switch').props.disabled).toBeFalsy());
  });

  it('reports a failed toggle', async () => {
    const err = new Error('boom');
    const api = makeApi({ setOptimise: jest.fn().mockRejectedValue(err) });
    const onError = jest.fn();
    await renderControl(slotted(optimisation()), '1', api, jest.fn(), onError);
    await act(async () => {
      fireEvent(screen.getByTestId('optimisation-switch'), 'valueChange', false);
    });
    await waitFor(() => expect(onError).toHaveBeenCalledWith(err));
    await waitFor(() => expect(screen.getByTestId('optimisation-switch').props.disabled).toBeFalsy());
  });
});

describe('slotOptimises', () => {
  it('is false only for a missing slot or one which has optimisation off', () => {
    expect(slotOptimises(null)).toBe(false);
    expect(slotOptimises({ id: '1', active: false, optimise: false })).toBe(false);
    expect(slotOptimises({ id: '1', active: false, optimise: true })).toBe(true);
    expect(slotOptimises({ id: '1', active: false })).toBe(true);
  });
});

describe('SlotCoefficientsChip', () => {
  it('shows optimised slots', async () => {
    await render(<SlotCoefficientsChip slot={{ id: '1', active: false, coefficients: 'optimised', profile: 'p' }} />);
    expect(screen.getByText('Optimised')).toBeTruthy();
  });

  it('warns on unoptimised slots', async () => {
    await render(<SlotCoefficientsChip slot={{ id: '1', active: false, coefficients: 'unoptimised' }} />);
    expect(screen.getByText('Unoptimised')).toBeTruthy();
  });

  it('shows nothing for standard coefficients', async () => {
    await render(<SlotCoefficientsChip slot={{ id: '1', active: false, coefficients: 'standard' }} />);
    expect(screen.queryByText(/ptimised/)).toBeNull();
  });
});

describe('EntryOptimisationChip', () => {
  it('shows entries optimised for this device', async () => {
    await render(
      <EntryOptimisationChip entryOptimisation={{ applicable: true, optimised: true, profile: 'p' }} />
    );
    expect(screen.getByText('Optimised for this device')).toBeTruthy();
  });

  it('warns when the target slot will not use the optimised coefficients', async () => {
    await render(
      <EntryOptimisationChip entryOptimisation={{ applicable: true, optimised: true, profile: 'p' }} optimise={false} />
    );
    expect(screen.getByText('Unoptimised')).toBeTruthy();
  });

  it('shows nothing when the entry has no optimised coefficients', async () => {
    await render(
      <EntryOptimisationChip entryOptimisation={{ applicable: true, optimised: false, profile: 'p' }} />
    );
    expect(screen.queryByText(/ptimised/)).toBeNull();
  });
});

function HookProbe({ api, dev }: { api: EzbeqApi; dev: DeviceState }) {
  const result = useEntryOptimisation(api, dev, entry);
  return <Text testID="result">{JSON.stringify(result)}</Text>;
}

describe('useEntryOptimisation', () => {
  it('looks up the entry for an optimisable device', async () => {
    const api = makeApi({ getEntryOptimisation: jest.fn().mockResolvedValue({ optimised: true }) });
    await render(<HookProbe api={api} dev={device(optimisation())} />);
    await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('"optimised":true', { exact: false }));
    expect(api.getEntryOptimisation).toHaveBeenCalledWith('d1', '7');
  });

  it('does not look up entries for devices without a profile', async () => {
    const api = makeApi();
    await render(<HookProbe api={api} dev={device(optimisation({ profile: null }))} />);
    expect(api.getEntryOptimisation).not.toHaveBeenCalled();
  });

  it('ignores lookup failures', async () => {
    const api = makeApi({ getEntryOptimisation: jest.fn().mockRejectedValue(new Error('boom')) });
    await render(<HookProbe api={api} dev={device(optimisation())} />);
    await waitFor(() => expect(api.getEntryOptimisation).toHaveBeenCalled());
    expect(screen.getByTestId('result')).toHaveTextContent('null');
  });

  it('does not refetch when unrelated device state changes', async () => {
    const api = makeApi({ getEntryOptimisation: jest.fn().mockResolvedValue({ optimised: true }) });
    await render(<HookProbe api={api} dev={device(optimisation())} />);
    await waitFor(() => expect(api.getEntryOptimisation).toHaveBeenCalledTimes(1));
    await screen.rerender(<HookProbe api={api} dev={{ ...device(optimisation()), masterVolume: -10 }} />);
    await screen.rerender(<HookProbe api={api} dev={device(optimisation({ profile: 'float32-48k' }))} />);
    await waitFor(() => expect(api.getEntryOptimisation).toHaveBeenCalledTimes(2));
  });
});

describe('isOptimisable', () => {
  it('is true only for a device with an available profile', () => {
    expect(isOptimisable(null)).toBe(false);
    expect(isOptimisable(device())).toBe(false);
    expect(isOptimisable(device(optimisation()))).toBe(true);
    expect(isOptimisable(device(optimisation({ available: false, reason: 'profile_unavailable' })))).toBe(false);
  });
});

function IdsProbe({
  api,
  dev,
  search,
  onError = jest.fn(),
}: {
  api: EzbeqApi;
  dev: DeviceState;
  search: OptimisationSearch;
  onError?: (e: Error) => void;
}) {
  const ids = useOptimisedEntryIds(api, dev, search, null, onError);
  return <Text testID="ids">{ids ? [...ids].join(',') : 'none'}</Text>;
}

describe('useOptimisedEntryIds', () => {
  it('loads ids only while searching on optimisation', async () => {
    const api = makeApi({ getOptimisedEntries: jest.fn().mockResolvedValue({ profiles: ['p'], ids: ['e1', 'e2'] }) });
    await render(<IdsProbe api={api} dev={device(optimisation())} search={null} />);
    expect(api.getOptimisedEntries).not.toHaveBeenCalled();
    expect(screen.getByTestId('ids')).toHaveTextContent('none');
    await screen.rerender(<IdsProbe api={api} dev={device(optimisation())} search="optimised" />);
    await waitFor(() => expect(screen.getByTestId('ids')).toHaveTextContent('e1,e2'));
    expect(api.getOptimisedEntries).toHaveBeenCalledWith('d1');
  });

  it('does not load ids for a device which cannot be optimised', async () => {
    const api = makeApi();
    await render(<IdsProbe api={api} dev={device()} search="optimised" />);
    expect(api.getOptimisedEntries).not.toHaveBeenCalled();
  });

  it('reports a failed load', async () => {
    const err = new Error('boom');
    const api = makeApi({ getOptimisedEntries: jest.fn().mockRejectedValue(err) });
    const onError = jest.fn();
    await render(<IdsProbe api={api} dev={device(optimisation())} search="optimised" onError={onError} />);
    await waitFor(() => expect(onError).toHaveBeenCalledWith(err));
    expect(screen.getByTestId('ids')).toHaveTextContent('none');
  });
});
