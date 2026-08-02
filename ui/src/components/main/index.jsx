import Header from "../Header";
import Filter from "./Filter";
import WhatsNew from "./WhatsNew";
import UpdateAvailableSnack from "./UpdateAvailableSnack";
import PythonVersionWarningSnack from "./PythonVersionWarningSnack";
import {Box, CircularProgress, Grid} from "@mui/material";
import React, {lazy, Suspense, useEffect, useMemo, useState} from "react";
import {debounce} from "lodash/function";
import {pushData, useLocalStorage} from "../../services/util";
import Slots from "./Slots";
import Entry from "./Entry";
import Search from "./Search";
import Footer from "./Footer";
import ezbeq from "../../services/ezbeq";

// pulls in @mui/x-data-grid, the single biggest chunk in the bundle - loading it lazily lets the
// app shell paint before it's fetched/parsed, which matters on the weak wifi/CPU of a Pi-hosted server
const Catalogue = lazy(() => import("./Catalogue"));

const catalogueFallback =
    <Box sx={{display: 'flex', justifyContent: 'center', p: 4}}>
        <CircularProgress size={28}/>
    </Box>;

const TWO_WEEKS_AGO_SECS = () => Math.floor(Date.now() / 1000) - 2 * 7 * 24 * 60 * 60;

// exported for direct testing, independent of the rest of MainView's heavy child tree
export const computeNewCount = (recentEntries, lastChecked) =>
    recentEntries.filter(e => Math.max(e.created_at || 0, e.updated_at || 0) >= lastChecked).length;

export const txtMatch = (entry, txtFilter) => {
    const matchOn = txtFilter.toLowerCase();
    if (entry.formattedTitle.toLowerCase().includes(matchOn)) {
        return true;
    }
    if (entry.hasOwnProperty('altTitle') && entry.altTitle.toLowerCase().includes(matchOn)) {
        return true;
    }
    if (entry.hasOwnProperty('collection') && entry.collection.toLowerCase().includes(matchOn)) {
        return true;
    }
    return false;
};

// catalogue filter: entry passes only if it satisfies every selected filter dimension
export const isMatch = (entry, filters) => {
    const {
        selectedAuthors, selectedYears, selectedAudioTypes, selectedContentTypes,
        selectedFreshness, selectedLanguages, debouncedTxtFilter
    } = filters;
    if (selectedAuthors.length && selectedAuthors.indexOf(entry.author) === -1) return false;
    if (selectedYears.length && selectedYears.indexOf(entry.year) === -1) return false;
    if (selectedAudioTypes.length && !entry.audioTypes.some(at => selectedAudioTypes.indexOf(at) > -1)) return false;
    if (selectedContentTypes.length && selectedContentTypes.indexOf(entry.contentType) === -1) return false;
    if (selectedFreshness.length && selectedFreshness.indexOf(entry.freshness) === -1) return false;
    if (selectedLanguages.length && selectedLanguages.indexOf(entry.language) === -1) return false;
    if (debouncedTxtFilter && !txtMatch(entry, debouncedTxtFilter)) return false;
    return true;
};

// null means "leave the current text filter alone" - only a genuinely loaded slot should
// overwrite whatever the user may have typed
export const deriveTxtFilterFromActiveSlot = (device, userDriven, selectedSlotId) => {
    if (!device || !userDriven || !device.hasOwnProperty('slots')) return null;
    const slot = device.slots.find(s => s.id === selectedSlotId);
    if (slot && slot.last && slot.last !== 'ERROR' && slot.last !== 'Empty') {
        return slot.last;
    }
    return null;
};

