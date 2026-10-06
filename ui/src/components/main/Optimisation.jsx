import React from "react";
import {Chip, FormControlLabel, Switch, Tooltip} from "@mui/material";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import TuneIcon from "@mui/icons-material/Tune";
import ezbeq from "../../services/ezbeq";

const REASONS = {
    no_profile: 'No optimised filters are published for this device so the authored coefficients are loaded',
    profile_unavailable: 'The optimised filters for this device have not been downloaded so the authored coefficients are loaded',
    rate_mismatch: 'The configured optimisation profile does not match the sample rate of this device so the authored coefficients are loaded',
    precision_mismatch: 'The configured optimisation profile does not match the coefficient precision of this device so the authored coefficients are loaded'
};

export const describeReason = (optimisation) => {
    if (!optimisation || !optimisation.reason) {
        return null;
    }
    const txt = REASONS[optimisation.reason] || `Optimised filters are not in use (${optimisation.reason})`;
    return optimisation.member ? `${optimisation.member}: ${txt}` : txt;
};

const UnoptimisedChip = ({title}) => (
    <Tooltip title={title}>
        <Chip size="small" color="warning" variant="outlined" icon={<WarningAmberIcon/>} label="Unoptimised"/>
    </Tooltip>
);

/**
 * @return the slot with the given id, if any.
 */
const findSlot = (selectedDevice, slotId) =>
    selectedDevice && selectedDevice.slots ? selectedDevice.slots.find(s => s.id === slotId) : null;

/**
 * @return true if filters loaded into the slot will use optimised coefficients when they're available, slots which
 * don't report the setting are treated as optimising.
 */
export const slotOptimises = (slot) => Boolean(slot) && slot.optimise !== false;

/**
 * Compact control over the use of device optimised coefficients by the selected slot, sits in the master volume row.
 * Only shown for devices which load coefficients (i.e. those which report an optimisation status).
 */
export const OptimisationControl = ({selectedDevice, selectedSlotId, setDevice, setError}) => {
    const [pending, setPending] = React.useState(false);
    const optimisation = selectedDevice ? selectedDevice.optimisation : null;
    if (!optimisation) {
        return null;
    }
    const slot = findSlot(selectedDevice, selectedSlotId);
    const toggle = async (enabled) => {
        setPending(true);
        try {
            setDevice(await ezbeq.setOptimise(selectedDevice.name, slot.id, enabled));
        } catch (e) {
            setError(e);
        } finally {
            setPending(false);
        }
    };
    const reason = describeReason(optimisation);
    const slotName = slot ? `slot ${slot.name ? slot.name : slot.id}` : 'the selected slot';
    const description = reason
        ? reason
        : `Load filters optimised for ${optimisation.label ? optimisation.label : 'this device'} into ${slotName}`;
    // a device which cannot use optimised filters, or no slot selected, shows a disabled toggle
    return (
        <Tooltip title={description}>
            <FormControlLabel
                sx={{ml: 0.5, mr: 0.5, flexShrink: 0, '& .MuiFormControlLabel-label': {fontSize: '0.75rem'}}}
                control={<Switch checked={optimisation.available && slotOptimises(slot)}
                                 disabled={pending || !optimisation.available || !slot}
                                 size="small"
                                 onChange={e => toggle(e.target.checked)}/>}
                label="Optimise"/>
        </Tooltip>
    );
};

/**
 * Shows which coefficients are loaded in a slot, nothing for standard coefficients or when unknown.
 */
export const SlotCoefficientsChip = ({slot}) => {
    if (!slot || !slot.coefficients) {
        return null;
    }
    if (slot.coefficients === 'optimised') {
        return (
            <Tooltip title={`Loaded with coefficients optimised for ${slot.profile}`}>
                <Chip size="small" color="success" variant="outlined" icon={<TuneIcon/>} label="Optimised"/>
            </Tooltip>
        );
    }
    if (slot.coefficients === 'unoptimised') {
        return <UnoptimisedChip title="Loaded with coefficients which are not optimised for this device"/>;
    }
    return null;
};

/**
 * Looks up whether the selected entry has optimised coefficients for the selected device.
 */
export const useEntryOptimisation = (selectedDevice, selectedEntry) => {
    const [result, setResult] = React.useState(null);
    const deviceName = selectedDevice ? selectedDevice.name : null;
    const optimisation = selectedDevice ? selectedDevice.optimisation : null;
    const profile = optimisation ? optimisation.profile : null;
    const reason = optimisation ? optimisation.reason : null;
    const entryId = selectedEntry ? selectedEntry.id : null;
    React.useEffect(() => {
        let cancelled = false;
        setResult(null);
        if (deviceName && entryId && profile) {
            ezbeq.getEntryOptimisation(deviceName, entryId)
                .then(r => {
                    if (!cancelled) setResult(r);
                })
                .catch(() => {
                    if (!cancelled) setResult(null);
                });
        }
        return () => {
            cancelled = true;
        };
    }, [deviceName, entryId, profile, reason]);
    return result;
};

export const OPTIMISED = 'optimised';
export const NOT_OPTIMISED = 'unoptimised';

/**
 * @return true if the selected device can load optimised coefficients, i.e. whether searching by optimisation means
 * anything for this device.
 */
export const isOptimisable = (selectedDevice) => {
    const optimisation = selectedDevice ? selectedDevice.optimisation : null;
    return Boolean(optimisation && optimisation.profile && optimisation.available);
};

/**
 * Loads the ids of the catalogue entries with optimised coefficients for the selected device, only while a search
 * on optimisation is active.
 * @return a Set of entry ids, or null if not searching or not loaded.
 */
export const useOptimisedEntryIds = (selectedDevice, selectedOptimisation, meta, setError) => {
    const [ids, setIds] = React.useState(null);
    const optimisable = isOptimisable(selectedDevice);
    const deviceName = selectedDevice ? selectedDevice.name : null;
    const profile = optimisable ? selectedDevice.optimisation.profile : null;
    const active = Boolean(selectedOptimisation) && optimisable;
    React.useEffect(() => {
        let cancelled = false;
        setIds(null);
        if (active && deviceName) {
            ezbeq.getOptimisedEntries(deviceName)
                .then(r => {
                    if (!cancelled) setIds(new Set(r.ids));
                })
                .catch(e => {
                    if (!cancelled && setError) setError(e);
                });
        }
        return () => {
            cancelled = true;
        };
        // meta changes when the catalogue is reloaded, which changes the entry ids
    }, [active, deviceName, profile, meta, setError]);
    return ids;
};

/**
 * Flags an entry with optimised coefficients for the selected device, and whether they will be used.
 */
export const EntryOptimisationChip = ({entryOptimisation, optimise = true}) => {
    if (!entryOptimisation || !entryOptimisation.optimised) {
        return null;
    }
    if (optimise) {
        return <Chip size="small" color="success" variant="outlined" icon={<TuneIcon/>} label="Optimised for this device"/>;
    }
    return <Chip size="small" color="warning" variant="outlined" icon={<WarningAmberIcon/>} label="Unoptimised"/>;
};
