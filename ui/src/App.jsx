import React, {useEffect, useMemo, useState} from 'react';
import { styled } from '@mui/material/styles';
import {createTheme, StyledEngineProvider, ThemeProvider} from '@mui/material/styles';
import ezbeq from './services/ezbeq';
import useMediaQuery from '@mui/material/useMediaQuery';
import CssBaseline from '@mui/material/CssBaseline';
import {pushData} from "./services/util";
import ErrorSnack from "./components/ErrorSnack";
import SuccessSnack from "./components/SuccessSnack";
import DeviceDisconnectedBanner from "./components/DeviceDisconnectedBanner";
import MainView from "./components/main";
import Levels from "./components/levels";
import Minidsp from "./components/minidsp";
import LevelsService from "./services/levels";
import StateService from "./services/state";

const PREFIX = 'App';

const classes = {
    root: `${PREFIX}-root`
};

const StyledStyledEngineProvider = styled(StyledEngineProvider)((
    {
        theme
    }
) => ({
    [`& .${classes.root}`]: {
        flexGrow: 1,
        width: '100%',
        height: '100%'
    }
}));

const Root = ({children}) => {

    return (
        <div className={classes.root}>
            {children}
        </div>
    )
}

const wsProtocol = `ws${window.location.protocol === 'https:' ? 's' : ''}`;
const ss = new StateService(`${wsProtocol}://${window.location.host}/ws`);

// exported for testing in isolation from the rest of App's rendering/singleton wiring
//
// Only ever updates an already-known device, never adds one: a composite fanning an op out to
// its members (e.g. activating a slot) makes each member broadcast its own DeviceState over the
// websocket too, same as if it had been addressed directly - but a member hidden from the
// selector (composite exposeMembers: false, the default) was deliberately left out of the
// /api/2/devices response this state was seeded from, so it must stay out here as well, or it
// reappears in the selector the moment any op is applied to the composite it belongs to.
export const mergeDeviceByName = (devices, replacement) =>
    devices.hasOwnProperty(replacement.name) ? Object.assign({}, devices, {[replacement.name]: replacement}) : devices;

// a REST poll response is stale by the time it lands once the websocket is up (it'll have
// already pushed a DeviceState message), so only apply it while the socket is down
export const shouldAcceptRestDeviceUpdate = (stateService) => !(stateService && stateService.isConnected());

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

    // errors and success
    const [err, setErr] = useState(null);
    const [successMsg, setSuccessMsg] = useState(null);

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

    // Uses the functional setState form (reading the freshest state at apply time) rather than
    // closing over `availableDevices` - a composite fans one op out to N members, each of which
    // broadcasts its own DeviceState close enough together that several `replaceDevice` calls can
    // land before a re-render lets this closure see the previous one's result. With a closed-over
    // `availableDevices`, each of those calls would merge against the same stale snapshot and only
    // the last one applied would survive, silently dropping every other member's update.
    const replaceDevice = useMemo(() => replacement => {
        setAvailableDevices(current => mergeDeviceByName(current, replacement));
    }, [setAvailableDevices]);

    const loadEntries = useMemo(() => newEntries => {
        setEntries(e => {
            const prefix = `${version}_`;
            const current = e ? Object.fromEntries(Object.entries(e).filter(([key]) => key.startsWith(prefix))) : {};
            return Object.assign({}, current, newEntries)
        });
    }, [version, setEntries]);

    const entryList = useMemo(() => Object.values(entries), [entries]);

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
        // loadDevices does its own Object.keys(...) internally (see Chart.jsx's call, and
        // levels.js) - passing Object.keys(availableDevices) here double-extracts, registering
        // bogus index-keyed pseudo-devices ('0', '1', ...) instead of the real device names
        levelsService.loadDevices(availableDevices);
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
        <StyledStyledEngineProvider injectFirst>
            <ThemeProvider theme={theme}>
                <CssBaseline/>
                <Root>
                    <ErrorSnack err={err} setErr={setErr}/>
                    <SuccessSnack msg={successMsg} setMsg={setSuccessMsg}/>
                    {
                        selectedDeviceName && availableDevices[selectedDeviceName]?.connected === false
                            ? <DeviceDisconnectedBanner deviceName={selectedDeviceName}/>
                            : null
                    }
                    {
                        selectedNav === 'catalogue'
                            ?
                            <MainView entries={entryList}
                                      setErr={setErr}
                                      setSuccess={setSuccessMsg}
                                      replaceDevice={d => {
                                          if (shouldAcceptRestDeviceUpdate(ss)) {
                                              console.debug(`Accepting update, ws is disconnected`);
                                              replaceDevice(d);
                                          } else {
                                              console.debug(`Discarding update, ws is connected`);
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
        </StyledStyledEngineProvider>
    );
};

export default App;