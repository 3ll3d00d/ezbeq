import React, {useEffect, useMemo} from "react";
import UplotReact from 'uplot-react';
import 'uplot/dist/uPlot.min.css';
import Streamer from "./streamer";
import {EMPTY_PAYLOAD} from "./index";


const Chart = ({options, recording, setErr, activeDuration, direct, minidspRs, selectedDeviceName}) => {
    const url = direct
        ? `ws://${minidspRs.host}:${minidspRs.port}/devices/${minidspRs.device}?levels=true`
        : `ws://${window.location.host}/ws`;
    const streamer = useMemo(() => {
        return new Streamer(url, setErr, selectedDeviceName, direct);
    }, [url, setErr, selectedDeviceName, direct]);

    useEffect(() => {
        streamer.recording = recording;
    }, [streamer, recording]);

    useEffect(() => {
        streamer.activeDuration = activeDuration;
    }, [streamer, activeDuration]);

    useEffect(() => {
        return () => {
            streamer.close();
        };
    }, [streamer]);

    return (
        <UplotReact options={options}
                    data={EMPTY_PAYLOAD}
                    onCreate={u => streamer.chart = u}/>
    );
}

export default Chart;
