import {useCallback, useEffect, useRef, useState} from 'react';
import {debounce} from 'lodash/function';
import ezbeq from './ezbeq';

// Shared by Slots.jsx and minidsp/index.jsx - both render a <Gain/> panel driven by a
// device's reported gains, with local edits committed back via debounced PATCHes.
// This used to be copy-pasted into both components, which is how a fix applied to one
// went unfixed in the other; keep it here so there is exactly one place to get it right.

export const defaultGain = {
    master_mv: 0.0, master_mute: false, gains: [], mutes: [], output_gains: [], output_mutes: []
};

export const applyGainChange = (gains, parent, key, value) => {
    const newGains = JSON.parse(JSON.stringify(gains));
    const isOutput = typeof parent === 'string' && parent.startsWith('out_');
    const channelId = isOutput ? parent.slice(4) : parent;
    if (key === 'mv') {
        if (parent === 'master') newGains.master_mv = value;
        else if (isOutput) { const m = newGains.output_gains.find(e => e.id === channelId); if (m) m.value = value; }
        else { const m = newGains.gains.find(e => e.id === parent); if (m) m.value = value; }
    } else if (key === 'mute') {
        if (parent === 'master') newGains.master_mute = value;
        else if (isOutput) { const m = newGains.output_mutes.find(e => e.id === channelId); if (m) m.value = value; }
        else { const m = newGains.mutes.find(e => e.id === parent); if (m) m.value = value; }
    }
    return newGains;
};

// local values from a text field are raw strings ("-5"); device-reported values are
// numbers (-5). Normalize numerically so a round-tripped edit is recognised as clean
// instead of permanently reading as diverged and never syncing again.
const valuesEqual = (a, b) => {
    if (a === b) return true;
    const na = parseFloat(a);
    const nb = parseFloat(b);
    return !isNaN(na) && !isNaN(nb) && na === nb;
};

// merge fresh device state into local state, but leave any field the user has an
// uncommitted local edit for untouched (i.e. it still differs from what the
// device last reported) so in-progress slider drags aren't clobbered by polling
export const mergeGains = (local, prevDevice, newDevice) => {
    const mergeVal = (localVal, prevVal, newVal) => valuesEqual(localVal, prevVal) ? newVal : localVal;
    const mergeArray = (localArr, prevArr, newArr) => (newArr || []).map(n => {
        const l = (localArr || []).find(e => e.id === n.id);
        const p = (prevArr || []).find(e => e.id === n.id);
        return l ? {id: n.id, value: mergeVal(l.value, p?.value, n.value)} : n;
    });
    return {
        master_mv: mergeVal(local.master_mv, prevDevice.master_mv, newDevice.master_mv),
        master_mute: mergeVal(local.master_mute, prevDevice.master_mute, newDevice.master_mute),
        gains: mergeArray(local.gains, prevDevice.gains, newDevice.gains),
        mutes: mergeArray(local.mutes, prevDevice.mutes, newDevice.mutes),
        output_gains: mergeArray(local.output_gains, prevDevice.output_gains, newDevice.output_gains),
        output_mutes: mergeArray(local.output_mutes, prevDevice.output_mutes, newDevice.output_mutes)
    };
};

const deriveDeviceGain = (selectedDevice, selectedSlotId) => {
    const gain = {...defaultGain};
    gain.master_mv = selectedDevice.masterVolume ?? 0.0;
    gain.master_mute = selectedDevice.mute ?? false;
    if (selectedSlotId && selectedDevice.hasOwnProperty('slots')) {
        const slot = selectedDevice.slots.find(s => s.id === selectedSlotId);
        if (slot) {
            gain.gains = slot.hasOwnProperty('gains') ? slot.gains : [];
            gain.mutes = slot.hasOwnProperty('mutes') ? slot.mutes : [];
            gain.output_gains = slot.hasOwnProperty('outputGains') ? slot.outputGains : [];
            gain.output_mutes = slot.hasOwnProperty('outputMutes') ? slot.outputMutes : [];
        }
    }
    return gain;
};

// Drives a <Gain/> panel from a device/slot selection: mirrors device-reported gains into
// local state (merging around in-flight local edits, see mergeGains), and commits local
// edits back to the device via a per-field debounced PATCH.
export const useGainSync = (selectedDevice, selectedSlotId, onError) => {
    const [currentGains, setCurrentGains] = useState(defaultGain);
    const [deviceGains, setDeviceGains] = useState({...defaultGain});
    const prevDeviceNameRef = useRef(null);
    const prevSlotIdRef = useRef(null);
    const prevDeviceGainsRef = useRef(defaultGain);

    const updateGain = useCallback((parent, key, value) => {
        setCurrentGains(g => applyGainChange(g, parent, key, value));
    }, []);

    // debounced per-channel so keyboard repeat / rapid edits collapse to one PATCH
    const deviceRef = useRef(selectedDevice);
    const slotIdRef = useRef(selectedSlotId);
    useEffect(() => {
        deviceRef.current = selectedDevice;
        slotIdRef.current = selectedSlotId;
    }, [selectedDevice, selectedSlotId]);

    const debouncedPatchers = useRef(new Map());
    useEffect(() => () => debouncedPatchers.current.forEach(fn => fn.cancel()), []);

    const commitGain = useCallback((parent, key, value) => {
        setCurrentGains(g => applyGainChange(g, parent, key, value));
        if (!deviceRef.current) return;
        const mapKey = `${parent}-${key}`;
        let patcher = debouncedPatchers.current.get(mapKey);
        if (!patcher) {
            patcher = debounce((p, k, v) => {
                ezbeq.patchSingle(deviceRef.current.name, p, k, v, slotIdRef.current)
                    .catch(e => onError(e));
            }, 200);
            debouncedPatchers.current.set(mapKey, patcher);
        }
        patcher(parent, key, value);
    }, [onError]);

    // sync gains from device state
    useEffect(() => {
        if (selectedDevice) {
            const gain = deriveDeviceGain(selectedDevice, selectedSlotId);
            setDeviceGains(gain);
            // Only reset the user-facing controls wholesale when the device or slot actually
            // changes; otherwise merge in fields that aren't mid-edit, so an external change
            // (e.g. "Set Input Gain" on upload) still shows up without fighting an
            // in-progress slider drag on another field
            const deviceChanged = selectedDevice.name !== prevDeviceNameRef.current;
            const slotChanged = selectedSlotId !== prevSlotIdRef.current;
            // capture the pre-update baseline now - setCurrentGains's updater runs later,
            // by which time prevDeviceGainsRef.current below would already point at `gain`
            const prevGain = prevDeviceGainsRef.current;
            if (deviceChanged || slotChanged) {
                setCurrentGains(gain);
            } else {
                setCurrentGains(g => mergeGains(g, prevGain, gain));
            }
            prevDeviceGainsRef.current = gain;
            prevDeviceNameRef.current = selectedDevice.name;
            prevSlotIdRef.current = selectedSlotId;
        }
    }, [selectedDevice, selectedSlotId]);

    return {currentGains, deviceGains, updateGain, commitGain};
};
