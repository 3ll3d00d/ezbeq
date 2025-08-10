import clsx from 'clsx';
import { styled } from '@mui/material/styles';
import {FormControlLabel, Switch, TextField} from "@mui/material";
const PREFIX = 'Controls';

const classes = {
    root: `${PREFIX}-root`,
    margin: `${PREFIX}-margin`,
    textField: `${PREFIX}-textField`
};

const Root = styled('form')((
    {
        theme
    }
) => ({
    [`&.${classes.root}`]: {
        display: 'flex',
        flexWrap: 'wrap',
    },

    [`&.${classes.margin}`]: {
        margin: theme.spacing(1),
    },

    [`& .${classes.textField}`]: {
        width: '10ch',
    }
}));

const Controls = ({
                      duration,
                      setDuration,
                      paused,
                      setPaused
                  }) => {

    return (
        <Root className={clsx(classes.root, classes.margin)} noValidate autoComplete="off">
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
        </Root>
    );
};

export default Controls;