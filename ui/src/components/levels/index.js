import Header from "../Header";
import Controls from "./Controls";
import {useEffect, useState} from "react";
import Chart from "./Chart";
import ezbeq from "../../services/ezbeq";

const opts = {
    width: window.innerWidth - 16,
    height: window.innerHeight - 233,
    series: [
        {
            label: 'Time'
        },
        {
            label: 'I1',
            scale: 'dBI',
            stroke: "red",
            points: {show: false}
        },
        {
            label: 'I2',
            scale: 'dBI',
            stroke: "orange",
            points: {show: false}
        },
        {
            label: 'O1',
            scale: 'dBO',
            stroke: "green",
            points: {show: false}
        },
        {
            label: 'O2',
            scale: 'dBO',
            stroke: "blue",
            points: {show: false}
        },
        {
            label: 'O3',
            scale: 'dBO',
            stroke: "indigo",
            points: {show: false}
        },
        {
            label: 'O4',
            scale: 'dBO',
            stroke: "violet",
            points: {show: false}
        }
    ],
    axes: [
        {
            label: "Time (s)",
            values: (self, ticks) => ticks.map(rawValue => rawValue / 1000),
        },
        {
            label: "Input (dB)",
            scale: "dBI",
        },
        {
            label: "Output (dB)",
            scale: "dBO",
            side: 1,
            grid: {show: false},
        }
    ],
    scales: {
        "x": {
            time: false,
        },
        "dBI": {
            auto: false,
            range: [-150, 0],
        },
        "dBO": {
            auto: false,
            range: [-150, 0]
        }
    },
};

const trimToDuration = (data, duration) => {
    const time = data[0];
    const firstTs = time[0];
    const lastTs = time[time.length - 1];
    const newFirstTs = lastTs - (duration * 1000);
    if (newFirstTs > firstTs) {
        const firstIdx = time.findIndex(t => t>=newFirstTs);
        return data.map(d1 => d1.slice(firstIdx));
    } else {
        return data;
    }
};

const Levels = ({availableDevices, selectedDeviceName, setSelectedDeviceName, setErr}) => {
    const [duration, setDuration] = useState(30);
    const [first, setFirst] = useState(0);
    const [data, setData] = useState([[], [], [], [], [], [], []]);

    useEffect(() => {
        const timer = setInterval(async () => {
            try {
                const levels = await ezbeq.getLevels(selectedDeviceName);
                if (levels.hasOwnProperty('input') && levels.hasOwnProperty('output')) {
                    const newVals = [new Date().getTime(), ...levels.input, ...levels.output];
                    let offset = 0;
                    if (first === 0) {
                        const firstTs = new Date().getTime();
                        setFirst(firstTs);
                        offset = firstTs;
                    } else {
                        offset = first;
                    }
                    setData(d => {
                        if (d[0].length > 0) {
                            d = newVals.map((v, idx) => idx === 0 ? [...d[idx], (v - offset)] : [...d[idx], v]);
                        } else {
                            d = newVals.map((v, idx) => idx === 0 ? [v-offset] : [v]);
                        }
                        return trimToDuration(d, duration);
                    });
                } else {
                    setErr(new Error(`No data available in levels ${JSON.stringify(levels)}`))
                }
            } catch (e) {
                setErr(e);
                clearInterval(timer);
            }
        }, 200);
        return () => clearInterval(timer);
    }, [selectedDeviceName, setData, first, setFirst, setErr, duration]);

    return (
        <>
            <Header availableDeviceNames={Object.keys(availableDevices)}
                    setSelectedDeviceName={setSelectedDeviceName}
                    selectedDeviceName={selectedDeviceName}/>
            <Controls duration={duration}
                      setDuration={setDuration}/>
            <Chart options={opts} data={data}/>
        </>
    );
};

export default Levels;