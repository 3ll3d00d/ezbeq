import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import {
  describeReason,
  EntryOptimisationChip,
  OptimisationControl,
  SlotCoefficientsChip,
  useEntryOptimisation,
} from './Optimisation';
import type { EzbeqApi } from '../../services/ezbeqApi';
import type { CatalogueEntry, DeviceOptimisation, DeviceState } from '../../types/ezbeq';

const optimisation = (overrides: Partial<DeviceOptimisation> = {}): DeviceOptimisation => ({
  profile: 'float32-96k',
  label: 'float32 @ 96 kHz',
  enabled: true,
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

const entry = { id: 7, formattedTitle: 'Some Movie' } as unknown as CatalogueEntry;

const makeApi = (overrides: Partial<EzbeqApi> = {}) =>
  ({
    setOptimisationEnabled: jest.fn(),
    getEntryOptimisation: jest.fn(),
    ...overrides,
  }) as unknown as EzbeqApi;

describe('describeReason', () => {
  it('is null when optimised filters are in use', () => {
    expect(describeReason(null)).toBeNull();
    expect(describeReason(optimisation())).toBeNull();
  });

  it.each(['disabled', 'no_profile', 'profile_unavailable', 'rate_mismatch', 'precision_mismatch'])(
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
  it('renders nothing for devices which are sent filter parameters', async () => {
    await render(<OptimisationControl api={makeApi()} device={device()} onDeviceUpdate={jest.fn()} onError={jest.fn()} />);
    expect(screen.queryByTestId('optimisation-control')).toBeNull();
  });

  it('shows an enabled switch and no warning when optimised filters are in use', async () => {
    await render(
      <OptimisationControl api={makeApi()} device={device(optimisation())} onDeviceUpdate={jest.fn()} onError={jest.fn()} />
    );
    expect(screen.getByTestId('optimisation-switch').props.value).toBe(true);
    expect(screen.getByText('Use optimised filters (float32 @ 96 kHz)')).toBeTruthy();
    expect(screen.queryByText('Unoptimised')).toBeNull();
  });

  it('warns when switched off', async () => {
    await render(
      <OptimisationControl
        api={makeApi()}
        device={device(optimisation({ enabled: false, reason: 'disabled' }))}
        onDeviceUpdate={jest.fn()}
        onError={jest.fn()}
      />
    );
    expect(screen.getByTestId('optimisation-switch').props.value).toBe(false);
    expect(screen.getByText('Unoptimised')).toBeTruthy();
    expect(screen.getByText(/switched off/)).toBeTruthy();
  });

  it('warns without a switch when the device cannot be optimised', async () => {
    await render(
      <OptimisationControl
        api={makeApi()}
        device={device(optimisation({ profile: null, label: null, available: false, reason: 'no_profile' }))}
        onDeviceUpdate={jest.fn()}
        onError={jest.fn()}
      />
    );
    expect(screen.queryByTestId('optimisation-switch')).toBeNull();
    expect(screen.getByText('Unoptimised')).toBeTruthy();
  });

  it('toggles optimisation and updates the device', async () => {
    const updated = device(optimisation({ enabled: false, reason: 'disabled' }));
    const api = makeApi({ setOptimisationEnabled: jest.fn().mockResolvedValue(updated) });
    const onDeviceUpdate = jest.fn();
    await render(
      <OptimisationControl api={api} device={device(optimisation())} onDeviceUpdate={onDeviceUpdate} onError={jest.fn()} />
    );
    // a Switch is driven by valueChange, it has no press handler
    fireEvent(screen.getByTestId('optimisation-switch'), 'valueChange', false);
    await waitFor(() => expect(onDeviceUpdate).toHaveBeenCalledWith(updated));
    expect(api.setOptimisationEnabled).toHaveBeenCalledWith('d1', false);
  });

  it('reports a failed toggle', async () => {
    const err = new Error('boom');
    const api = makeApi({ setOptimisationEnabled: jest.fn().mockRejectedValue(err) });
    const onError = jest.fn();
    await render(
      <OptimisationControl api={api} device={device(optimisation())} onDeviceUpdate={jest.fn()} onError={onError} />
    );
    fireEvent(screen.getByTestId('optimisation-switch'), 'valueChange', false);
    await waitFor(() => expect(onError).toHaveBeenCalledWith(err));
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
      <EntryOptimisationChip entryOptimisation={{ applicable: true, optimised: true, inUse: true, profile: 'p' }} />
    );
    expect(screen.getByText('Optimised for this device')).toBeTruthy();
  });

  it('warns when optimised coefficients will not be used', async () => {
    await render(
      <EntryOptimisationChip entryOptimisation={{ applicable: true, optimised: true, inUse: false, profile: 'p' }} />
    );
    expect(screen.getByText('Unoptimised')).toBeTruthy();
  });

  it('shows nothing when the entry has no optimised coefficients', async () => {
    await render(
      <EntryOptimisationChip entryOptimisation={{ applicable: true, optimised: false, inUse: false, profile: 'p' }} />
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
    const api = makeApi({ getEntryOptimisation: jest.fn().mockResolvedValue({ optimised: true, inUse: true }) });
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
    const api = makeApi({ getEntryOptimisation: jest.fn().mockResolvedValue({ optimised: true, inUse: true }) });
    await render(<HookProbe api={api} dev={device(optimisation())} />);
    await waitFor(() => expect(api.getEntryOptimisation).toHaveBeenCalledTimes(1));
    await screen.rerender(<HookProbe api={api} dev={{ ...device(optimisation()), masterVolume: -10 }} />);
    await screen.rerender(<HookProbe api={api} dev={device(optimisation({ enabled: false, reason: 'disabled' }))} />);
    await waitFor(() => expect(api.getEntryOptimisation).toHaveBeenCalledTimes(2));
  });
});
