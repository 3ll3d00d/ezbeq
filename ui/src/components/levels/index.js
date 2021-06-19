import Header from "../Header";
import Controls from "./Controls";
import {useEffect, useRef, useState} from "react";
import Chart from "./Chart";

const opts = {
    series: [
        {
            label: 'Time'
        },
        {
            label: 'I1',
            stroke: "red",
            points: {show: false}
        },
        {
            label: 'I2',
            stroke: "orange",
            points: {show: false}
        },
        {
            label: 'O1',
            stroke: "green",
            points: {show: false}
        },
        {
            label: 'O2',
            stroke: "blue",
            points: {show: false}
        },
        {
            label: 'O3',
            stroke: "indigo",
            points: {show: false}
        },
        {
            label: 'O4',
            stroke: "violet",
            points: {show: false}
        }
    ],
    axes: [
        {
            label: "Time (s)"
        },
        {
            label: "Level (dB)"
        }
    ],
    scales: {
        "x": {
            time: false,
        }
    },
};

const trimToDuration = (data, duration) => {
    const time = data[0];
    const firstTs = time[0];
    const lastTs = time[time.length - 1];
    const newFirstTs = lastTs - duration;
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
    const ws = useRef(null);

    useEffect(() => {
        ws.current = new WebSocket("ws://" + window.location.host + "/ws");
        ws.current.onopen = () => {
            console.log(`Subscribing to ${selectedDeviceName}`)
            ws.current.send(`subscribe levels ${selectedDeviceName}`);
        };
        ws.current.onclose = () => {
            console.log("Closing ws")
        }
        ws.current.onmessage = e => {
            const levels = JSON.parse(e.data);
            if (levels.hasOwnProperty('masterVolume')) {
                // ignore
            } else if (levels.hasOwnProperty('input') && levels.hasOwnProperty('output')) {
                const newVals = [levels.ts, ...levels.input, ...levels.output];
                let offset = 0;
                if (first === 0) {
                    const firstTs = newVals[0];
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
        }
        return () => {
            ws.current.close();
        };
    }, [selectedDeviceName, setData, first, setFirst, setErr, duration]);

    const chartOpts = Object.assign({}, opts, {
        width: window.innerWidth - 16,
        height: window.innerHeight - 233,
    });
    return (
        <>
            <Header availableDeviceNames={Object.keys(availableDevices)}
                    setSelectedDeviceName={setSelectedDeviceName}
                    selectedDeviceName={selectedDeviceName}/>
            <Controls duration={duration}
                      setDuration={setDuration}/>
            <Chart options={chartOpts} data={data}/>
        </>
    );
};

export default Levels;