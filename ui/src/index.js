import React from 'react';
import {StrictMode} from 'react';
import '@fontsource/roboto'
import App from './App';
import ReactDOMClient from "react-dom/client";

const container = document.getElementById('root');
const root = ReactDOMClient.createRoot(container);
root.render(
    <StrictMode>
        <App/>
    </StrictMode>
);