import React, {useEffect, useState} from 'react';
import Snackbar from '@material-ui/core/Snackbar';
import IconButton from '@material-ui/core/IconButton';
import CloseIcon from '@material-ui/icons/Close';

const ErrorSnack = ({err, setErr}) => {
    const [errTxt, setErrTxt] = useState(null);

    useEffect(() => {
        if (err) {
            console.error(err);
            setErrTxt(err.message);
        } else {
            setErrTxt(null);
        }
    }, [err, setErrTxt]);

    const handleClose = (event, reason) => {
        setErr(null);
    };

    return (
        <Snackbar
            open={errTxt !== null}
            autoHideDuration={10000}
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