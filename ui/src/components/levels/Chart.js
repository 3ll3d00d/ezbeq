import React from "react";
import UplotReact from 'uplot-react';
import 'uplot/dist/uPlot.min.css';

const Chart = ({options, data}) => {
    return (
        <UplotReact options={options} data={data}/>
    );
}

export default Chart;
