import React, {useEffect, useState} from 'react';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import IconButton from '@mui/material/IconButton';
import CloseIcon from '@mui/icons-material/Close';

const ErrorSnack = ({err, setErr}) => {
    const [errTxt, setErrTxt] = useState(null);
    const [persistent, setPersistent] = useState(false);

    useEffect(() => {
        if (err) {
            console.error(err);
            setErrTxt(err.message);
            setPersistent(!!err.persistent);
        } else {
            setErrTxt(null);
            setPersistent(false);
        }
    }, [err, setErrTxt]);

    const handleClose = (event, reason) => {
        if (persistent && reason === 'clickaway') {
            return;
        }
        setErr(null);
    };

    return (
        <Snackbar
            open={errTxt !== null}
            autoHideDuration={persistent ? null : 10000}
            onClose={handleClose}
            anchorOrigin={persistent ? {vertical: 'top', horizontal: 'center'} : {vertical: 'bottom', horizontal: 'left'}}
        >
            <Alert
                severity="error"
                variant={persistent ? 'filled' : 'standard'}
                action={
                    <IconButton size="small" aria-label="close" color="inherit" onClick={handleClose}>
                        <CloseIcon fontSize="small"/>
                    </IconButton>
                }
            >
                {errTxt}
            </Alert>
        </Snackbar>
    );
}

export default ErrorSnack;
