import Header from "../Header";
import {styled} from '@mui/material/styles';
import React, {useCallback, useEffect, useRef, useState} from "react";
import {
    Button,
    Chip,
    Divider,
    FormControl,
    FormControlLabel,
    Grid,
    Input,
    InputLabel,
    MenuItem,
    Select,
    Switch,
    TextField,
    Typography,
} from "@mui/material";
import Box from "@mui/material/Box";
import PublishIcon from "@mui/icons-material/Publish";
import ezbeq from "../../services/ezbeq";
import {useLocalStorage} from "../../services/util";
import Gain from "../main/Gain";

const PREFIX = 'Minidsp';

const classes = {
    formControl: `${PREFIX}-formControl`,
    chips: `${PREFIX}-chips`,
    chip: `${PREFIX}-chip`,
    root: `${PREFIX}-root`
};

const Root = styled('div')((
    {
        theme
    }
) => ({
    [`& .${classes.formControl}`]: {
        margin: theme.spacing(1),
        minWidth: 120,
        maxWidth: 300,
    },

    [`& .${classes.chips}`]: {
        display: 'flex',
        flexWrap: 'wrap',
    },

    [`& .${classes.chip}`]: {
        margin: 2,
    },

    [`& .${classes.root}`]: {
        '& .MuiTextField-root': {
            margin: theme.spacing(1),
        },
    }
}));

const ITEM_HEIGHT = 48;
const ITEM_PADDING_TOP = 8;
const MenuProps = {
    slotProps: {
        paper: {
            style: {
                maxHeight: ITEM_HEIGHT * 4.5 + ITEM_PADDING_TOP,
                width: 250,
            },
        }
    }
};

const getStyles = (output, outputs, theme) => {
    return {
        fontWeight:
            outputs.indexOf(output) === -1
                ? theme.typography.fontWeightRegular
                : theme.typography.fontWeightMedium,
    };
};

const SelectableSlots = ({
                             name,
                             values,
                             availableValues,
                             onChange,
                             theme
                         }) => {

    return (
        <FormControl variant="standard" className={classes.formControl}>
            <InputLabel id={`${name}-label`}>{name}</InputLabel>
            <Select
                variant="standard"
                labelId={`${name}-label`}
                id={name}
                multiple
                value={values}
                onChange={onChange}
                input={<Input id="select-multiple-chip"/>}
                renderValue={(selected) => (
                    <div className={classes.chips}>
                        {selected.map((value) => (
                            <Chip key={value} label={value} className={classes.chip}/>
                        ))}
                    </div>
                )}
                MenuProps={MenuProps}>
                {availableValues.map(v => (
                    <MenuItem key={`${name}-${v}`}
                              value={v}
                              style={getStyles(v, values, theme)}>
                        {v}
                    </MenuItem>
                ))}
            </Select>
        </FormControl>
    );
};

const defaultGain = {
    master_mv: 0.0, master_mute: false, gains: [], mutes: [], output_gains: [], output_mutes: []
};

