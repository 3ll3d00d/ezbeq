import React, {useEffect, useState} from 'react';
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

const GainInput = ({fieldName, helpText, minGain, maxGain, step, dp, savedValues, values, setMV, setMute}) => {
    const classes = useStyles();
    const decimalSeparator = 1.1.toLocaleString().substring(1, 2);
    const oneNum = '^[0-9]$';
    console.log(decimalSeparator);
    const sepMatcher = decimalSeparator === '.' ? /\./g : new RegExp(decimalSeparator, 'g');
    const roundFactor = 1 / step;
    const delta = (parseFloat(values.mv) !== parseFloat(savedValues.mv) || values.mute !== savedValues.mute);
    const setConstrainedMV = (f, dp) => {
        const rounded = Math.round(f * (roundFactor)) / roundFactor;
        if (rounded > maxGain) {
            setMV(maxGain.toFixed(dp));
        } else if (rounded < minGain) {
            setMV(minGain.toFixed(dp));
        } else {
            setMV(rounded.toFixed(dp));
        }
    }
    const interpretMV = (txt) => {
        if (txt) {
            if (txt === '-') {
                setMV(txt);
            } else if (maxGain === 0 && txt.match(oneNum)) {
                setMV(`-${txt}`);
            } else {
                const dotCount = (txt.match(sepMatcher) || []).length;
                if (dotCount === 0) {
                    const f = parseFloat(txt);
                    if (!isNaN(f)) {
                        setConstrainedMV(f, 0);
                    }
                } else if (dotCount === 1) {
                    if (txt.charAt(txt.length - 1) === decimalSeparator) {
                        setMV(txt);
                    } else {
                        const f = parseFloat(txt);
                        if (!isNaN(f)) {
                            if (dp > 1) {
                                const oldValue = values.mv;
                                if (Math.abs(f) < Math.abs(oldValue) || txt.length < oldValue.toString().length) {
                                    setMV(txt);
                                } else {
                                    setConstrainedMV(f, dp);
                                }
                            } else {
                                setConstrainedMV(f, dp);
                            }
                        }
                    }
                }
            }
        } else {
            setMV('');
        }
    };
    return (
        <TightTextField className={clsx(classes.sized, classes.withoutLabel, classes.tightPad)}
                        variant={'outlined'}
                        id={fieldName}
                        value={values.mv}
                        onChange={e => interpretMV(e.target.value)}
                        aria-describedby={`${fieldName}-helper-text`}
                        InputProps={{
                            endAdornment: (
                                <InputAdornment position="end">
                                    <IconButton aria-label="mute channel"
                                                onClick={e => setMute(!values.mute)}
                                                className={classes.zeroPad}
                                                color={delta ? 'secondary' : 'default'}>
                                        {values.mute ? <VolumeOffIcon fontSize="small"/> :
                                            <VolumeUpIcon fontSize="small"/>}
                                    </IconButton>
                                </InputAdornment>
                            )
                        }}
                        inputProps={{
                            'aria-label': fieldName,
                            pattern: '',
                            inputMode: 'numeric'
                        }}
                        margin={'dense'}
                        size={'small'}
                        label={helpText}/>
    );
};

const Gain = ({selectedSlotId, deviceGains, gains, setGains, sendGains, isActive}) => {
    const classes = useStyles();
    const [valid, setValid] = useState(true);
    useEffect(() => {
        setValid(isNaN(gains.master_mv) || isNaN(gains.inputOne_mv) || isNaN(gains.inputTwo_mv));
    }, [gains]);
    if (selectedSlotId > -1) {
        return (
            <div className={classes.padTop}>
                <FormControl component="fieldset">
                    <FormGroup row>
                        <GainInput fieldName='master-gain' helpText='Master'
                                   minGain={-127} maxGain={0} step={0.5} dp={1}
                                   savedValues={{mv: deviceGains.master_mv, mute: deviceGains.master_mute}}
                                   values={{mv: gains.master_mv, mute: gains.master_mute}}
                                   setMV={v => setGains({...gains, ...{master_mv: v}})}
                                   setMute={v => setGains({...gains, ...{master_mute: v}})}/>
                        <GainInput fieldName='input1-gain' helpText='Input 1'
                                   minGain={-72} maxGain={12} step={0.25} dp={2}
                                   savedValues={{mv: deviceGains.inputOne_mv, mute: deviceGains.inputOne_mute}}
                                   values={{mv: gains.inputOne_mv, mute: gains.inputOne_mute}}
                                   setMV={v => setGains({...gains, ...{inputOne_mv: v}})}
                                   setMute={v => setGains({...gains, ...{inputOne_mute: v}})}/>
                        <GainInput fieldName='input2-gain' helpText='Input 2'
                                   minGain={-72} maxGain={12} step={0.25} dp={2}
                                   savedValues={{mv: deviceGains.inputTwo_mv, mute: deviceGains.inputTwo_mute}}
                                   values={{mv: gains.inputTwo_mv, mute: gains.inputTwo_mute}}
                                   setMV={v => setGains({...gains, ...{inputTwo_mv: v}})}
                                   setMute={v => setGains({...gains, ...{inputTwo_mute: v}})}/>
                        <Button variant="outlined"
                                size="small"
                                color="primary"
                                className={classes.sized}
                                onClick={() => sendGains(selectedSlotId, gains)}
                                disabled={valid}
                                startIcon={isActive() ? <CircularProgress size={24}/> :
                                    <PublishIcon fontSize="small"/>}>
                            Apply
                        </Button>
                    </FormGroup>
                </FormControl>
            </div>
        );
    }
    return <div/>;
};

export default Gain;