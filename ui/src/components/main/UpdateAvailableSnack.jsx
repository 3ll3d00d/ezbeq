import React from 'react';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import IconButton from '@mui/material/IconButton';
import CloseIcon from '@mui/icons-material/Close';

const UpdateAvailableSnack = ({updateAvailable, latestVersion, onDismiss}) => {
    const handleClose = (event, reason) => {
        if (reason === 'clickaway') {
            return;
        }
        onDismiss();
    };

    return (
        <Snackbar
            open={!!updateAvailable}
            autoHideDuration={null}
            onClose={handleClose}
            anchorOrigin={{vertical: 'bottom', horizontal: 'left'}}
        >
            <Alert
                severity="info"
                variant="standard"
                action={
                    <IconButton size="small" aria-label="close" color="inherit" onClick={handleClose}>
                        <CloseIcon fontSize="small"/>
                    </IconButton>
                }
            >
                ezbeq {latestVersion} is available.{' '}
                <a href={`https://github.com/3ll3d00d/ezbeq/releases/tag/${latestVersion}`} target="_blank" rel="noreferrer">
                    See what's new
                </a>
            </Alert>
        </Snackbar>
    );
}

export default UpdateAvailableSnack;
