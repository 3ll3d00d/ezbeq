import React, {useCallback, useEffect, useState} from 'react';
import {createMuiTheme, makeStyles, ThemeProvider} from '@material-ui/core/styles';
import ezbeq from './services/ezbeq';
import useMediaQuery from '@material-ui/core/useMediaQuery';
import CssBaseline from '@material-ui/core/CssBaseline';
import {pushData} from "./services/util";
import Footer from "./components/Footer";
import {BottomNavigation, BottomNavigationAction} from "@material-ui/core";
import LocalLibraryIcon from '@material-ui/icons/LocalLibrary';
import EqualizerIcon from '@material-ui/icons/Equalizer';
import SettingsApplicationsIcon from '@material-ui/icons/SettingsApplications';
import ErrorSnack from "./components/ErrorSnack";
import MainView from "./components/main";
import Levels from "./components/levels";
import Minidsp from "./components/minidsp";

const useStyles = makeStyles((theme) => ({
    root: {
        flexGrow: 1,
        width: '100vw',
        height: '100vh',
    }
}));

const ws = new WebSocket("ws://" + window.location.host + "/ws");

const App = () => {
    const prefersDarkMode = useMediaQuery('(prefers-color-scheme: dark)');
    const theme = React.useMemo(
        () =>
            createMuiTheme({
                palette: {
                    type: prefersDarkMode ? 'dark' : 'light',
                },
            }),
        [prefersDarkMode],
    );

    const replaceDevice = replacement => {
        setAvailableDevices(Object.assign({}, availableDevices, {[replacement.name]: replacement}));
    };

    ws.onmessage = event => {
        replaceDevice(JSON.parse(event.data));
    };

    const classes = useStyles();
    const [showBottomNav, setShowBottomNav] = useState(false);
    // errors
    const [err, setErr] = useState(null);
    // catalogue data
    const [entries, setEntries] = useState([]);
    // device state
    const [availableDevices, setAvailableDevices] = useState({});
    const [selectedSlotId, setSelectedSlotId] = useState(null);
    // view selection
    const [selectedDeviceName, setSelectedDeviceName] = useState('');
    const [selectedNav, setSelectedNav] = useState('catalogue');

    // initial data load
    useEffect(() => {
        pushData(setEntries, ezbeq.load, setErr);
    }, []);

    useEffect(() => {
        pushData(setAvailableDevices, ezbeq.getDevices, setErr);
    }, []);

    useEffect(() => {
        setShowBottomNav([...Object.keys(availableDevices)].find(k => availableDevices[k].hasOwnProperty('masterVolume')));
    }, [availableDevices, setShowBottomNav]);

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

    return (
        <ThemeProvider theme={theme}>
            <CssBaseline/>
            <div className={classes.root}>
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
                                  showBottomNav={showBottomNav}/>
                        :
                        selectedNav === 'levels'
                            ?
                            <Levels availableDevices={availableDevices}
                                    selectedDeviceName={selectedDeviceName}
                                    setSelectedDeviceName={setSelectedDeviceName}
                                    setErr={setErr}/>
                            :
                            <Minidsp availableDevices={availableDevices}
                                     selectedDeviceName={selectedDeviceName}
                                     setSelectedDeviceName={setSelectedDeviceName}
                                     selectedSlotId={selectedSlotId}
                                     setErr={setErr}/>
                }
                {
                    showBottomNav
                        ?
                        <BottomNavigation value={selectedNav}
                                          onChange={(event, newValue) => {
                                              setSelectedNav(newValue);
                                          }}>
                            <BottomNavigationAction label="Catalogue" value="catalogue" icon={<LocalLibraryIcon/>}/>
                            <BottomNavigationAction label="Levels" value="levels" icon={<EqualizerIcon/>}/>
                            <BottomNavigationAction label="Control" value="control" icon={<SettingsApplicationsIcon/>}/>
                        </BottomNavigation>
                        : null
                }
                <Footer/>
            </div>
        </ThemeProvider>
    );
};

export default App;