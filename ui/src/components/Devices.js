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

const isInProgress = (active, label, slotId) => {
    return active && active.hasOwnProperty(slotId) && active[slotId].action === label && active[slotId].state === 1;
};

const Action = ({slotId, onClick, label, Icon, active, disabled = false}) => {
    const classes = useStyles();
    return (
        <div>
        {
            isInProgress(active, label, slotId)
            ? <CircularProgress size={24} className={classes.progress}/>
            : <IconButton aria-label={label}
                          onClick={onClick}
                          color="primary"
                          edge={'start'}
                          disabled={disabled}>
                <Icon/>
            </IconButton>
        }
        </div>
    )
}

const Devices = ({selectedEntryId}) => {
    const classes = useStyles();

    const [slots, setSlots] = useState([]);
    const [updating, setUpdating] = useState({});

    useEffect(() => {
        pushData(setSlots, ezbeq.getMinidspConfig);
    }, []);

    const newUpdate = (original, action, slotId, state) => {
        return Object.assign({}, original, {[slotId]: {action, state}});
    };

    const trackDeviceUpdate = async (action, slotId, valProvider) => {
        setUpdating(u => newUpdate(u, action, slotId, 1));
        try {
            const vals = await valProvider();
            setUpdating(u => {
                const {[slotId]: remove, ...newState} = u;
                return newState;
            });
            setSlots(vals);
        } catch (e) {
            console.error(e);
            setUpdating(u => newUpdate(u, action, slotId, 2));
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
    const minidspGridColumns = [
        {
            field: 'id',
            headerName: ' ',
            width: 25,
            valueFormatter: params => `${params.value + 1}${params.getValue('active') ? '*' : ''}`
        },
        {
            field: 'actions',
            headerName: 'Actions',
            width: 120,
            renderCell: params => (
                <>
                    <Action slotId={params.row.id}
                            disabled={selectedEntryId === -1}
                            onClick={() => sendToDevice(selectedEntryId, params.row.id)}
                            label={'send'}
                            Icon={PublishIcon}
                            active={updating}/>
                    <Action slotId={params.row.id}
                            onClick={() => activateSlot(params.row.id)}
                            label={'activate'}
                            Icon={PlayArrowIcon}
                            active={updating}/>
                    <Action slotId={params.row.id}
                            onClick={() => clearDeviceSlot(params.row.id)}
                            label={'clear'}
                            Icon={ClearIcon}
                            active={updating}/>
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

    return (
        <Grid container direction={'column'} className={classes.noLeft}>
            <Grid item style={{height: '190px', width: '100%'}}>
                <DataGrid rows={slots}
                          columns={minidspGridColumns}
                          autoPageSize
                          hideFooter
                          density={'compact'}/>
            </Grid>
        </Grid>

    );
}

export default Devices;