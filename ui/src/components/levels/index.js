import Header from "../Header";
import Controls from "./Controls";
import React, {useEffect, useMemo, useState} from "react";
import {FormControlLabel, Switch, useTheme} from "@mui/material";
import {debounce} from "lodash/function";
import Chart from "./Chart";
import {useLocalStorage} from "../../services/util";

const EMPTY_PAYLOAD = [[], [], [], [], [], [], []];

const Levels = ({availableDevices, selectedDeviceName, setSelectedDeviceName, setErr}) => {
    const theme = useTheme();
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [activeDuration, setActiveDuration] = useState(60);
    const [duration, setDuration] = useLocalStorage('chartDuration', 60);
    const [recording, setRecording] = useState(true);
    const [direct, setDirect] = useLocalStorage('chartDirect', false);
    const [minidspRs, setMinidspRs] = useLocalStorage('chartMinidspRs', {
        host: window.location.hostname,
        device: 0,
        port: 5380
    });
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
            <Chart options={chartOpts}
                   recording={recording}
                   setErr={setErr}
                   activeDuration={activeDuration}
                   direct={direct}
                   minidspRs={minidspRs}
                   selectedDeviceName={selectedDeviceName}/>
        </>
    );
};

export {
    EMPTY_PAYLOAD
};
export default Levels;