import React, {useEffect, useState} from 'react';
import {useValueChange} from "./components/valueState";
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
    // catalogue data
    const [entries, setEntries] = useState([]);
    const [filteredEntries, setFilteredEntries] = useState([]);
    // user selections
    const [selectedAuthors, setSelectedAuthors] = useState([]);
    const [selectedYears, setSelectedYears] = useState([]);
    const [selectedAudioTypes, setSelectedAudioTypes] = useState([]);
    const [selectedContentTypes, setSelectedContentTypes] = useState([]);
    const [txtFilter, handleTxtFilterChange] = useValueChange('');
    const [showFilters, setShowFilters] = useState(false);
    const [selectedEntryId, setSelectedEntryId] = useState(-1);

    const toggleShowFilters = () => {
        setShowFilters((prev) => !prev);
    };

    // initial data load
    useEffect(() => {
        pushData(setEntries, ezbeq.load);
    }, []);

    useEffect(() => {
        // catalogue filter
        const isMatch = (entry) => {
            if (!selectedAuthors.length || selectedAuthors.indexOf(entry.author) > -1) {
                if (!selectedYears.length || selectedYears.indexOf(entry.year) > -1) {
                    if (!selectedAudioTypes.length || entry.audioTypes.some(at => selectedAudioTypes.indexOf(at) > -1)) {
                        if (!selectedContentTypes.length || selectedContentTypes.indexOf(entry.contentType) > -1) {
                            if (!txtFilter || entry.title.toLowerCase().includes(txtFilter.toLowerCase())) {
                                return true;
                            }
                        }
                    }
                }
            }
            return false;
        }
        pushData(setFilteredEntries, () => entries.filter(isMatch));
    }, [entries, selectedAudioTypes, selectedYears, selectedAuthors, selectedContentTypes, txtFilter]);
    const useWide = useMediaQuery('(orientation: landscape) and (min-height: 580px)');
    const devices = <Devices selectedEntryId={selectedEntryId} useWide={useWide}/>;
    const catalogue = <Catalogue entries={filteredEntries}
                                 setSelectedEntryId={setSelectedEntryId}
                                 selectedEntryId={selectedEntryId}
                                 useWide={useWide}/>;
    const entry = <Entry selectedEntry={selectedEntryId ? filteredEntries.find(e => e.id === selectedEntryId) : null} useWide={useWide}/>;
    return (
        <ThemeProvider theme={theme}>
            <CssBaseline/>
            <div className={classes.root}>
                <Header txtFilter={txtFilter}
                        handleTxtFilterChange={handleTxtFilterChange}
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
                        filteredEntries={filteredEntries}/>
                {
                    useWide
                        ?
                        <Grid container>
                            <Grid item xs={6} md={6}>
                                <Grid container>
                                    {devices}
                                </Grid>
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