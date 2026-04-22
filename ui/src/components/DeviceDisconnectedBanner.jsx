import React from 'react';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';

const DeviceDisconnectedBanner = ({deviceName}) => {
    return (
        <Alert
            severity="error"
            variant="filled"
            sx={{borderRadius: 0, width: '100%'}}
        >
            <AlertTitle>Device Unreachable</AlertTitle>
            {deviceName} is not responding — check connection and review ezbeq.log
        </Alert>
    );
};

export default DeviceDisconnectedBanner;
