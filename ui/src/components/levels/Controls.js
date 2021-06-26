import clsx from 'clsx';
import {Button, FormControlLabel, Switch, TextField} from "@material-ui/core";
import {makeStyles} from "@material-ui/core/styles";
import {useEffect, useState} from "react";
import SaveIcon from '@material-ui/icons/Save';

const useStyles = makeStyles((theme) => ({
    root: {
        display: 'flex',
        flexWrap: 'wrap',
    },
    margin: {
        margin: theme.spacing(1),
    },
    textField: {
        width: '10ch',
    },
}));

const Controls = ({
                      duration,
                      setDuration,
                      recording,
                      setRecording,
                      direct,
                      setDirect,
                      showAdvanced,
                      minidspRs,
                      setMinidspRs
                  }) => {
    const classes = useStyles();
    const [minidspRsHost, setMinidspRsHost] = useState(window.location.hostname);
    const [minidspRsDevice, setMinidspRsDevice] = useState(0);
    const [minidspRsPort, setMinidspRsPort] = useState(5380);
    useEffect(() => {
        if (minidspRs) {
            setMinidspRsHost(minidspRs.host);
            setMinidspRsDevice(minidspRs.device);
            setMinidspRsPort(minidspRs.port);
        } else {
            setMinidspRsHost(window.location.hostname);
            setMinidspRsDevice(0);
            setMinidspRsPort(5380)
        }
    }, [minidspRs]);
    return (
        <>
        <form className={clsx(classes.root, classes.margin)} noValidate autoComplete="off">
            <TextField id="duration-seconds"
                       label="Duration"
                       type="number"
                       inputProps={{
                           'aria-label': 'duration',
                           'min': 1,
                           'step': 1,
                           'max': 7200
                       }}
                       value={duration}
                       onChange={e => setDuration(e.target.value)}
                       InputLabelProps={{ shrink: true }}
            />
            <FormControlLabel className={classes.margin}
                              control={<Switch checked={recording}
                                               onChange={e => setRecording(e.target.checked)}
                                               name="recording"
                                               color="primary"/>}
                              label="Recording?"/>
            {
                showAdvanced
                    ?
                    <FormControlLabel className={classes.margin}
                                      control={<Switch checked={direct}
                                                       onChange={e => setDirect(e.target.checked)}
                                                       name="direct"
                                                       color="secondary"
                                                       size="small"/>}
                                      label="Direct"/>
                    : null
            }
        </form>
            {
                showAdvanced
                    ?
                    <form className={clsx(classes.root, classes.margin)} noValidate autoComplete="off">
                        <TextField className={classes.margin}
                                   id="minidsp-rs-ip"
                                   label="minidsprs host or ip"
                                   value={minidspRsHost}
                                   onChange={e => setMinidspRsHost(e.target.value)}
                        />
                        <TextField className={clsx(classes.margin, classes.textField)}
                                   id="minidsp-rs-device_id"
                                   label="device id"
                                   type="number"
                                   min={0}
                                   step={1}
                                   max={10}
                                   value={minidspRsDevice}
                                   onChange={e => setMinidspRsDevice(e.target.value)}
                        />
                        <TextField className={clsx(classes.margin, classes.textField)}
                                   id="minidsp-rs-port"
                                   label="port"
                                   type="number"
                                   min={1}
                                   step={1}
                                   value={minidspRsPort}
                                   onChange={e => setMinidspRsPort(e.target.value)}
                                   InputLabelProps={{ shrink: true }}
                        />
                        <Button variant="contained"
                                color="primary"
                                startIcon={<SaveIcon/>}
                                size={'small'}
                                onClick={() => setMinidspRs({
                                    host: minidspRsHost,
                                    port: minidspRsPort,
                                    device: minidspRsDevice
                                })}>
                            Apply
                        </Button>
                    </form>
                    :
                    null
            }
        </>
    );
};

export default Controls;