const MainView = ({
                      entries,
                      availableDevices,
                      setErr,
                      setSuccess,
                      replaceDevice,
                      selectedDeviceName,
                      setSelectedDeviceName,
                      selectedSlotId,
                      setSelectedSlotId,
                      useWide,
                      setSelectedNav,
                      selectedNav,
                      meta
                  }) => {
    const [selectedAuthors, setSelectedAuthors] = useLocalStorage('selectedAuthors', []);
    const [selectedLanguages, setSelectedLanguages] = useState([]);
    const [selectedYears, setSelectedYears] = useState([]);
    const [selectedAudioTypes, setSelectedAudioTypes] = useState([]);
    const [selectedContentTypes, setSelectedContentTypes] = useState([]);
    const [selectedFreshness, setSelectedFreshness] = useState([]);
    const [txtFilter, setTxtFilter] = useState('');
    const [debouncedTxtFilter, setDebouncedTxtFilter] = useState('');
    const [showFilters, setShowFilters] = useState(false);
    const [selectedEntryId, setSelectedEntryId] = useState(-1);
    const [userDriven, setUserDriven] = useState(false);
    const [filteredEntries, setFilteredEntries] = useState([]);
    const [uploadPendingSlotId, setUploadPendingSlotId] = useState(null);

    // whats new
    const [lastChecked, setLastChecked] = useLocalStorage('whatsNewLastChecked', TWO_WEEKS_AGO_SECS());
    const [recentEntries, setRecentEntries] = useState([]);
    const [whatsNewOpen, setWhatsNewOpen] = useState(false);

    useEffect(() => {
        pushData(setRecentEntries, () => ezbeq.getWhatsNew(), setErr);
    }, [meta]);

    const newCount = computeNewCount(recentEntries, lastChecked);

    // outdated version / unsupported python notices
    const [versionInfo, setVersionInfo] = useState({});
    const [dismissedUpdateVersion, setDismissedUpdateVersion] = useLocalStorage('dismissedUpdateVersion', null);
    const [dismissedPythonWarningVersion, setDismissedPythonWarningVersion] = useLocalStorage('dismissedPythonWarningVersion', null);

    useEffect(() => {
        pushData(setVersionInfo, () => ezbeq.getVersion(), setErr);
    }, []);

    const updateAvailable = !!(versionInfo.updateAvailable && versionInfo.latestVersion && versionInfo.latestVersion !== dismissedUpdateVersion);
    const pythonUnsupported = versionInfo.pythonSupported === false && versionInfo.minPythonVersion !== dismissedPythonWarningVersion;

    const dismissUpdate = () => setDismissedUpdateVersion(versionInfo.latestVersion);
    const dismissPythonWarning = () => setDismissedPythonWarningVersion(versionInfo.minPythonVersion);

    const openWhatsNew = () => {
        if (whatsNewOpen) {
            setWhatsNewOpen(false);
        } else {
            setWhatsNewOpen(true);
            setLastChecked(Math.floor(Date.now() / 1000));
        }
    };

    const toggleShowFilters = () => {
        setShowFilters((prev) => !prev);
    };

    const debounceTxtFilter = useMemo(() => debounce(v => setDebouncedTxtFilter(v), 300), []);

    useEffect(() => {
        debounceTxtFilter(txtFilter);
    }, [txtFilter, debounceTxtFilter]);

    useEffect(() => {
        if (availableDevices) {
            const deviceNames = Object.keys(availableDevices);
            if (deviceNames.length > 0 && !selectedDeviceName) {
                setSelectedDeviceName(deviceNames[0]);
            }
        }
    }, [availableDevices, selectedDeviceName, setSelectedDeviceName]);

    useEffect(() => {
        const filters = {
            selectedAuthors, selectedYears, selectedAudioTypes, selectedContentTypes,
            selectedFreshness, selectedLanguages, debouncedTxtFilter
        };
        pushData(setFilteredEntries, () => entries.filter(e => isMatch(e, filters)), setErr);
    }, [entries, selectedAudioTypes, selectedYears, selectedAuthors, selectedContentTypes, selectedFreshness, selectedLanguages, debouncedTxtFilter, setErr]);

    useEffect(() => {
        const next = deriveTxtFilterFromActiveSlot(availableDevices[selectedDeviceName], userDriven, selectedSlotId);
        if (next) {
            setTxtFilter(next);
        }
    }, [availableDevices, selectedDeviceName, selectedSlotId, setTxtFilter, userDriven]);

    const selectedEntry = useMemo(
        () => selectedEntryId ? entries.find(e => e.id === selectedEntryId) : null,
        [entries, selectedEntryId]
    );

    const devices = <Slots selectedDevice={availableDevices[selectedDeviceName]}
                           selectedEntryId={selectedEntryId}
                           selectedSlotId={selectedSlotId}
                           useWide={useWide}
                           setSelectedSlotId={setSelectedSlotId}
                           setUserDriven={setUserDriven}
                           setDevice={d => replaceDevice(d)}
                           setError={setErr}
                           setSuccess={setSuccess}
                           uploadPendingSlotId={uploadPendingSlotId}/>;
    const catalogue =
        <Suspense fallback={catalogueFallback}>
            <Catalogue entries={filteredEntries}
                       setSelectedEntryId={setSelectedEntryId}
                       selectedEntryId={selectedEntryId}
                       useWide={useWide}
                       selectedDevice={availableDevices[selectedDeviceName]}/>
        </Suspense>;
    const entry = <Entry selectedDevice={availableDevices[selectedDeviceName]}
                         selectedEntry={selectedEntry}
                         useWide={useWide}
                         setDevice={d => replaceDevice(d)}
                         selectedSlotId={selectedSlotId}
                         setError={setErr}
                         setSuccess={setSuccess}
                         setUploadPendingSlotId={setUploadPendingSlotId}/>;
    const footer = <Footer meta={meta}/>;
    return (
        <>
            <Header availableDevices={availableDevices}
                    setSelectedDeviceName={setSelectedDeviceName}
                    selectedDeviceName={selectedDeviceName}
                    selectedNav={selectedNav}
                    setSelectedNav={setSelectedNav}
                    whatsNewCount={newCount + (updateAvailable ? 1 : 0) + (pythonUnsupported ? 1 : 0)}
                    onWhatsNewOpen={openWhatsNew}>
                <Search txtFilter={txtFilter}
                        setTxtFilter={setTxtFilter}
                        showFilters={showFilters}
                        toggleShowFilters={toggleShowFilters}/>
            </Header>
            {whatsNewOpen && <WhatsNew onClose={() => setWhatsNewOpen(false)} entries={recentEntries}
                      lastChecked={lastChecked}
                      initialMode={newCount > 0 ? 'new' : 'recent'}
                      onSelect={id => setSelectedEntryId(id)}
                      updateInfo={{latestVersion: versionInfo.latestVersion, updateAvailable}}
                      onDismissUpdate={dismissUpdate}
                      pythonInfo={{pythonVersion: versionInfo.pythonVersion, minPythonVersion: versionInfo.minPythonVersion, pythonUnsupported}}
                      onDismissPythonWarning={dismissPythonWarning}/>}
            <UpdateAvailableSnack updateAvailable={updateAvailable}
                                   latestVersion={versionInfo.latestVersion}
                                   onDismiss={dismissUpdate}/>
            <PythonVersionWarningSnack pythonUnsupported={pythonUnsupported}
                                        pythonVersion={versionInfo.pythonVersion}
                                        minPythonVersion={versionInfo.minPythonVersion}
                                        onDismiss={dismissPythonWarning}/>
            <Filter visible={showFilters}
                    selectedAudioTypes={selectedAudioTypes}
                    setSelectedAudioTypes={setSelectedAudioTypes}
                    selectedFreshness={selectedFreshness}
                    setSelectedFreshness={setSelectedFreshness}
                    selectedYears={selectedYears}
                    setSelectedYears={setSelectedYears}
                    selectedLanguages={selectedLanguages}
                    setSelectedLanguages={setSelectedLanguages}
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
                        <Grid size={{ xs: 6, md: 6 }}>
                            {devices}
                            <Grid container>
                                {catalogue}
                            </Grid>
                            <Grid container>
                                {footer}
                            </Grid>
                        </Grid>
                        <Grid size={{ xs: 6, md: 6 }}>
                            {entry}
                        </Grid>
                    </Grid>
                    :
                    <>
                        {devices}
                        {catalogue}
                        {entry}
                        {footer}
                    </>
            }
        </>
    )
};

export default MainView;