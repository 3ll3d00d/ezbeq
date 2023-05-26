import clsx from 'clsx';
import {FormControlLabel, Switch, TextField} from "@mui/material";
import {makeStyles} from "@mui/styles";

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
                      paused,
                      setPaused
                  }) => {
    const classes = useStyles();
    return <form className={clsx(classes.root, classes.margin)} noValidate autoComplete="off">
        <TextField
            variant="standard"
            id="duration-seconds"
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
            InputLabelProps={{ shrink: true }} />
        <FormControlLabel className={classes.margin}
                          control={<Switch checked={paused}
                                           onChange={e => setPaused(e.target.checked)}
                                           name="paused"
                                           color="primary"/>}
                          label="Pause?"/>
    </form>;
};

export default Controls;