const Minidsp = ({
                     availableDevices,
                     setSelectedDeviceName,
                     selectedDeviceName,
                     selectedSlotId,
                     setErr,
                     setSelectedNav,
                     selectedNav,
                     theme
                 }) => {

    const [inputs, setInputs] = useLocalStorage(`minidspInputs.${selectedDeviceName}.${selectedSlotId}`, []);
    const [outputs, setOutputs] = useLocalStorage(`minidspOutputs.${selectedDeviceName}.${selectedSlotId}`, []);
    const [commandType, setCommandType] = useLocalStorage(`minidsp.${selectedDeviceName}.commandType`, 'bq')
    const [config, setConfig] = useState(selectedSlotId);
    const [commands, setCommands] = useState('');
    const [overwrite, setOverwrite] = useState(true);
    const [pending, setPending] = useState(false);
    const [inputChannels, setInputChannels] = useState([]);
    const [outputChannels, setOutputChannels] = useState([]);

    // volume control state
    const [currentGains, setCurrentGains] = useState(defaultGain);
    const [deviceGains, setDeviceGains] = useState({...defaultGain});
    const prevDeviceNameRef = useRef(null);
    const prevSlotIdRef = useRef(null);
    const selectedDevice = availableDevices && selectedDeviceName ? availableDevices[selectedDeviceName] : null;

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
            const deviceChanged = selectedDevice.name !== prevDeviceNameRef.current;
            const slotChanged = selectedSlotId !== prevSlotIdRef.current;
            if (deviceChanged || slotChanged) {
                setCurrentGains(gain);
                prevDeviceNameRef.current = selectedDevice.name;
                prevSlotIdRef.current = selectedSlotId;
            }
        }
    }, [selectedDevice, selectedSlotId]);

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

    const updateGain = useCallback((parent, key, value) => {
        setCurrentGains(g => applyGainChange(g, parent, key, value));
    }, []);

    const commitGain = useCallback((parent, key, value) => {
        setCurrentGains(g => applyGainChange(g, parent, key, value));
        if (selectedDevice) {
            ezbeq.patchSingle(selectedDevice.name, parent, key, value, selectedSlotId)
                .catch(e => setErr(e));
        }
    }, [selectedDevice, selectedSlotId]);

    const uploadTextCommands = async () => {
        setPending(true);
        try {
            const response = await ezbeq.sendTextCommands(selectedDeviceName, config, inputs, outputs, commandType, commands, overwrite);
            console.debug(response);
        } catch (e) {
            setErr(e);
        } finally {
            setPending(false);
        }
    };

    useEffect(() => {
        if (availableDevices && selectedDeviceName && selectedSlotId) {
            const slot = availableDevices[selectedDeviceName].slots.find(s => s.id === selectedSlotId);
            setInputChannels(Array.from(Array(slot.inputs).keys()).map(i => i + 1));
            setOutputChannels(Array.from(Array(slot.outputs).keys()).map(i => i + 1));
        }
    }, [availableDevices, selectedDeviceName, selectedSlotId]);

    useEffect(() => {
        if (inputs.some(i => !inputChannels.includes(i))) {
            setInputs(inputs.filter(i => inputChannels.includes(i)))
        }
    }, [setInputs, inputChannels, inputs]);

    useEffect(() => {
        if (outputs.some(i => !outputChannels.includes(i))) {
            setOutputs(outputs.filter(i => outputChannels.includes(i)))
        }
    }, [setOutputs, outputChannels, outputs]);

    return (
        <Root>
            <Header availableDevices={availableDevices}
                    setSelectedDeviceName={setSelectedDeviceName}
                    selectedDeviceName={selectedDeviceName}
                    selectedNav={selectedNav}
                    setSelectedNav={setSelectedNav}
            />

            {/* Volume Controls */}
            {selectedDevice && selectedDevice.hasOwnProperty('masterVolume') && (
                <Box sx={{px: 2, pt: 1}}>
                    <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                        Volume
                    </Typography>
                    <Gain
                        selectedSlotId={selectedSlotId}
                        deviceGains={deviceGains}
                        gains={currentGains}
                        updateGain={updateGain}
                        commitGain={commitGain}
                    />
                    <Divider sx={{mt: 2, mb: 1}}/>
                </Box>
            )}

            {/* Biquad Upload */}
            <Box sx={{px: 2}}>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                    Advanced
                </Typography>
                <form className={classes.root} noValidate autoComplete="off">
                    <Grid container>
                        <Grid container sx={{flexGrow: 1}} justifyContent="flex-start" alignItems="center" flexWrap="wrap">
                            <Grid>
                                <FormControl variant="standard" className={classes.formControl}>
                                    <InputLabel id="config-label">Config</InputLabel>
                                    <Select
                                        variant="standard"
                                        labelId="config-label"
                                        id="config"
                                        value={config}
                                        onChange={e => setConfig(e.target.value)}>
                                        {[1, 2, 3, 4].map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
                                    </Select>
                                </FormControl>
                            </Grid>
                            {
                                inputChannels.length > 0
                                    ?
                                    <Grid>
                                        <SelectableSlots name={'Input'}
                                                         key={'input'}
                                                         onChange={e => setInputs(e.target.value.sort())}
                                                         availableValues={inputChannels}
                                                         values={inputs}
                                                         theme={theme}/>
                                    </Grid>
                                    : null
                            }
                            {
                                outputChannels.length > 0
                                    ?
                                    <Grid>
                                        <SelectableSlots name={'Output'}
                                                         key={'output'}
                                                         onChange={e => setOutputs(e.target.value.sort())}
                                                         availableValues={outputChannels}
                                                         values={outputs}
                                                         theme={theme}/>
                                    </Grid>
                                    : null
                            }
                            <Grid>
                                <FormControlLabel
                                    control={<Switch checked={overwrite}
                                                     onChange={e => setOverwrite(e.target.checked)}
                                                     color="default"
                                                     name="overwrite"/>}
                                    labelPlacement="top"
                                    label="Overwrite?"/>
                            </Grid>
                            <Grid>
                                <FormControl variant="standard" className={classes.formControl}>
                                    <InputLabel id="mode-label">Mode</InputLabel>
                                    <Select
                                        variant="standard"
                                        labelId="mode-label"
                                        id="mode"
                                        value={commandType}
                                        onChange={e => setCommandType(e.target.value)}>
                                        <MenuItem key={'bq'} value={'bq'}>Biquads</MenuItem>
                                        <MenuItem key={'filt'} value={'filt'}>Filters</MenuItem>
                                        <MenuItem key={'rs'} value={'rs'}>RS</MenuItem>
                                    </Select>
                                </FormControl>
                            </Grid>
                            <Grid>
                                <Button variant="outlined"
                                        color="primary"
                                        onClick={uploadTextCommands}
                                        disabled={commands.length === 0}
                                        startIcon={pending ? <CircularProgress size={24}/> :
                                            <PublishIcon fontSize="small"/>}>
                                    Upload
                                </Button>
                            </Grid>
                        </Grid>
                        <Grid container sx={{flexGrow: 1, mt: 1}}>
                            <TextField id="commands"
                                       label={commandType === 'bq' ? 'Biquads' : commandType === 'filt' ? 'Filters' : 'Minidsp RS'}
                                       multiline
                                       minRows={10}
                                       fullWidth
                                       value={commands}
                                       onChange={e => setCommands(e.target.value)}
                                       variant="outlined"/>
                        </Grid>
                    </Grid>
                </form>
            </Box>
        </Root>
    );
}

export default Minidsp;
