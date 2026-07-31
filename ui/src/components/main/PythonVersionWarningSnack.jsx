import React from 'react';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import IconButton from '@mui/material/IconButton';
import CloseIcon from '@mui/icons-material/Close';

const PythonVersionWarningSnack = ({pythonUnsupported, pythonVersion, minPythonVersion, onDismiss}) => {
    const handleClose = (event, reason) => {
        if (reason === 'clickaway') {
            return;
        }
        onDismiss();
    };

    return (
        <Snackbar
            open={!!pythonUnsupported}
            autoHideDuration={null}
            onClose={handleClose}
            anchorOrigin={{vertical: 'bottom', horizontal: 'right'}}
        >
            <Alert
                severity="warning"
                variant="standard"
                action={
                    <IconButton size="small" aria-label="close" color="inherit" onClick={handleClose}>
                        <CloseIcon fontSize="small"/>
                    </IconButton>
                }
            >
                Running Python {pythonVersion}; ezbeq requires {minPythonVersion}+. Some features may not work correctly.
            </Alert>
        </Snackbar>
    );
}

export default PythonVersionWarningSnack;
