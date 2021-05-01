import {CircularProgress, ClickAwayListener, Grid, IconButton} from "@material-ui/core";
import {DataGrid} from "@material-ui/data-grid";
import React, {useEffect, useState} from "react";
import {makeStyles} from "@material-ui/core/styles";
import PublishIcon from '@material-ui/icons/Publish';
import PlayArrowIcon from "@material-ui/icons/PlayArrow";
import ClearIcon from "@material-ui/icons/Clear";
import ezbeq from "../services/ezbeq";
import Gain from "./Gain";

const useStyles = makeStyles((theme) => ({
    noLeft: {
        marginLeft: '0px'
    },
    progress: {
        marginTop: '12px',
        marginRight: '12px'
    },
    fullWidth: {
        width: '100%'
    }
}));

const defaultGain = {
    master_mv: 0.0, master_mute: false,
    inputOne_mv: 0.0, inputOne_mute: false,
    inputTwo_mv: 0.0, inputTwo_mute: false
};

const getCurrentState = (active, label, slotId) => {
    const match = active.find(a => a.slotId === slotId && a.action === label);
    return match ? match.state : -1;
};

const Action = ({slotId, onClick, label, Icon, active, disabled = false}) => {
    const classes = useStyles();
    const currentState = getCurrentState(active, label, slotId);
    return (
        <div>
            {
                currentState === 1
                    ? <CircularProgress size={24} className={classes.progress}/>
                    : <IconButton aria-label={label}
                                  onClick={onClick}
                                  color={currentState === 2 ? 'error' : 'primary'}
                                  edge={'start'}
                                  disabled={disabled}>
                        <Icon/>
                    </IconButton>
            }
        </div>
    )
}

const Devices = ({selectedEntryId, selectedSlotId, useWide, setSelectedSlotId, device, setDevice}) => {
    const classes = useStyles();

    const [pending, setPending] = useState([]);
    const [dims, setDims] = useState([25, 120, '190px']);
    const [currentGains, setCurrentGains] = useState(defaultGain);
    const [deviceGains, setDeviceGains] = useState({});

    useEffect(() => {
        if ("slots" in device && device.slots.length === 1) {
            setDims([75, 90, '80px']);
        }
    }, [device])

    // reset gain on slot (de)select or device update
    useEffect(() => {
        const gain = {...defaultGain};
        gain.master_mv = device.masterVolume;
        gain.master_mute = device.mute;
        if (selectedSlotId > 0 && device && device.hasOwnProperty('slots')) {
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

    const trackDeviceUpdate = async (action, slotId, valProvider) => {
        setPending(u => [{slotId, action, state: 1}].concat(u));
        try {
            const vals = await valProvider();
            setPending(u => u.filter(p => !(p.slotId === slotId && p.action === action)));
            setDevice(vals);
        } catch (e) {
            console.error(e);
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
        trackDeviceUpdate('gain', slotId, () => ezbeq.setGains(slotId, gains));
    };

    const sendToDevice = (entryId, slotId) => {
        trackDeviceUpdate('send', slotId, () => ezbeq.sendFilter(entryId, slotId));
    };

    const clearDeviceSlot = (slotId) => {
        trackDeviceUpdate('clear', slotId, () => ezbeq.clearSlot(slotId));
    };

    const activateSlot = (slotId) => {
        trackDeviceUpdate('activate', slotId, () => ezbeq.activateSlot(slotId));
    };

    // grid definitions
    const deviceGridColumns = [
        {
            field: 'id',
            headerName: ' ',
            width: dims[0],
            valueFormatter: params => `${params.value}${params.getValue('active') ? '*' : ''}`
        },
        {
            field: 'actions',
            headerName: 'Actions',
            width: dims[1],
            renderCell: params => (
                <>
                    <Action slotId={params.row.id}
                            disabled={selectedEntryId === -1}
                            onClick={() => sendToDevice(selectedEntryId, params.row.id)}
                            label={'send'}
                            Icon={PublishIcon}
                            active={pending}/>
                    {
                        params.row.canActivate
                            ?
                            <Action slotId={params.row.id}
                                    onClick={() => activateSlot(params.row.id)}
                                    label={'activate'}
                                    Icon={PlayArrowIcon}
                                    active={pending}/>
                            : null
                    }
                    <Action slotId={params.row.id}
                            onClick={() => clearDeviceSlot(params.row.id)}
                            label={'clear'}
                            Icon={ClearIcon}
                            active={pending}/>
                </>
            ),
        },
        {
            field: 'last',
            headerName: 'Loaded',
            flex: 0.45,
        },
        {
            field: 'active',
            headerName: 'Active',
            hide: true
        }
    ];
    const devices =
        <Grid item style={{height: dims[2], width: '100%'}}>
            <DataGrid rows={"slots" in device ? device.slots : []}
                      columns={deviceGridColumns}
                      autoPageSize
                      hideFooter
                      density={'compact'}
                      onRowSelected={p => setSelectedSlotId(p.data.id)}/>
        </Grid>;

    if (device && device.hasOwnProperty('masterVolume')) {
        const gain = <Gain selectedSlotId={selectedSlotId}
                           deviceGains={deviceGains}
                           gains={currentGains}
                           setGains={setCurrentGains}
                           sendGains={sendGainToDevice}
                           isActive={() => getCurrentState(pending, 'gain', selectedSlotId) === 1} />;
        if (useWide) {
            return (
                <ClickAwayListener onClickAway={() => setSelectedSlotId(-1)}>
                    <div className={classes.fullWidth}>
                        <Grid container>
                            {devices}
                        </Grid>
                        <Grid container>
                            {gain}
                        </Grid>
                    </div>
                </ClickAwayListener>
            );
        } else {
            return (
                <ClickAwayListener onClickAway={() => setSelectedSlotId(-1)}>
                    <div className={classes.fullWidth}>
                        <Grid container direction={'column'}>{devices}</Grid>
                        <Grid container direction={'column'}>{gain}</Grid>
                    </div>
                </ClickAwayListener>
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

export default Devices;