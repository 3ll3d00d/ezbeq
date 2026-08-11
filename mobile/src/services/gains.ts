import { useCallback, useEffect, useRef, useState } from 'react';
import { debounce } from 'lodash';

import type { EzbeqApi } from './ezbeqApi';
import type { DeviceState, GainValue, GainsPayload, MuteValue } from '../types/ezbeq';

// Ported from ui/src/services/gains.js - shared by every component that renders a gain panel
// driven by a device's reported gains, with local edits committed back via debounced PATCHes.
// Kept in one place so a fix applied to one consumer doesn't go unfixed in another.

type GainParent = 'master' | string; // 'master' | input channel id | `out_${channelId}`
type GainKey = 'mv' | 'mute';

export const defaultGain: GainsPayload = {
  master_mv: 0.0,
  master_mute: false,
  gains: [],
  mutes: [],
  output_gains: [],
  output_mutes: [],
};

export const applyGainChange = (
  gains: GainsPayload,
  parent: GainParent,
  key: GainKey,
  value: number | boolean
): GainsPayload => {
  const newGains: GainsPayload = JSON.parse(JSON.stringify(gains));
  const isOutput = parent.startsWith('out_');
  const channelId = isOutput ? parent.slice(4) : parent;
  if (key === 'mv') {
    if (parent === 'master') {
      newGains.master_mv = value as number;
    } else if (isOutput) {
      const m = newGains.output_gains?.find((e) => e.id === channelId);
      if (m) m.value = value as number;
    } else {
      const m = newGains.gains?.find((e) => e.id === parent);
      if (m) m.value = value as number;
    }
  } else if (key === 'mute') {
    if (parent === 'master') {
      newGains.master_mute = value as boolean;
    } else if (isOutput) {
      const m = newGains.output_mutes?.find((e) => e.id === channelId);
      if (m) m.value = value as boolean;
    } else {
      const m = newGains.mutes?.find((e) => e.id === parent);
      if (m) m.value = value as boolean;
    }
  }
  return newGains;
};

// local values from a text field are raw strings ("-5"); device-reported values are numbers
// (-5). Normalize numerically so a round-tripped edit is recognised as clean instead of
// permanently reading as diverged and never syncing again.
const valuesEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  const na = parseFloat(String(a));
  const nb = parseFloat(String(b));
  return !isNaN(na) && !isNaN(nb) && na === nb;
};

// Merges fresh device state into local state, but leaves any field the user has an uncommitted
// local edit for untouched (i.e. it still differs from what the device last reported) so an
// in-progress slider drag isn't clobbered by a poll/push landing mid-gesture.
export const mergeGains = (
  local: GainsPayload,
  prevDevice: GainsPayload,
  newDevice: GainsPayload
): GainsPayload => {
  const mergeVal = (localVal: unknown, prevVal: unknown, newVal: unknown) =>
    valuesEqual(localVal, prevVal) ? newVal : localVal;
  const mergeArray = <T extends GainValue | MuteValue>(
    localArr: T[] | undefined,
    prevArr: T[] | undefined,
    newArr: T[] | undefined
  ): T[] =>
    (newArr || []).map((n) => {
      const l = (localArr || []).find((e) => e.id === n.id);
      const p = (prevArr || []).find((e) => e.id === n.id);
      return l ? ({ id: n.id, value: mergeVal(l.value, p?.value, n.value) } as T) : n;
    });

  return {
    master_mv: mergeVal(local.master_mv, prevDevice.master_mv, newDevice.master_mv) as number,
    master_mute: mergeVal(local.master_mute, prevDevice.master_mute, newDevice.master_mute) as boolean,
    gains: mergeArray(local.gains, prevDevice.gains, newDevice.gains),
    mutes: mergeArray(local.mutes, prevDevice.mutes, newDevice.mutes),
    output_gains: mergeArray(local.output_gains, prevDevice.output_gains, newDevice.output_gains),
    output_mutes: mergeArray(local.output_mutes, prevDevice.output_mutes, newDevice.output_mutes),
  };
};

