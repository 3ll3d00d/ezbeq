import Header from "../Header";
import React, {useState} from "react";
import {makeStyles} from "@material-ui/core/styles";
import {
    Button,
    Chip,
    CircularProgress,
    FormControl,
    FormControlLabel,
    Grid,
    Input,
    InputLabel,
    MenuItem,
    Select,
    Switch,
    TextField,
    useTheme
} from "@material-ui/core";
import PublishIcon from "@material-ui/icons/Publish";
import ezbeq from "../../services/ezbeq";

const useStyles = makeStyles((theme) => ({
    formControl: {
        margin: theme.spacing(1),
        minWidth: 120,
        maxWidth: 300,
    },
    chips: {
        display: 'flex',
        flexWrap: 'wrap',
    },
    chip: {
        margin: 2,
    },
    root: {
        '& .MuiTextField-root': {
            margin: theme.spacing(1),
        },
    }
}));

const ITEM_HEIGHT = 48;
const ITEM_PADDING_TOP = 8;
const MenuProps = {
    PaperProps: {
        style: {
            maxHeight: ITEM_HEIGHT * 4.5 + ITEM_PADDING_TOP,
            width: 250,
        },
    },
};

const getStyles = (output, outputs, theme) => {
    return {
        fontWeight:
            outputs.indexOf(output) === -1
                ? theme.typography.fontWeightRegular
                : theme.typography.fontWeightMedium,
    };
};

const SelectableSlots = ({name, values, availableValues, onChange}) => {
    const classes = useStyles();
    const theme = useTheme();
    return (
        <FormControl className={classes.formControl}>
            <InputLabel id={`${name}-label`}>{name}</InputLabel>
            <Select labelId={`${name}-label`}
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
                    <MenuItem key={v}
                              value={v}
                              style={getStyles(v, values, theme)}>
                        {v}
                    </MenuItem>
                ))}
            </Select>
        </FormControl>

    );
};

const Minidsp = ({availableDevices, setSelectedDeviceName, selectedDeviceName, selectedSlotId, setErr}) => {
    const classes = useStyles();
    const [inputs, setInputs] = useState([]);
    const [outputs, setOutputs] = useState([1, 2, 3, 4]);
    const [config, setConfig] = useState(selectedSlotId);
    const [biquads, setBiquads] = useState('');
    const [overwrite, setOverwrite] = useState(true);
    const [pending, setPending] = useState(false);

    const uploadBiquads = async () => {
        setPending(true);
        try {
            const response = await ezbeq.sendBiquads(selectedDeviceName, config, inputs, outputs, biquads, overwrite);
            console.debug(response);
        } catch (e) {
            setErr(e);
        } finally {
            setPending(false);
        }
    };

    return (
        <>
            <Header availableDeviceNames={Object.keys(availableDevices)}
                    setSelectedDeviceName={setSelectedDeviceName}
                    selectedDeviceName={selectedDeviceName}>
            </Header>
            <form className={classes.root} noValidate autoComplete="off">
                <Grid container>
                    <Grid container justify="space-evenly" alignItems="center">
                        <Grid item>
                            <FormControl className={classes.formControl}>
                                <InputLabel id="config-label">Config</InputLabel>
                                <Select labelId="config-label"
                                        id="config"
                                        value={config}
                                        onChange={e => setConfig(e.target.value)}>
                                    {[1,2,3,4].map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
                                </Select>
                            </FormControl>
                        </Grid>
                        <Grid item>
                            <SelectableSlots name={'Input'}
                                             onChange={e => setInputs(e.target.value.sort())}
                                             availableValues={[1, 2]}
                                             values={inputs}/>
                        </Grid>
                        <Grid item>
                            <SelectableSlots name={'Output'}
                                             onChange={e => setOutputs(e.target.value.sort())}
                                             availableValues={[1, 2, 3, 4]}
                                             values={outputs}/>
                        </Grid>
                        <Grid item>
                            <FormControlLabel
                                control={<Switch checked={overwrite}
                                                 onChange={e => setOverwrite(e.target.checked)}
                                                 color="default"
                                                 name="overwrite"/>}
                                labelPlacement="top"
                                label="Overwrite?"/>
                        </Grid>
                        <Grid item>
                            <Button variant="outlined"
                                    color="primary"
                                    onClick={uploadBiquads}
                                    disabled={biquads.length === 0}
                                    startIcon={pending ? <CircularProgress size={24}/> :
                                        <PublishIcon fontSize="small"/>}>
                                Upload
                            </Button>
                        </Grid>
                    </Grid>
                    <Grid container item>
                        <TextField id="biquads"
                                   label="Biquads"
                                   multiline
                                   rows={26}
                                   fullWidth
                                   value={biquads}
                                   onChange={e => setBiquads(e.target.value)}
                                   variant="outlined"/>
                    </Grid>
                </Grid>
            </form>
        </>
    );
}

export default Minidsp;