import React from 'react';
import {StrictMode} from 'react';
import '@fontsource/roboto/300.css';
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import App from './App';
import ReactDOMClient from "react-dom/client";

const container = document.getElementById('root');
const root = ReactDOMClient.createRoot(container);
root.render(
    <StrictMode>
        <App/>
    </StrictMode>
);