import React, {useCallback, useEffect, useState} from 'react';
import {createMuiTheme, makeStyles, ThemeProvider} from '@material-ui/core/styles';
import ezbeq from './services/ezbeq';
import useMediaQuery from '@material-ui/core/useMediaQuery';
import CssBaseline from '@material-ui/core/CssBaseline';
import Header from "./components/Header";
import {pushData} from "./services/util";
import Footer from "./components/Footer";
import Catalogue from "./components/Catalogue";
import Slots from "./components/Slots";
import Filter from "./components/Filter";
import Entry from "./components/Entry";
import {Grid} from "@material-ui/core";
import ErrorSnack from "./components/ErrorSnack";

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
    // errors
    const [err, setErr] = useState(null);
    // catalogue data
    const [entries, setEntries] = useState([]);
    const [filteredEntries, setFilteredEntries] = useState([]);
    // device state
    const [availableDevices, setAvailableDevices] = useState({});
    const [selectedDeviceName, setSelectedDeviceName] = useState('');
    // user selections
    const [selectedAuthors, setSelectedAuthors] = useState([]);
    const [selectedYears, setSelectedYears] = useState([]);
    const [selectedAudioTypes, setSelectedAudioTypes] = useState([]);
    const [selectedContentTypes, setSelectedContentTypes] = useState([]);
    const [txtFilter, setTxtFilter] = useState('');
    const [showFilters, setShowFilters] = useState(false);
    const [selectedEntryId, setSelectedEntryId] = useState(-1);
    const [selectedSlotId, setSelectedSlotId] = useState(null);
    const [userDriven, setUserDriven] = useState(false);

    const toggleShowFilters = () => {
        setShowFilters((prev) => !prev);
    };

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

    // initial data load
    useEffect(() => {
        pushData(setEntries, ezbeq.load, setErr);
    }, []);

    useEffect(() => {
        pushData(setAvailableDevices, ezbeq.getDevices, setErr);
    }, []);

    useEffect(() => {
        if (availableDevices && !selectedDeviceName) {
            const deviceNames = Object.keys(availableDevices);
            if (deviceNames.length > 0) {
                setSelectedDeviceName(deviceNames[0]);
            }
        }
    }, [availableDevices, selectedDeviceName]);

    useEffect(() => {
        const txtMatch = e => {
            const matchOn = txtFilter.toLowerCase()
            if (e.title.toLowerCase().includes(matchOn)) {
                return true;
            } else if (e.hasOwnProperty('altTitle')) {
                if (e.altTitle.toLowerCase().includes(matchOn)) {
                    return true;
                }
            }
            return false;
        }

        // catalogue filter
        const isMatch = (entry) => {
            if (!selectedAuthors.length || selectedAuthors.indexOf(entry.author) > -1) {
                if (!selectedYears.length || selectedYears.indexOf(entry.year) > -1) {
                    if (!selectedAudioTypes.length || entry.audioTypes.some(at => selectedAudioTypes.indexOf(at) > -1)) {
                        if (!selectedContentTypes.length || selectedContentTypes.indexOf(entry.contentType) > -1) {
                            if (!txtFilter || txtMatch(entry)) {
                                return true;
                            }
                        }
                    }
                }
            }
            return false;
        }
        pushData(setFilteredEntries, () => entries.filter(isMatch), setErr);
    }, [entries, selectedAudioTypes, selectedYears, selectedAuthors, selectedContentTypes, txtFilter]);

    useEffect(() => {
        const d = getSelectedDevice();
        if (d && userDriven && d.hasOwnProperty('slots')) {
            const slot = d.slots.find(s => s.id === selectedSlotId);
            if (slot && slot.last && slot.last !== "ERROR" && slot.last !== "Empty") {
                setTxtFilter(slot.last);
            }
        }
    }, [getSelectedDevice, selectedSlotId, setTxtFilter, userDriven]);

    const useWide = useMediaQuery('(orientation: landscape) and (min-height: 580px)');
    const devices = <Slots selectedDeviceName={selectedDeviceName}
                           selectedEntryId={selectedEntryId}
                           selectedSlotId={selectedSlotId}
                           useWide={useWide}
                           setSelectedSlotId={setSelectedSlotId}
                           setUserDriven={setUserDriven}
                           device={getSelectedDevice()}
                           setDevice={d => replaceDevice(d)}
                           setError={setErr}/>;
    const catalogue = <Catalogue entries={filteredEntries}
                                 setSelectedEntryId={setSelectedEntryId}
                                 selectedEntryId={selectedEntryId}
                                 useWide={useWide}/>;
    const entry = <Entry selectedDeviceName={selectedDeviceName}
                         selectedEntry={selectedEntryId ? entries.find(e => e.id === selectedEntryId) : null}
                         useWide={useWide}
                         setDevice={d => replaceDevice(d)}
                         selectedSlotId={selectedSlotId}
                         device={getSelectedDevice()}
                         setError={setErr}/>;
    return (
        <ThemeProvider theme={theme}>
            <CssBaseline/>
            <div className={classes.root}>
                <ErrorSnack err={err} setErr={setErr}/>
                <Header txtFilter={txtFilter}
                        setTxtFilter={setTxtFilter}
                        availableDeviceNames={Object.keys(availableDevices)}
                        setSelectedDeviceName={setSelectedDeviceName}
                        selectedDeviceName={selectedDeviceName}
                        showFilters={showFilters}
                        toggleShowFilters={toggleShowFilters}/>
                <Filter visible={showFilters}
                        selectedAudioTypes={selectedAudioTypes}
                        setSelectedAudioTypes={setSelectedAudioTypes}
                        selectedYears={selectedYears}
                        setSelectedYears={setSelectedYears}
                        selectedAuthors={selectedAuthors}
                        setSelectedAuthors={setSelectedAuthors}
                        selectedContentTypes={selectedContentTypes}
                        setSelectedContentTypes={setSelectedContentTypes}
                        filteredEntries={filteredEntries}
                        setError={setErr}/>
                {
                    useWide
                        ?
                        <Grid container>
                            <Grid item xs={6} md={6}>
                                {devices}
                                <Grid container>
                                    {catalogue}
                                </Grid>
                            </Grid>
                            <Grid item xs={6} md={6}>
                                {entry}
                            </Grid>
                        </Grid>
                        :
                        <>
                            {devices}
                            {catalogue}
                            {entry}
                        </>
                }
                <Footer/>
            </div>
        </ThemeProvider>
    );
};

export default App;