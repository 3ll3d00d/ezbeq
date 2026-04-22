import React from 'react';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';

const SuccessSnack = ({msg, setMsg}) => {
    return (
        <Snackbar
            open={msg !== null}
            autoHideDuration={3000}
            onClose={() => setMsg(null)}
            anchorOrigin={{vertical: 'bottom', horizontal: 'left'}}
        >
            <Alert severity="success" variant="standard" onClose={() => setMsg(null)}>
                {msg}
            </Alert>
        </Snackbar>
    );
}

export default SuccessSnack;
