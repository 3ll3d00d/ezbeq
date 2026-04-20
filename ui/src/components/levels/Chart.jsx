import React, {useEffect, useState} from "react";
import UplotReact from 'uplot-react';
import 'uplot/dist/uPlot.min.css';
import {Alert} from "@mui/material";

const Chart = ({options, levelsService, devices}) => {
    const [connected, setConnected] = useState(true);

    useEffect(() => {
        levelsService.setConnectedCallback(setConnected);
        levelsService.loadDevices(devices);
        levelsService.initWebsocket();
        return () => {
            levelsService.close();
        };
    }, [levelsService]);

    return (
        <>
            {!connected && (
                <Alert severity="warning" sx={{mb: 1}}>
                    Levels WebSocket disconnected — reconnecting…
                </Alert>
            )}
            <UplotReact options={options}
                        data={[]}
                        onCreate={u => levelsService.setChart(u)}
                        onDelete={u => levelsService.setChart(null)}/>
        </>
    );
}

export default Chart;
