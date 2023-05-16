import React, {useEffect} from "react";
import UplotReact from 'uplot-react';
import 'uplot/dist/uPlot.min.css';
import {EMPTY_PAYLOAD} from "../../services/streamer";


const Chart = ({options, streamer, devices}) => {

    useEffect(() => {
        streamer.loadDevices(devices);
        streamer.initWebsocket();
        return () => {
            streamer.close();
        };
    }, [streamer]);

    return (
        <UplotReact options={options}
                    data={EMPTY_PAYLOAD}
                    onCreate={u => streamer.setChart(u)}
                    onDelete={u => streamer.setChart(null)}/>
    );
}

export default Chart;
