import { styled } from '@mui/material/styles';
import React, {useCallback, useEffect, useState} from "react";
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
    master_mv: 0.0, master_mute: false, gains: [], mutes: []
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

const Slots = ({selectedDevice, selectedSlotId, useWide, setDevice, setUserDriven, setError}) => {

    const [pending, setPending] = useState([]);
    const [currentGains, setCurrentGains] = useState(defaultGain);
    const [deviceGains, setDeviceGains] = useState({});

    const updateGain = useCallback((parent, key, value) => {
        const newGains = JSON.parse(JSON.stringify(currentGains));
        let updated = true;
        if (key === 'mv') {
            if (parent === 'master') {
                newGains.master_mv = value;
            } else {
                const match = newGains.gains.find(e => e.id === parent);
                if (match) {
                    match.value = value
                } else {
                    updated = false;
                }
            }
        } else if (key === 'mute') {
            if (parent === 'master') {
                newGains.master_mute = value;
            } else {
                const match = newGains.mutes.find(e => e.id === parent);
                if (match) {
                    match.value = value
                } else {
                    updated = false;
                }
            }
        } else {
            updated = false;
        }
        if (updated) {
            setCurrentGains(newGains);
        } else {
            console.warn(`Ignoring unknown update : ${parent}.${key}=${value}`);
        }
    }, [currentGains, setCurrentGains]);

    // reset gain on slot (de)select or device update
    useEffect(() => {
        if (selectedDevice) {
            const gain = {...defaultGain};
            gain.master_mv = selectedDevice.masterVolume;
            gain.master_mute = selectedDevice.mute;
            if (selectedSlotId && selectedDevice && selectedDevice.hasOwnProperty('slots')) {
                const slot = selectedDevice.slots.find(s => s.id === selectedSlotId);
                gain.gains = slot.hasOwnProperty('gains') ? slot.gains : [];
                gain.mutes = slot.hasOwnProperty('mutes') ? slot.mutes : [];
            }
            setDeviceGains(gain);
            setCurrentGains(gain);
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

    const sendGainToDevice = (slotId, gains) => {
        trackDeviceUpdate('gain', slotId, () => ezbeq.setGains(selectedDevice.name, slotId, gains));
    };

    const clearDeviceSlot = (slotId) => {
        trackDeviceUpdate('clear', slotId, () => ezbeq.clearSlot(selectedDevice.name, slotId));
    };

    const activateSlot = (slotId) => {
        trackDeviceUpdate('activate', slotId, () => ezbeq.activateSlot(selectedDevice.name, slotId), () => setUserDriven(true));
    };

    const isPending = (slotId) => {
        return getCurrentState(pending, 'clear', slotId) === 1 || getCurrentState(pending, 'activate', slotId) === 1;
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

    if (selectedDevice && selectedDevice.hasOwnProperty('masterVolume')) {
        const gain = <Gain selectedSlotId={selectedSlotId}
                           deviceGains={deviceGains}
                           gains={currentGains}
                           updateGain={updateGain}
                           sendGains={sendGainToDevice}
                           isActive={() => getCurrentState(pending, 'gain', selectedSlotId) === 1}/>;
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