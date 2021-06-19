import clsx from 'clsx';
import {FormControl, FormHelperText, Input, InputAdornment} from "@material-ui/core";
import {makeStyles} from "@material-ui/core/styles";

const useStyles = makeStyles((theme) => ({
    root: {
        display: 'flex',
        flexWrap: 'wrap',
    },
    margin: {
        margin: theme.spacing(1),
    },
    textField: {
        width: '25ch',
    },
}));

const Controls = ({duration, setDuration}) => {
    const classes = useStyles();
    return (
        <form className={classes.root} noValidate autoComplete="off">
            <FormControl className={clsx(classes.margin, classes.textField)}>
                <Input id="duration-seconds"
                       variant="outlined"
                       endAdornment={<InputAdornment position="end">s</InputAdornment>}
                       aria-describedby="duration-seconds-helper-text"
                       inputProps={{
                           'aria-label': 'duration',
                           'min': 1,
                           'step': 1,
                           'max': 7200
                       }}
                       type={'number'}
                       value={duration}
                       onChange={e => setDuration(e.target.value)}/>
                <FormHelperText id="duration-seconds-helper-text">Duration</FormHelperText>
            </FormControl>
        </form>
    );
};

export default Controls;