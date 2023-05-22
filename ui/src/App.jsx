import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {createTheme, StyledEngineProvider, ThemeProvider} from '@mui/material/styles';
import {makeStyles} from '@mui/styles';
import ezbeq from './services/ezbeq';
import useMediaQuery from '@mui/material/useMediaQuery';
import CssBaseline from '@mui/material/CssBaseline';
import {pushData, useLocalStorage} from "./services/util";
import ErrorSnack from "./components/ErrorSnack";
import MainView from "./components/main";
import Levels from "./components/levels";
import Minidsp from "./components/minidsp";
import Streamer from "./services/streamer";

const useStyles = makeStyles((theme) => ({
    root: {
        flexGrow: 1,
        width: '100vw',
        height: '100vh',
    }
}));

const Root = ({children}) => {
    const classes = useStyles();
    return (
        <div className={classes.root}>
            {children}
        </div>
    )
}

const ws = new WebSocket("ws://" + window.location.host + "/ws");

const App = () => {
    const prefersDarkMode = useMediaQuery('(prefers-color-scheme: dark)');
    const theme = React.useMemo(
        () =>
            createTheme({
                palette: {
                    mode: prefersDarkMode ? 'dark' : 'light',
                },
            }),
        [prefersDarkMode],
    );

    const replaceDevice = replacement => {
        setAvailableDevices(Object.assign({}, availableDevices, {[replacement.name]: replacement}));
    };

    // errors
    const [err, setErr] = useState(null);

    ws.onmessage = event => {
        const payload = JSON.parse(event.data);
        switch (payload.message) {
            case 'DeviceState':
                replaceDevice(payload.data);
                break;
            case 'Error':
                setErr(new Error(payload.data));
                break;
            default:
                console.warn(`Unknown ws message ${event.data}`)
        }
    };

    const [hasMultipleTabs, setHasMultipleTabs] = useState(false);
    // catalogue data
    const [entries, setEntries] = useState([]);
    // device state
    const [availableDevices, setAvailableDevices] = useState({});
    const [selectedSlotId, setSelectedSlotId] = useState(null);
    // view selection
    const [selectedDeviceName, setSelectedDeviceName] = useState('');
    const [selectedNav, setSelectedNav] = useState('catalogue');

    // levels
    const [minidspRs, setMinidspRs] = useLocalStorage('chartMinidspRs', {
        host: window.location.host,
        device: 0,
        port: 5380
    });
    const [direct, setDirect] = useLocalStorage('chartDirect', false);

    const streamer = useMemo(() => {
        return new Streamer(setErr);
    }, [setErr]);

    // initial data load
    useEffect(() => {
        pushData(setEntries, ezbeq.load, setErr);
    }, []);

    useEffect(() => {
        streamer.loadDevices(Object.keys(availableDevices));
    }, [streamer, availableDevices]);

    useEffect(() => {
        pushData(setAvailableDevices, ezbeq.getDevices, setErr);
    }, []);

    useEffect(() => {
        const url = direct
            ? `ws://${minidspRs.host}:${minidspRs.port}/devices/${minidspRs.device}?levels=true`
            : `ws://${window.location.host}/ws`;
        streamer.setUrl(url);
    }, [minidspRs, direct, streamer]);

    useEffect(() => {
        setHasMultipleTabs([...Object.keys(availableDevices)].find(k => availableDevices[k].hasOwnProperty('masterVolume')));
    }, [availableDevices, setHasMultipleTabs]);

    const getSelectedDevice = useCallback(() => {
            if (selectedDeviceName && availableDevices.hasOwnProperty(selectedDeviceName)) {
                return availableDevices[selectedDeviceName];
            }
            return {};
        }, [selectedDeviceName, availableDevices]
    );

    useEffect(() => {
        const d = getSelectedDevice();
        if (d && d.hasOwnProperty('slots')) {
            const slot = d.slots.find(s => s.active === true);
            if (slot) {
                setSelectedSlotId(slot.id);
            }
        }
    }, [getSelectedDevice, selectedDeviceName, availableDevices]);

    const useWide = useMediaQuery('(orientation: landscape) and (min-height: 580px)');

    return (
        <StyledEngineProvider injectFirst>
            <ThemeProvider theme={theme}>
                <CssBaseline/>
                <Root>
                    <ErrorSnack err={err} setErr={setErr}/>
                    {
                        selectedNav === 'catalogue'
                            ?
                            <MainView entries={entries}
                                      setErr={setErr}
                                      replaceDevice={replaceDevice}
                                      availableDevices={availableDevices}
                                      selectedDeviceName={selectedDeviceName}
                                      setSelectedDeviceName={setSelectedDeviceName}
                                      getSelectedDevice={getSelectedDevice}
                                      selectedSlotId={selectedSlotId}
                                      setSelectedSlotId={setSelectedSlotId}
                                      hasMultipleTabs={hasMultipleTabs}
                                      useWide={useWide}
                                      selectedNav={selectedNav}
                                      setSelectedNav={setSelectedNav}
                            />
                            :
                            selectedNav === 'levels'
                                ?
                                <Levels availableDevices={availableDevices}
                                        selectedDeviceName={selectedDeviceName}
                                        setSelectedDeviceName={setSelectedDeviceName}
                                        minidspRs={minidspRs}
                                        setMinidspRs={setMinidspRs}
                                        direct={direct}
                                        setDirect={setDirect}
                                        streamer={streamer}
                                        hasMultipleTabs={hasMultipleTabs}
                                        selectedNav={selectedNav}
                                        setSelectedNav={setSelectedNav}
                                />
                                :
                                <Minidsp availableDevices={availableDevices}
                                         selectedDeviceName={selectedDeviceName}
                                         setSelectedDeviceName={setSelectedDeviceName}
                                         selectedSlotId={selectedSlotId}
                                         setErr={setErr}
                                         hasMultipleTabs={hasMultipleTabs}
                                         selectedNav={selectedNav}
                                         setSelectedNav={setSelectedNav}
                                />
                    }
                </Root>
            </ThemeProvider>
        </StyledEngineProvider>
    );
};

export default App;