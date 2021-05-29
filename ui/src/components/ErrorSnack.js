import React, {useEffect} from 'react';
import Snackbar from '@material-ui/core/Snackbar';
import IconButton from '@material-ui/core/IconButton';
import CloseIcon from '@material-ui/icons/Close';

const ErrorSnack = ({err, errTxt, setErrTxt}) => {

    useEffect(() => {
        if (err) {
            console.error(err);
            setErrTxt(err.message);
        }
    }, [err, setErrTxt]);

    const handleClose = (event, reason) => {
        setErrTxt(null);
    };

    return (
        <Snackbar
            anchorOrigin={{
                vertical: 'bottom',
                horizontal: 'left',
            }}
            open={errTxt !== null}
            autoHideDuration={6000}
            onClose={handleClose}
            message={err ? err.message : null}
            action={
                <>
                    <IconButton size="small" aria-label="close" color="inherit" onClick={handleClose}>
                        <CloseIcon fontSize="small"/>
                    </IconButton>
                </>
            }
        />
    );
}

export default ErrorSnack;