import { act, renderHook } from '@testing-library/react-native';

import { applyGainChange, mergeGains, useGainSync } from './gains';
import type { EzbeqApi } from './ezbeqApi';
import type { DeviceState, GainsPayload } from '../types/ezbeq';

const sampleGains = (): GainsPayload => ({
  master_mv: -10,
  master_mute: false,
  gains: [
    { id: '1', value: 0 },
    { id: '2', value: 0 },
  ],
  mutes: [
    { id: '1', value: false },
    { id: '2', value: false },
  ],
  output_gains: [{ id: '1', value: 0 }],
  output_mutes: [{ id: '1', value: false }],
});

describe('applyGainChange', () => {
  it('sets master gain', () => {
    expect(applyGainChange(sampleGains(), 'master', 'mv', -15).master_mv).toBe(-15);
  });

  it('sets master mute', () => {
    expect(applyGainChange(sampleGains(), 'master', 'mute', true).master_mute).toBe(true);
  });

  it('sets an input channel gain by id, leaving others untouched', () => {
    const result = applyGainChange(sampleGains(), '2', 'mv', 3.5);
    expect(result.gains).toEqual([
      { id: '1', value: 0 },
      { id: '2', value: 3.5 },
    ]);
  });

  it('sets an input channel mute by id, leaving others untouched', () => {
    const result = applyGainChange(sampleGains(), '1', 'mute', true);
    expect(result.mutes).toEqual([
      { id: '1', value: true },
      { id: '2', value: false },
    ]);
  });

  it('sets an output channel gain using the out_ prefix', () => {
    const result = applyGainChange(sampleGains(), 'out_1', 'mv', -6);
    expect(result.output_gains).toEqual([{ id: '1', value: -6 }]);
  });

  it('sets an output channel mute using the out_ prefix', () => {
    const result = applyGainChange(sampleGains(), 'out_1', 'mute', true);
    expect(result.output_mutes).toEqual([{ id: '1', value: true }]);
  });

  it('does not mutate the input object', () => {
    const original = sampleGains();
    const snapshot = JSON.parse(JSON.stringify(original));
    applyGainChange(original, '1', 'mv', 9);
    expect(original).toEqual(snapshot);
  });

  it('ignores an unknown channel id', () => {
    const result = applyGainChange(sampleGains(), '99', 'mv', 9);
    expect(result.gains).toEqual(sampleGains().gains);
  });
});

describe('mergeGains', () => {
  const gain = (masterMv: number, channelValue: number): GainsPayload => ({
    master_mv: masterMv,
    master_mute: false,
    gains: [{ id: '1', value: channelValue }],
    mutes: [{ id: '1', value: false }],
    output_gains: [],
    output_mutes: [],
  });

  it('adopts a new device value for a field with no local edit', () => {
    const local = gain(-10, 0);
    const prevDevice = gain(-10, 0);
    const newDevice = gain(-5, -3.5);

    const merged = mergeGains(local, prevDevice, newDevice);

    expect(merged.master_mv).toBe(-5);
    expect(merged.gains![0].value).toBe(-3.5);
  });

  it('keeps a local edit that has not yet been confirmed by the device', () => {
    const local = { ...gain(-10, 0), gains: [{ id: '1', value: -8 }] }; // user is typing
    const prevDevice = gain(-10, 0); // baseline recorded before the edit
    const newDevice = gain(-10, 0); // stale poll, still reporting the pre-edit value

    const merged = mergeGains(local, prevDevice, newDevice);

    expect(merged.gains![0].value).toBe(-8);
  });

  it('recognises a committed edit as clean once the device catches up, despite a numeric-string mismatch', () => {
    const local = { ...gain(-10, 0), gains: [{ id: '1', value: -5 }] };
    const prevDevice = { ...gain(-10, 0), gains: [{ id: '1', value: -5 }] };
    const newDevice = gain(-10, 2.5); // a further, genuinely new external change

    const merged = mergeGains(local, prevDevice, newDevice);

    expect(merged.gains![0].value).toBe(2.5);
  });

  it('includes a channel newly reported by the device', () => {
    const local = gain(-10, 0);
    const prevDevice = gain(-10, 0);
    const newDevice = {
      ...gain(-10, 0),
      gains: [
        { id: '1', value: 0 },
        { id: '2', value: 1 },
      ],
    };

    const merged = mergeGains(local, prevDevice, newDevice);

    expect(merged.gains).toEqual([
      { id: '1', value: 0 },
      { id: '2', value: 1 },
    ]);
  });
});

// lodash's debounce reads Date.now() internally to compute its remaining wait, which spins
// forever against jest's fake timers (they don't advance Date in lockstep). Real timers with a
// short wait past the 200ms debounce window are used for the commitGain tests instead.
const waitPastDebounce = () => new Promise((resolve) => setTimeout(resolve, 260));

