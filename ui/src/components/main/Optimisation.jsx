import React from "react";
import {Box, Chip, FormControlLabel, Switch, Tooltip} from "@mui/material";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import TuneIcon from "@mui/icons-material/Tune";
import ezbeq from "../../services/ezbeq";

const REASONS = {
    disabled: 'Device optimised filters are switched off so the authored coefficients are loaded',
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
 * Device level control over the use of device optimised coefficients, only shown for devices which load
 * coefficients (i.e. those which report an optimisation status).
 */
export const OptimisationControl = ({selectedDevice, setDevice, setError}) => {
    const [pending, setPending] = React.useState(false);
    const optimisation = selectedDevice ? selectedDevice.optimisation : null;
    if (!optimisation) {
        return null;
    }
    const toggle = async (enabled) => {
        setPending(true);
        try {
            setDevice(await ezbeq.setOptimisationEnabled(selectedDevice.name, enabled));
        } catch (e) {
            setError(e);
        } finally {
            setPending(false);
        }
    };
    const reason = describeReason(optimisation);
    return (
        <Box sx={{display: 'flex', alignItems: 'center', gap: 1, px: 1, flexWrap: 'wrap'}}>
            {
                optimisation.available
                    ? <FormControlLabel control={<Switch checked={optimisation.enabled}
                                                         disabled={pending}
                                                         size="small"
                                                         onChange={e => toggle(e.target.checked)}/>}
                                        label={optimisation.label ? `Use optimised filters (${optimisation.label})` : 'Use optimised filters'}/>
                    : null
            }
            {reason ? <UnoptimisedChip title={reason}/> : null}
        </Box>
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
    const enabled = optimisation ? optimisation.enabled : null;
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
    }, [deviceName, entryId, enabled, profile, reason]);
    return result;
};

/**
 * Flags an entry with optimised coefficients for the selected device, and whether they will be used.
 */
export const EntryOptimisationChip = ({entryOptimisation}) => {
    if (!entryOptimisation || !entryOptimisation.optimised) {
        return null;
    }
    if (entryOptimisation.inUse) {
        return (
            <Tooltip title={`Coefficients optimised for ${entryOptimisation.profile} will be loaded`}>
                <Chip size="small" color="success" variant="outlined" icon={<TuneIcon/>}
                      label="Optimised for this device"/>
            </Tooltip>
        );
    }
    return <UnoptimisedChip title="Coefficients optimised for this device are available but optimised filters are switched off"/>;
};
