import {CircularProgress, Grid, IconButton} from "@material-ui/core";
import {DataGrid} from "@material-ui/data-grid";
import React, {useEffect, useState} from "react";
import {makeStyles} from "@material-ui/core/styles";
import PublishIcon from '@material-ui/icons/Publish';
import PlayArrowIcon from "@material-ui/icons/PlayArrow";
import ClearIcon from "@material-ui/icons/Clear";
import ezbeq from "../services/ezbeq";
import {pushData} from "../services/util";

const useStyles = makeStyles((theme) => ({
    noLeft: {
        marginLeft: '0px'
    },
    progress: {
        marginTop: '12px',
        marginRight: '12px'
    }
}));

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

const Devices = ({selectedEntryId, useWide}) => {

    const [slots, setSlots] = useState([]);
    const [pending, setPending] = useState([]);
    const [dims, setDims] = useState([25, 120, '190px']);

    useEffect(() => {
        pushData(setSlots, ezbeq.getDeviceConfig);
    }, []);

    useEffect(() => {
        if (slots.length === 1) {
            setDims([75, 90, '80px']);
        }
    }, [slots])

    const trackDeviceUpdate = async (action, slotId, valProvider) => {
        setPending(u => [{slotId, action, state: 1}].concat(u));
        try {
            const vals = await valProvider();
            setPending(u => u.filter(p => !(p.slotId === slotId && p.action === action)));
            setSlots(vals);
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

    const sendToDevice = (entryId, slotId) => {
        trackDeviceUpdate('send', slotId, () => ezbeq.sendFilter(entryId, slotId))
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
    const grid =
        <Grid item style={{height: dims[2], width: '100%'}}>
            <DataGrid rows={slots}
                           columns={deviceGridColumns}
                           autoPageSize
                           hideFooter
                           density={'compact'}/>
        </Grid>;
    return useWide ? grid : <Grid container direction={'column'}>{grid}</Grid>;
}

export default Devices;