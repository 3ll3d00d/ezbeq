import Header from "../Header";
import Controls from "./Controls";
import React, {useEffect, useMemo, useState} from "react";
import {debounce} from "lodash/function";
import Chart from "./Chart";
import {useLocalStorage} from "../../services/util";

const Levels = ({
                    availableDevices,
                    selectedDeviceName,
                    setSelectedDeviceName,
                    levelsService,
                    hasMultipleTabs,
                    setSelectedNav,
                    selectedNav,
                    theme
                }) => {
    const [activeDuration, setActiveDuration] = useState(60);
    const [recording, setRecording] = useState(true);
    const [duration, setDuration] = useLocalStorage('chartDuration', 60);
    const debounceDuration = useMemo(
        () => debounce(d => {
            setActiveDuration(d);
        }, 400),
        []
    );

    const opts = {
        series: [
            {
                label: 'Time'
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

    useEffect(() => {
        debounceDuration(duration);
    }, [duration, debounceDuration]);

    useEffect(() => {
        levelsService.setRecording(recording);
    }, [levelsService, recording]);

    useEffect(() => {
        levelsService.setActiveDuration(activeDuration);
    }, [levelsService, activeDuration]);

    useEffect(() => {
        levelsService.setActiveDevice(selectedDeviceName);
    }, [levelsService, selectedDeviceName]);

    const chartOpts = Object.assign({}, opts, {
        width: window.innerWidth - 16,
        height: window.innerHeight - 233,
    });
    return (
        <>
            <Header availableDeviceNames={Object.keys(availableDevices)}
                    setSelectedDeviceName={setSelectedDeviceName}
                    selectedDeviceName={selectedDeviceName}
                    selectedNav={selectedNav}
                    setSelectedNav={setSelectedNav}
                    hasMultipleTabs={hasMultipleTabs}/>
            <Controls duration={duration}
                      setDuration={setDuration}
                      recording={recording}
                      setRecording={setRecording}/>
            <Chart options={chartOpts}
                   levelsService={levelsService}
                   devices={Object.keys(availableDevices)}/>
        </>
    );
};

export default Levels;