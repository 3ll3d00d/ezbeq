import React from 'react';
import clsx from 'clsx';
import {makeStyles} from '@material-ui/core/styles';
import {
    Button,
    CircularProgress,
    FormControl,
    FormGroup,
    IconButton,
    InputAdornment,
    TextField,
    withStyles
} from "@material-ui/core";
import PublishIcon from '@material-ui/icons/Publish';
import VolumeOffIcon from '@material-ui/icons/VolumeOff';
import VolumeUpIcon from '@material-ui/icons/VolumeUp';

const useStyles = makeStyles((theme) => ({
    padTop: {
        paddingTop: theme.spacing(1),
        width: '100%'
    },
    withoutLabel: {
        marginTop: theme.spacing(1),
    },
    sized: {
        margin: theme.spacing(0.5),
        width: '22.5%'
    },
    zeroPad: {
        padding: 0
    },
    tightPad: {
        paddingRight: 0
    }
}));

const TightTextField = withStyles({
    root: {
        "& .MuiOutlinedInput-adornedEnd": {
            paddingRight: '4px'
        }
    }
})(TextField);

const GainInput = ({fieldName, helpText, minGain, maxGain, savedValues, values, setMV, setMute}) => {
    const classes = useStyles();
    const delta = (parseFloat(values.mv) !== parseFloat(savedValues.mv) || values.mute !== savedValues.mute);
    return (
        <TightTextField className={clsx(classes.sized, classes.withoutLabel, classes.tightPad)}
                        variant={'outlined'}
                        id={fieldName}
                        value={values.mv}
                        onChange={e => setMV(e.target.value)}
                        aria-describedby={`${fieldName}-helper-text`}
                        InputProps={{
                            endAdornment: (
                                <InputAdornment position="end">
                                    <IconButton aria-label="mute channel"
                                                onClick={e => setMute(!values.mute)}
                                                className={classes.zeroPad}
                                                color={delta ? 'secondary' : 'default'}>
                                        {values.mute ? <VolumeOffIcon/> : <VolumeUpIcon/>}
                                    </IconButton>
                                </InputAdornment>
                            )
                        }}
                        inputProps={{
                            'aria-label': fieldName,
                            min: minGain,
                            max: maxGain,
                            step: 0.5
                        }}
                        margin={'dense'}
                        type='number'
                        size={'small'}
                        label={helpText}/>
    );
};

const Gain = ({selectedSlotId, deviceGains, gains, setGains, sendGains, isActive, Progress}) => {
    const classes = useStyles();
    if (selectedSlotId > -1) {
        return (
            <div className={classes.padTop}>
                <FormControl component="fieldset">
                    <FormGroup row>
                        <GainInput fieldName='master-gain' helpText='Master Gain' minGain={-127} maxGain={0}
                                   savedValues={{mv: deviceGains.master_mv, mute: deviceGains.master_mute}}
                                   values={{mv: gains.master_mv, mute: gains.master_mute}}
                                   setMV={v => setGains({...gains, ...{master_mv: v}})}
                                   setMute={v => setGains({...gains, ...{master_mute: v}})}/>
                        <GainInput fieldName='input1-gain' helpText='Input 1' minGain={-72} maxGain={12}
                                   savedValues={{mv: deviceGains.inputOne_mv, mute: deviceGains.inputOne_mute}}
                                   values={{mv: gains.inputOne_mv, mute: gains.inputOne_mute}}
                                   setMV={v => setGains({...gains, ...{inputOne_mv: v}})}
                                   setMute={v => setGains({...gains, ...{inputOne_mute: v}})}/>
                        <GainInput fieldName='input2-gain' helpText='Input 2' minGain={-72} maxGain={12}
                                   savedValues={{mv: deviceGains.inputTwo_mv, mute: deviceGains.inputTwo_mute}}
                                   values={{mv: gains.inputTwo_mv, mute: gains.inputTwo_mute}}
                                   setMV={v => setGains({...gains, ...{inputTwo_mv: v}})}
                                   setMute={v => setGains({...gains, ...{inputTwo_mute: v}})}/>
                        <Button variant="contained"
                                size="small"
                                color="default"
                                className={classes.sized}
                                onClick={() => sendGains(selectedSlotId, gains)}
                                startIcon={isActive() ? <CircularProgress size={24}/> : <PublishIcon/>}>
                            Upload
                        </Button>
                    </FormGroup>
                </FormControl>
            </div>
        );
    }
    return <div/>;
};

export default Gain;