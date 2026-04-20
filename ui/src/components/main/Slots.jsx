import { styled } from '@mui/material/styles';
import React, {useCallback, useEffect, useRef, useState} from "react";
import ezbeq from "../../services/ezbeq";
import {CircularProgress, Grid, IconButton, Paper} from "@mui/material";
import Box from '@mui/material/Box';
import ClearIcon from "@mui/icons-material/Clear";
import Typography from "@mui/material/Typography";
import Gain from "./Gain";

const PREFIX = 'Slots';

const classes = {
    root: `${PREFIX}-root`,
    container: `${PREFIX}-container`,
    fullWidth: `${PREFIX}-fullWidth`
};

const OuterGrid = styled(Grid)((
    {
        theme
    }
) => ({
    [`& .${classes.root}`]: {
        display: 'flex',
        width: '100%',
    },

    [`& .${classes.container}`]: {
        paddingLeft: 4,
        paddingRight: 4
    },

    [`& .${classes.fullWidth}`]: {
        marginRight: 0
    }
}));

const StyledPaper = styled(Paper, {
    shouldForwardProp: (props) => props !== 'slotIsSelected'
})(({ theme, slotIsSelected }) => ({
    margin: `${theme.spacing(0.5)} auto`,
    padding: theme.spacing(0.5),
    flexGrow: 1,
    backgroundColor: slotIsSelected ? theme.palette.action.selected : theme.palette.background.default,
    display: 'flex'
}));

const ContentGrid = styled(Grid)(({ theme }) => ({
    padding: 4,
    paddingLeft: 8,
    '&:last-child': {
        paddingBottom: 4,
    }
}));

const RightIconButton = styled(IconButton)(({ theme }) => ({
    float: 'right'
}));

const getCurrentState = (active, label, slotId) => {
    const match = active.find(a => a.slotId === slotId && a.action === label);
    return match ? match.state : -1;
};

const chunk = (arr, size) => arr.reduce((chunks, el, i) => (i % size ? chunks[chunks.length - 1].push(el) : chunks.push([el])) && chunks, []);

const defaultGain = {
    master_mv: 0.0, master_mute: false, gains: [], mutes: [], output_gains: [], output_mutes: []
};

const Slot = ({selected, slot, onSelect, isPending, onClear}) => {
    const last_author = slot.author ? ` (${slot.author})` : '';
    return (
        <StyledPaper slotIsSelected={selected}>
            <OuterGrid container justifyContent="space-between" alignItems="center">
                <ContentGrid onClick={onSelect} size={{ xs: 8 }} className={`${classes.content}`}>
                    <Typography component="p" variant="body2">{slot.name ? slot.name : slot.id}: {slot.last}{last_author}</Typography>
                </ContentGrid>
                <Grid size={{ xs: 4 }}>
                    <RightIconButton
                        onClick={onClear}
                        disabled={isPending}
                        className={classes.right}
                        size="large">
                        {
                            isPending
                                ? <CircularProgress size={32}/>
                                : <ClearIcon fontSize="large"/>
                        }
                    </RightIconButton>
                </Grid>
            </OuterGrid>
        </StyledPaper>
    );
};

const Slots = ({selectedDevice, selectedSlotId, useWide, setDevice, setUserDriven, setError, setSuccess, uploadPendingSlotId}) => {

    const [pending, setPending] = useState([]);
    const [currentGains, setCurrentGains] = useState(defaultGain);
    const [deviceGains, setDeviceGains] = useState({...defaultGain});
    const prevDeviceNameRef = useRef(null);
    const prevSlotIdRef = useRef(null);

    const applyGainChange = (gains, parent, key, value) => {
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

    // local state only — for smooth slider drag display
    const updateGain = useCallback((parent, key, value) => {
        setCurrentGains(g => applyGainChange(g, parent, key, value));
    }, []);

    // update state AND send only the changed field to device
    const commitGain = useCallback((parent, key, value) => {
        setCurrentGains(g => applyGainChange(g, parent, key, value));
        ezbeq.patchSingle(selectedDevice.name, parent, key, value, selectedSlotId)
            .catch(e => setError(e));
    }, [selectedSlotId, selectedDevice]);

    // sync gains from device state
    useEffect(() => {
        if (selectedDevice) {
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
            setDeviceGains(gain);
            // Only reset the user-facing controls when the device or slot actually changes,
            // not on every WebSocket update (which would fight the user's in-progress changes)
            const deviceChanged = selectedDevice.name !== prevDeviceNameRef.current;
            const slotChanged = selectedSlotId !== prevSlotIdRef.current;
            if (deviceChanged || slotChanged) {
                setCurrentGains(gain);
                prevDeviceNameRef.current = selectedDevice.name;
                prevSlotIdRef.current = selectedSlotId;
            }
        }
    }, [selectedDevice, selectedSlotId]);

    const trackDeviceUpdate = async (action, slotId, valProvider, andThen = null) => {
        setPending(u => [{slotId, action, state: 1}].concat(u));
        try {
            const vals = await valProvider();
            setPending(u => u.filter(p => !(p.slotId === slotId && p.action === action)));
            setDevice(vals);
            if (andThen) {
                andThen();
            }
        } catch (e) {
            setError(e);
            setPending(u => u.map(p => {
                if (p.slotId === slotId && p.action === action) {
                    return {slotId, action, state: 2};
                } else {
                    return p;
                }
            }));
        }
    };

const clearDeviceSlot = (slotId) => {
        trackDeviceUpdate('clear', slotId, () => ezbeq.clearSlot(selectedDevice.name, slotId), () => {
            if (setSuccess) setSuccess('Slot cleared');
        });
    };

    const activateSlot = (slotId) => {
        trackDeviceUpdate('activate', slotId, () => ezbeq.activateSlot(selectedDevice.name, slotId), () => setUserDriven(true));
    };

    const isPending = (slotId) => {
        return getCurrentState(pending, 'clear', slotId) === 1 || getCurrentState(pending, 'activate', slotId) === 1 || uploadPendingSlotId === slotId;
    };

    const rows = chunk(selectedDevice && selectedDevice.hasOwnProperty('slots') ? selectedDevice.slots : [], 2);
    const devices = rows.map((r, i1) =>
        <Grid container key={i1} className={classes.root}>
            {r.map((d, i2) =>
                <Grid key={i2} container size={{ xs: r.length === 1 ? 12 : 6 }} className={classes.container}>
                    <Slot selected={d.id === selectedSlotId}
                          slot={d}
                          onSelect={() => activateSlot(d.id)}
                          onClear={() => clearDeviceSlot(d.id)}
                          isPending={isPending(d.id)}/>
                </Grid>
            )}
        </Grid>
    );

    // Show gain panel whenever device supports it (not gated on slot selection)
    if (selectedDevice && selectedDevice.hasOwnProperty('masterVolume')) {
        const gain = <Gain selectedSlotId={selectedSlotId}
                           deviceGains={deviceGains}
                           gains={currentGains}
                           updateGain={updateGain}
                           commitGain={commitGain}/>;
        if (useWide) {
            return (
                <Box sx={{flexGrow: 1}}>
                    {devices}
                    <Grid container>
                        {gain}
                    </Grid>
                </Box>
            );
        } else {
            return (
                <Box sx={{flexGrow: 1}}>
                    <Grid container direction={'column'}>{devices}</Grid>
                    <Grid container direction={'column'}>{gain}</Grid>
                </Box>
            );
        }
    } else {
        if (useWide) {
            return <Grid container>{devices}</Grid>;
        } else {
            return <Grid container direction={'column'}>{devices}</Grid>;
        }
    }
}

export default Slots;
