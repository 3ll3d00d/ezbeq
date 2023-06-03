import Header from "../Header";
import Controls from "./Controls";
import React, {useEffect, useMemo, useState} from "react";
import {debounce} from "lodash/function";
import Chart from "./Chart";
import {useLocalStorage} from "../../services/util";

const Levels = ({
                    availableDevices,
                    selectedDevice,
                    setSelectedDevice,
                    levelsService,
                    setSelectedNav,
                    selectedNav,
                    theme
                }) => {
    const [activeDuration, setActiveDuration] = useState(60);
    const [paused, setPaused] = useState(false);
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
                scale: 'dB',
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
            },
            "dB": {
                auto: true
            }
        },
    };

    useEffect(() => {
        debounceDuration(duration);
    }, [duration, debounceDuration]);

    useEffect(() => {
        levelsService.pause(paused);
    }, [levelsService, paused]);

    useEffect(() => {
        levelsService.setActiveDuration(activeDuration);
    }, [levelsService, activeDuration]);

    useEffect(() => {
        levelsService.setActiveDevice(selectedDevice);
    }, [levelsService, selectedDevice]);

    const chartOpts = Object.assign({}, opts, {
        width: window.innerWidth - 16,
        height: window.innerHeight - 233,
    });
    return (
        <>
            <Header availableDevices={availableDevices}
                    setSelectedDevice={setSelectedDevice}
                    selectedDevice={selectedDevice}
                    selectedNav={selectedNav}
                    setSelectedNav={setSelectedNav}/>
            <Controls duration={duration}
                      setDuration={setDuration}
                      paused={paused}
                      setPaused={setPaused}/>
            <Chart options={chartOpts}
                   levelsService={levelsService}
                   devices={availableDevices}/>
        </>
    );
};

export default Levels;