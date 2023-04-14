import Header from "../Header";
import Controls from "./Controls";
import React, {useEffect, useMemo, useRef, useState} from "react";
import Chart from "./Chart";
import {FormControlLabel, Switch, useTheme} from "@mui/material";
import {debounce} from "lodash/function";
import {useLocalStorage} from "../../services/util";

const trimToDuration = (data, duration) => {
    const time = data.payload[0];
    const firstTs = time[0];
    const lastTs = time[time.length - 1];
    const newFirstTs = lastTs - duration;
    if (newFirstTs > firstTs) {
        const firstIdx = time.findIndex(t => t >= newFirstTs);
        return {first: data.first, payload: data.payload.map(d1 => d1.slice(firstIdx))};
    } else {
        return {first: data.first, payload: data.payload};
    }
};

const NO_DATA_ERROR = new Error("No data in levels update");

const Levels = ({availableDevices, selectedDeviceName, setSelectedDeviceName, setErr}) => {
    const [recording, setRecording] = useState(true);
    const [duration, setDuration] = useLocalStorage('chartDuration', 60);
    const [direct, setDirect] = useLocalStorage('chartDirect', false);
    const [activeDuration, setActiveDuration] = useState(60);
    const [minidspRs, setMinidspRs] = useLocalStorage('chartMinidspRs', {host: window.location.hostname, device: 0, port: 5380});
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [payload, setPayload] = useState(null);
    const [data, setData] = useState({
        payload: [[], [], [], [], [], [], []],
        first: 0
    });
    const ws = useRef(null);
    const theme = useTheme();
    const opts = {
        series: [
            {
                label: 'Time'
            },
            {
                label: 'I1',
                stroke: theme.palette.primary.light,
                points: {show: false}
            },
            {
                label: 'I2',
                stroke: theme.palette.secondary.light,
                points: {show: false}
            },
            {
                label: 'O1',
                stroke: theme.palette.error.light,
                points: {show: false}
            },
            {
                label: 'O2',
                stroke: theme.palette.warning.light,
                points: {show: false}
            },
            {
                label: 'O3',
                stroke: theme.palette.info.light,
                points: {show: false}
            },
            {
                label: 'O4',
                stroke: theme.palette.success.light,
                points: {show: false}
            }
        ],
        axes: [
            {
                label: "Time (s)",
                stroke: theme.palette.text.primary,
                ticks: {
                    stroke: theme.palette.divider,
                },
                grid: {
                    stroke: theme.palette.divider,
                }
            },
            {
                label: "Level (dB)",
                stroke: theme.palette.text.primary,
                ticks: {
                    stroke: theme.palette.divider,
                },
                grid: {
                    stroke: theme.palette.divider,
                }
            }
        ],
        scales: {
            "x": {
                time: false,
            }
        },
    };

    const debounceDuration = useMemo(
        () => debounce(d => {
            setActiveDuration(d);
        }, 400),
        []
    );

    useEffect(() => {
        debounceDuration(duration);
    }, [duration, debounceDuration]);

    useEffect(() => {
        if (recording && payload) {
            if (Object.keys(payload).length === 0) {
                setErr(NO_DATA_ERROR);
            } else if (payload.hasOwnProperty('masterVolume')) {
                // ignore, status update from ezbeq
            } else if (payload.hasOwnProperty('input_levels') || payload.hasOwnProperty('input')) {
                const newVals = payload.hasOwnProperty('input_levels')
                    ? [new Date().getTime() / 1000.0, ...payload.input_levels, ...payload.output_levels]
                    : [payload.ts, ...payload.input, ...payload.output];
                setData(d => {
                    if (d.payload[0].length > 0) {
                        d.payload = newVals.map((v, idx) => idx === 0 ? [...d.payload[idx], (v - d.first)] : [...d.payload[idx], v]);
                    } else {
                        d.first = newVals[0];
                        d.payload = newVals.map((v, idx) => idx === 0 ? [v - d.first] : [v]);
                    }
                    return trimToDuration(d, activeDuration);
                });
            } else if (direct && payload.hasOwnProperty('master')) {
                // ignore, status update from minidsprs
            } else {
                setErr(new Error(`Unexpected data ${payload}`));
            }
        }
    }, [recording, payload, direct, setErr, activeDuration]);

    useEffect(() => {
        const url = direct
            ? `ws://${minidspRs.host}:${minidspRs.port}/devices/${minidspRs.device}?levels=true`
            : `ws://${window.location.host}/ws`;
        if (ws.current === null) {
            ws.current = new WebSocket(url);
            ws.current.onerror = e => {
                setErr(new Error(`Failed to connect to ${url}`));
            };
            ws.current.onopen = e => {
                console.log(`Connected to ${url}`);
                if (!direct) {
                    ws.current.send(`subscribe levels ${selectedDeviceName}`);
                }
            }
            ws.current.onclose = e => {
                console.log(`Closed connection to ${url} - ${e.code}`);
            }
            ws.current.onmessage = e => setPayload(JSON.parse(e.data));
        }
        return () => {
            ws.current.close();
            ws.current = null;
        };
    }, [selectedDeviceName, setErr, minidspRs, direct]);

    const chartOpts = Object.assign({}, opts, {
        width: window.innerWidth - 16,
        height: window.innerHeight - 233,
    });
    return (
        <>
            <Header availableDeviceNames={Object.keys(availableDevices)}
                    setSelectedDeviceName={setSelectedDeviceName}
                    selectedDeviceName={selectedDeviceName}>
                <FormControlLabel control={
                    <Switch checked={showAdvanced} onChange={e => setShowAdvanced(e.target.checked)} size={'small'}/>
                }/>
            </Header>
            <Controls duration={duration}
                      setDuration={setDuration}
                      recording={recording}
                      setRecording={setRecording}
                      direct={direct}
                      setDirect={setDirect}
                      showAdvanced={showAdvanced}
                      minidspRs={minidspRs}
                      setMinidspRs={setMinidspRs}/>
            <Chart options={chartOpts} data={data.payload}/>
        </>
    );
};

export default Levels;