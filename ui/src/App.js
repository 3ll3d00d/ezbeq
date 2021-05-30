import React, {useEffect, useState} from 'react';
import {createMuiTheme, makeStyles, ThemeProvider} from '@material-ui/core/styles';
import ezbeq from './services/ezbeq';
import useMediaQuery from '@material-ui/core/useMediaQuery';
import CssBaseline from '@material-ui/core/CssBaseline';
import Header from "./components/Header";
import {pushData} from "./services/util";
import Footer from "./components/Footer";
import Catalogue from "./components/Catalogue";
import Devices from "./components/Devices";
import Filter from "./components/Filter";
import Entry from "./components/Entry";
import {Grid} from "@material-ui/core";
import ErrorSnack from "./components/ErrorSnack";

const useStyles = makeStyles((theme) => ({
    root: {
        flexGrow: 1,
        width: '100vw',
        height: '100vh',
        '& > *': {
            margin: theme.spacing(1),
        }
    }
}));

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

    const classes = useStyles();
    // errors
    const [err, setErr] = useState(null);
    // catalogue data
    const [entries, setEntries] = useState([]);
    const [filteredEntries, setFilteredEntries] = useState([]);
    // device state
    const [device, setDevice] = useState({});
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

    useEffect(() => {
        if (device && device.hasOwnProperty('slots')) {
            const slot = device.slots.find(s => s.active === true);
            if (slot) {
                setSelectedSlotId(slot.id);
            }
        }
    }, [device]);

    // initial data load
    useEffect(() => {
        pushData(setEntries, ezbeq.load, setErr);
    }, []);

    useEffect(() => {
        pushData(setDevice, ezbeq.getDeviceConfig, setErr);
    }, []);

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
        if (userDriven && device && device.hasOwnProperty('slots')) {
            const slot = device.slots.find(s => s.id === selectedSlotId);
            if (slot && slot.last && slot.last !== "ERROR" && slot.last !== "Empty") {
                setTxtFilter(slot.last);
            }
        }
    }, [device, selectedSlotId, setTxtFilter, userDriven]);
    const useWide = useMediaQuery('(orientation: landscape) and (min-height: 580px)');
    const devices = <Devices selectedEntryId={selectedEntryId}
                             selectedSlotId={selectedSlotId}
                             useWide={useWide}
                             setSelectedSlotId={setSelectedSlotId}
                             setUserDriven={setUserDriven}
                             device={device}
                             setDevice={setDevice}
                             setError={setErr}/>;
    const catalogue = <Catalogue entries={filteredEntries}
                                 setSelectedEntryId={setSelectedEntryId}
                                 selectedEntryId={selectedEntryId}
                                 useWide={useWide}/>;
    const entry = <Entry selectedEntry={selectedEntryId ? entries.find(e => e.id === selectedEntryId) : null}
                         useWide={useWide}
                         setDevice={setDevice}
                         selectedSlotId={selectedSlotId}
                         device={device}
                         setError={setErr}/>;
    return (
        <ThemeProvider theme={theme}>
            <CssBaseline/>
            <div className={classes.root}>
                <ErrorSnack err={err} setErr={setErr}/>
                <Header txtFilter={txtFilter}
                        setTxtFilter={setTxtFilter}
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