const deriveDeviceGain = (selectedDevice: DeviceState, selectedSlotId: string | null): GainsPayload => {
  const gain: GainsPayload = { ...defaultGain };
  gain.master_mv = selectedDevice.masterVolume ?? 0.0;
  gain.master_mute = selectedDevice.mute ?? false;
  if (selectedSlotId && selectedDevice.slots) {
    const slot = selectedDevice.slots.find((s) => s.id === selectedSlotId);
    if (slot) {
      gain.gains = slot.gains ?? [];
      gain.mutes = slot.mutes ?? [];
      gain.output_gains = slot.outputGains ?? [];
      gain.output_mutes = slot.outputMutes ?? [];
    }
  }
  return gain;
};

// Drives a gain panel from a device/slot selection: mirrors device-reported gains into local
// state (merging around in-flight local edits, see mergeGains), and commits local edits back to
// the device via a per-field debounced PATCH. `api` is passed in rather than imported as a
// singleton, since the mobile app's EzbeqApi instance is tied to whichever server is paired.
// Accepts null so callers can invoke this hook unconditionally (required by the rules of hooks)
// even during the brief window before a server is paired and EzbeqApi exists.
export const useGainSync = (
  api: EzbeqApi | null,
  selectedDevice: DeviceState | null,
  selectedSlotId: string | null,
  onError: (e: Error) => void
) => {
  const [currentGains, setCurrentGains] = useState<GainsPayload>(defaultGain);
  const [deviceGains, setDeviceGains] = useState<GainsPayload>({ ...defaultGain });
  const prevDeviceNameRef = useRef<string | null>(null);
  const prevSlotIdRef = useRef<string | null>(null);
  const prevDeviceGainsRef = useRef<GainsPayload>(defaultGain);

  const updateGain = useCallback((parent: GainParent, key: GainKey, value: number | boolean) => {
    setCurrentGains((g) => applyGainChange(g, parent, key, value));
  }, []);

  // debounced per-channel so keyboard repeat / rapid edits collapse to one PATCH
  const deviceRef = useRef(selectedDevice);
  const slotIdRef = useRef(selectedSlotId);
  useEffect(() => {
    deviceRef.current = selectedDevice;
    slotIdRef.current = selectedSlotId;
  }, [selectedDevice, selectedSlotId]);

  const debouncedPatchers = useRef(new Map<string, ReturnType<typeof debounce>>());
  useEffect(() => () => debouncedPatchers.current.forEach((fn) => fn.cancel()), []);

  const commitGain = useCallback(
    (parent: GainParent, key: GainKey, value: number | boolean) => {
      setCurrentGains((g) => applyGainChange(g, parent, key, value));
      if (!deviceRef.current || !api) return;
      const mapKey = `${parent}-${key}`;
      let patcher = debouncedPatchers.current.get(mapKey);
      if (!patcher) {
        patcher = debounce((p: GainParent, k: GainKey, v: number | boolean) => {
          api.patchSingle(deviceRef.current!.name, p, k, v, slotIdRef.current!).catch((e) => onError(e));
        }, 200);
        debouncedPatchers.current.set(mapKey, patcher);
      }
      patcher(parent, key, value);
    },
    [api, onError]
  );

  // sync gains from device state
  useEffect(() => {
    if (selectedDevice) {
      const gain = deriveDeviceGain(selectedDevice, selectedSlotId);
      setDeviceGains(gain);
      // Only reset the user-facing controls wholesale when the device or slot actually changes;
      // otherwise merge in fields that aren't mid-edit, so an external change (e.g. uploading a
      // filter with "set input gain") still shows up without fighting an in-progress edit on
      // another field.
      const deviceChanged = selectedDevice.name !== prevDeviceNameRef.current;
      const slotChanged = selectedSlotId !== prevSlotIdRef.current;
      // capture the pre-update baseline now - setCurrentGains's updater runs later, by which
      // time prevDeviceGainsRef.current below would already point at `gain`
      const prevGain = prevDeviceGainsRef.current;
      if (deviceChanged || slotChanged) {
        setCurrentGains(gain);
      } else {
        setCurrentGains((g) => mergeGains(g, prevGain, gain));
      }
      prevDeviceGainsRef.current = gain;
      prevDeviceNameRef.current = selectedDevice.name;
      prevSlotIdRef.current = selectedSlotId;
    }
  }, [selectedDevice, selectedSlotId]);

  return { currentGains, deviceGains, updateGain, commitGain };
};
