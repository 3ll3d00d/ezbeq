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

const wsProtocol = `ws${window.location.protocol === 'https:' ? 's' : ''}`;
const ss = new StateService(`${wsProtocol}://${window.location.host}/ws`);

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

    // catalogue data
    const [entries, setEntries] = useState({});
    const [meta, setMeta] = useState({});
    const [version, setVersion] = useState(null);

    // view selection
    const [selectedDeviceName, setSelectedDeviceName] = useState(null);
    const [selectedNav, setSelectedNav] = useState('catalogue');

    // device state
    const [availableDevices, setAvailableDevices] = useState({});
    const [selectedSlotId, setSelectedSlotId] = useState(null);

    const replaceDevice = useMemo(() => replacement => {
        setAvailableDevices(Object.assign({}, availableDevices, {[replacement.name]: replacement}));
    }, [setAvailableDevices, availableDevices]);

    const loadEntries = useMemo(() => newEntries => {
        setEntries(e => {
            const prefix = `${version}_`;
            const current = e ? Object.fromEntries(Object.entries(e).filter(([key]) => key.startsWith(prefix))) : {};
            return Object.assign({}, current, newEntries)
        });
    }, [version, setEntries, entries]);

    useEffect(() => {
        if (meta && (!version || meta.version !== version)) {
            setVersion(meta.version);
        }
    }, [meta, version, setVersion]);

    useEffect(() => {
        ss.init(setErr, replaceDevice, setMeta, loadEntries);
    }, [setErr, replaceDevice, setMeta, loadEntries]);

    const levelsService = useMemo(() => {
        return new LevelsService(setErr, `${wsProtocol}://${window.location.host}/ws`, theme);
    }, [setErr]);

    // load when version changes
    useEffect(() => {
        if (version) {
            ss.loadCatalogue();
        }
    }, [version]);

    useEffect(() => {
        levelsService.loadDevices(Object.keys(availableDevices));
    }, [levelsService, availableDevices]);

    useEffect(() => {
        pushData(setAvailableDevices, ezbeq.getDevices, setErr);
    }, []);

    useEffect(() => {
        if (selectedDeviceName && availableDevices[selectedDeviceName].hasOwnProperty('slots')) {
            const slot = availableDevices[selectedDeviceName].slots.find(s => s.active === true);
            if (slot) {
                setSelectedSlotId(slot.id);
            }
        }
    }, [selectedDeviceName, availableDevices]);

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
                            <MainView entries={Object.keys(entries).map(e => entries[e])}
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
                                      selectedDeviceName={selectedDeviceName}
                                      setSelectedDeviceName={setSelectedDeviceName}
                                      selectedSlotId={selectedSlotId}
                                      setSelectedSlotId={setSelectedSlotId}
                                      useWide={useWide}
                                      selectedNav={selectedNav}
                                      setSelectedNav={setSelectedNav}
                                      meta={meta}
                            />
                            :
                            selectedNav === 'levels'
                                ?
                                <Levels availableDevices={availableDevices}
                                        selectedDeviceName={selectedDeviceName}
                                        setSelectedDeviceName={setSelectedDeviceName}
                                        levelsService={levelsService}
                                        selectedNav={selectedNav}
                                        setSelectedNav={setSelectedNav}
                                        theme={theme}
                                />
                                :
                                <Minidsp availableDevices={availableDevices}
                                         selectedDeviceName={selectedDeviceName}
                                         setSelectedDeviceName={setSelectedDeviceName}
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