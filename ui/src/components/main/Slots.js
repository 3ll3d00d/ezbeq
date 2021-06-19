import {makeStyles} from "@material-ui/core/styles";
import React, {useEffect, useState} from "react";
import ezbeq from "../../services/ezbeq";
import {CircularProgress, Grid, IconButton, Paper} from "@material-ui/core";
import ClearIcon from "@material-ui/icons/Clear";
import Typography from "@material-ui/core/Typography";
import Gain from "./Gain";

const useStyles = makeStyles((theme) => ({
    root: {
        display: 'flex',
        width: '100%',
    },
    container: {
        paddingLeft: 4,
        paddingRight: 4
    },
    fullWidth: {
        marginRight: 0
    }
}));

const deviceStyles = makeStyles(theme => ({
    paper: props => ({
        margin: `${theme.spacing(0.5)}px auto`,
        padding: theme.spacing(0.5),
        flexGrow: 1,
        backgroundColor: props.selected ? theme.palette.action.selected : theme.palette.background.default
    }),
    content: () => ({
        padding: 4,
        paddingLeft: 8,
        '&:last-child': {
            paddingBottom: 4,
        },
    }),
    right: {
        float: 'right'
    }
}));

const getCurrentState = (active, label, slotId) => {
    const match = active.find(a => a.slotId === slotId && a.action === label);
    return match ? match.state : -1;
};

const chunk = (arr, size) => arr.reduce((chunks, el, i) => (i % size ? chunks[chunks.length - 1].push(el) : chunks.push([el])) && chunks, []);

const defaultGain = {
    master_mv: 0.0, master_mute: false,
    inputOne_mv: 0.0, inputOne_mute: false,
    inputTwo_mv: 0.0, inputTwo_mute: false
};

const Slot = ({selected, slot, onSelect, isPending, onClear}) => {
    const classes = deviceStyles({selected});
    return (
        <Paper className={`${classes.paper}`}>
            <Grid container justify="space-between" alignItems="center">
                <Grid item onClick={onSelect} xs={8} className={`${classes.content}`}>
                    <Typography component="p" variant="body2">{slot.id}: {slot.last}</Typography>
                </Grid>
                <Grid item xs={4}>
                    <IconButton onClick={onClear} disabled={isPending} className={classes.right}>
                        {
                            isPending
                                ? <CircularProgress size={32}/>
                                : <ClearIcon fontSize="large"/>
                        }
                    </IconButton>
                </Grid>
            </Grid>
        </Paper>
    );
};

const Slots = ({selectedDeviceName, selectedSlotId, useWide, device, setDevice, setUserDriven, setError}) => {
    const classes = useStyles({selected: false});
    const [pending, setPending] = useState([]);
    const [currentGains, setCurrentGains] = useState(defaultGain);
    const [deviceGains, setDeviceGains] = useState({});

    // reset gain on slot (de)select or device update
    useEffect(() => {
        const gain = {...defaultGain};
        gain.master_mv = device.masterVolume;
        gain.master_mute = device.mute;
        if (selectedSlotId && device && device.hasOwnProperty('slots')) {
            const slot = device.slots.find(s => s.id === selectedSlotId);
            if (slot) {
                gain.inputOne_mute = slot.mute1;
                gain.inputTwo_mute = slot.mute2;
                gain.inputOne_mv = slot.gain1;
                gain.inputTwo_mv = slot.gain2;
            }
        }
        setDeviceGains(gain);
        setCurrentGains(gain);
    }, [device, selectedSlotId]);

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
        trackDeviceUpdate('gain', slotId, () => ezbeq.setGains(selectedDeviceName, slotId, gains));
    };

    const clearDeviceSlot = (slotId) => {
        trackDeviceUpdate('clear', slotId, () => ezbeq.clearSlot(selectedDeviceName, slotId));
    };

    const activateSlot = (slotId) => {
        trackDeviceUpdate('activate', slotId, () => ezbeq.activateSlot(selectedDeviceName, slotId), () => setUserDriven(true));
    };

    const isPending = (slotId) => {
        return getCurrentState(pending, 'clear', slotId) === 1 || getCurrentState(pending, 'activate', slotId) === 1;
    };

    const rows = chunk("slots" in device ? device.slots : [], 2);
    const devices = rows.map((r, i1) =>
        <Grid container key={i1} className={classes.root}>
            {r.map((d, i2) =>
                <Grid key={i2} container item xs={r.length === 1 ? 12 : 6} className={classes.container}>
                    <Slot selected={d.id === selectedSlotId}
                            slot={d}
                            onSelect={() => activateSlot(d.id)}
                            onClear={() => clearDeviceSlot(d.id)}
                            isPending={isPending(d.id)}/>
                </Grid>
            )}
        </Grid>
    );

    if (device && device.hasOwnProperty('masterVolume')) {
        const gain = <Gain selectedSlotId={selectedSlotId}
                           deviceGains={deviceGains}
                           gains={currentGains}
                           setGains={setCurrentGains}
                           sendGains={sendGainToDevice}
                           isActive={() => getCurrentState(pending, 'gain', selectedSlotId) === 1}/>;
        if (useWide) {
            return (
                <div className={classes.fullWidth}>
                    {devices}
                    <Grid container>
                        {gain}
                    </Grid>
                </div>
            );
        } else {
            return (
                <div className={classes.fullWidth}>
                    <Grid container direction={'column'}>{devices}</Grid>
                    <Grid container direction={'column'}>{gain}</Grid>
                </div>
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