describe('useGainSync', () => {
  const patchSingle = jest.fn().mockResolvedValue({});
  const api = { patchSingle } as unknown as EzbeqApi;

  beforeEach(() => {
    patchSingle.mockClear();
  });

  const device = (channelGain: number, masterVolume = -20): DeviceState => ({
    name: 'd1',
    type: 'minidsp',
    connected: true,
    masterVolume,
    mute: false,
    slots: [
      {
        id: '1',
        active: true,
        gains: [{ id: '1', value: channelGain }],
        mutes: [{ id: '1', value: false }],
        outputGains: [],
        outputMutes: [],
      },
    ],
  });

  it('adopts device state wholesale on mount, then merges on same device/slot updates', async () => {
    const { result, rerender } = await renderHook(
      ({ d, slot }: { d: DeviceState; slot: string }) => useGainSync(api, d, slot, jest.fn()),
      { initialProps: { d: device(0), slot: '1' } }
    );
    expect(result.current.currentGains.gains![0].value).toBe(0);

    await rerender({ d: device(-3.5), slot: '1' });

    expect(result.current.currentGains.gains![0].value).toBe(-3.5);
  });

  it('does not clobber an in-flight local edit with a stale device update', async () => {
    const { result, rerender } = await renderHook(
      ({ d, slot }: { d: DeviceState; slot: string }) => useGainSync(api, d, slot, jest.fn()),
      { initialProps: { d: device(0), slot: '1' } }
    );

    await act(() => result.current.updateGain('1', 'mv', -5));
    expect(result.current.currentGains.gains![0].value).toBe(-5);

    await rerender({ d: device(0), slot: '1' });

    expect(result.current.currentGains.gains![0].value).toBe(-5);
  });

  it('resets wholesale (not merges) when the selected slot changes', async () => {
    const d = device(0);
    d.slots!.push({
      id: '2',
      active: false,
      gains: [{ id: '1', value: 9 }],
      mutes: [{ id: '1', value: false }],
      outputGains: [],
      outputMutes: [],
    });
    const { result, rerender } = await renderHook(
      ({ slot }: { slot: string }) => useGainSync(api, d, slot, jest.fn()),
      { initialProps: { slot: '1' } }
    );
    await act(() => result.current.updateGain('1', 'mv', -5)); // dirty, uncommitted edit on slot 1

    await rerender({ slot: '2' });

    expect(result.current.currentGains.gains![0].value).toBe(9); // slot 2's own value, not carried over
  });

  it('debounces commitGain and PATCHes only the latest value once', async () => {
    // device must be a stable reference across re-renders (computed once, outside the
    // renderHook callback) - otherwise the sync effect's [selectedDevice] dependency sees a
    // "new" device on every render it itself triggers, looping forever.
    const d = device(0);
    const { result } = await renderHook(() => useGainSync(api, d, '1', jest.fn()));

    await act(() => {
      result.current.commitGain('1', 'mv', -1);
      result.current.commitGain('1', 'mv', -2);
      result.current.commitGain('1', 'mv', -3);
    });
    expect(patchSingle).not.toHaveBeenCalled();

    await waitPastDebounce();

    expect(patchSingle).toHaveBeenCalledTimes(1);
    expect(patchSingle).toHaveBeenCalledWith('d1', '1', 'mv', -3, '1');
  });

  it('debounces independently per field', async () => {
    const d = device(0);
    const { result } = await renderHook(() => useGainSync(api, d, '1', jest.fn()));

    await act(() => {
      result.current.commitGain('1', 'mv', -1);
      result.current.commitGain('master', 'mv', -30);
    });

    await waitPastDebounce();

    expect(patchSingle).toHaveBeenCalledTimes(2);
    expect(patchSingle).toHaveBeenCalledWith('d1', '1', 'mv', -1, '1');
    expect(patchSingle).toHaveBeenCalledWith('d1', 'master', 'mv', -30, '1');
  });

  it('reports patch failures via onError', async () => {
    // constructed lazily inside the mock (rather than Promise.reject(...) up front) so the
    // rejection is only created once commitGain's debounced call attaches .catch to it -
    // otherwise it briefly exists unhandled and Node logs a spurious warning
    patchSingle.mockImplementationOnce(() => Promise.reject(new Error('boom')));
    const d = device(0);
    const onError = jest.fn();
    const { result } = await renderHook(() => useGainSync(api, d, '1', onError));

    await act(() => result.current.commitGain('1', 'mv', -1));

    await waitPastDebounce();

    expect(onError).toHaveBeenCalled();
  });

  it('does nothing when no device is selected', async () => {
    const { result } = await renderHook(() => useGainSync(api, null, null, jest.fn()));

    await act(() => result.current.commitGain('master', 'mv', -5));

    await waitPastDebounce();

    expect(patchSingle).not.toHaveBeenCalled();
  });

  it('does nothing when api is null (brief window before a server is paired)', async () => {
    const d = device(0);
    const { result } = await renderHook(() => useGainSync(null, d, '1', jest.fn()));

    await act(() => result.current.commitGain('1', 'mv', -1));

    await waitPastDebounce();

    expect(patchSingle).not.toHaveBeenCalled();
  });
});
