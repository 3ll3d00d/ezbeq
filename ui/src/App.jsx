import React, {useEffect, useMemo, useState} from 'react';
import {createTheme, StyledEngineProvider, ThemeProvider} from '@mui/material/styles';
import {makeStyles} from '@mui/styles';
import ezbeq from './services/ezbeq';
import useMediaQuery from '@mui/material/useMediaQuery';
import CssBaseline from '@mui/material/CssBaseline';
import {pushData} from "./services/util";
import ErrorSnack from "./components/ErrorSnack";
import MainView from "./components/main";
import Levels from "./components/levels";
import Minidsp from "./components/minidsp";
import LevelsService from "./services/levels";
import StateService from "./services/state";

const useStyles = makeStyles((theme) => ({
    root: {
        flexGrow: 1,
        width: '100%',
        height: '100%'
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

const ss = new StateService(`ws://${window.location.host}/ws`);

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

    // errors
    const [err, setErr] = useState(null);

    // device state
    const [availableDevices, setAvailableDevices] = useState({});
    const [selectedSlotId, setSelectedSlotId] = useState(null);

    const replaceDevice = useMemo(() => replacement => {
        setAvailableDevices(Object.assign({}, availableDevices, {[replacement.name]: replacement}));
    }, [setAvailableDevices, availableDevices]);

    useEffect(() => {
        ss.init(setErr, replaceDevice);
    }, [setErr, replaceDevice]);

    // catalogue data
    const [entries, setEntries] = useState([]);
    // view selection
    const [selectedDevice, setSelectedDevice] = useState(null);
    const [selectedNav, setSelectedNav] = useState('catalogue');

    const levelsService = useMemo(() => {
        return new LevelsService(setErr, `ws://${window.location.host}/ws`, theme);
    }, [setErr]);

    // initial data load
    useEffect(() => {
        pushData(setEntries, ezbeq.load, setErr);
    }, []);

    useEffect(() => {
        levelsService.loadDevices(Object.keys(availableDevices));
    }, [levelsService, availableDevices]);

    useEffect(() => {
        pushData(setAvailableDevices, ezbeq.getDevices, setErr);
    }, []);

    useEffect(() => {
        if (selectedDevice && selectedDevice.hasOwnProperty('slots')) {
            const slot = selectedDevice.slots.find(s => s.active === true);
            if (slot) {
                setSelectedSlotId(slot.id);
            }
        }
    }, [selectedDevice, availableDevices]);

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
                                      replaceDevice={d => {
                                          if (ss && ss.isConnected()) {
                                              console.debug(`Discarding update, ws is connected`);
                                          } else {
                                              console.debug(`Accepting update, ws is disconnected`);
                                              replaceDevice(d);
                                          }
                                      }}
                                      availableDevices={availableDevices}
                                      selectedDevice={selectedDevice}
                                      setSelectedDevice={setSelectedDevice}
                                      selectedSlotId={selectedSlotId}
                                      setSelectedSlotId={setSelectedSlotId}
                                      useWide={useWide}
                                      selectedNav={selectedNav}
                                      setSelectedNav={setSelectedNav}
                            />
                            :
                            selectedNav === 'levels'
                                ?
                                <Levels availableDevices={availableDevices}
                                        selectedDevice={selectedDevice}
                                        setSelectedDevice={setSelectedDevice}
                                        levelsService={levelsService}
                                        selectedNav={selectedNav}
                                        setSelectedNav={setSelectedNav}
                                        theme={theme}
                                />
                                :
                                <Minidsp availableDevices={availableDevices}
                                         selectedDevice={selectedDevice}
                                         setSelectedDevice={setSelectedDevice}
                                         selectedSlotId={selectedSlotId}
                                         setErr={setErr}
                                         selectedNav={selectedNav}
                                         setSelectedNav={setSelectedNav}
                                         theme={theme}
                                />
                    }
                </Root>
            </ThemeProvider>
        </StyledEngineProvider>
    );
};

export default App;