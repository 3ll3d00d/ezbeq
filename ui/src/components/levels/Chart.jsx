import React, {useEffect} from "react";
import UplotReact from 'uplot-react';
import 'uplot/dist/uPlot.min.css';

const Chart = ({options, levelsService, devices}) => {

    useEffect(() => {
        levelsService.loadDevices(devices);
        levelsService.initWebsocket();
        return () => {
            levelsService.close();
        };
    }, [levelsService]);

    return (
        <UplotReact options={options}
                    data={[]}
                    onCreate={u => levelsService.setChart(u)}
                    onDelete={u => levelsService.setChart(null)}/>
    );
}

export default Chart;
