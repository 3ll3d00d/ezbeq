import Header from "../Header";
import Filter from "./Filter";
import {Grid} from "@mui/material";
import React, {useEffect, useState} from "react";
import {pushData, useLocalStorage} from "../../services/util";
import Slots from "./Slots";
import Catalogue from "./Catalogue";
import Entry from "./Entry";
import Search from "./Search";
import Footer from "./Footer";

const MainView = ({
                      entries,
                      availableDevices,
                      setErr,
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
    const [showFilters, setShowFilters] = useState(false);
    const [selectedEntryId, setSelectedEntryId] = useState(-1);
    const [userDriven, setUserDriven] = useState(false);
    const [filteredEntries, setFilteredEntries] = useState([]);

    const toggleShowFilters = () => {
        setShowFilters((prev) => !prev);
    };

    useEffect(() => {
        if (availableDevices) {
            const deviceNames = Object.keys(availableDevices);
            if (deviceNames.length > 0 && !selectedDeviceName) {
                setSelectedDeviceName(deviceNames[0]);
            }
        }
    }, [availableDevices, selectedDeviceName, setSelectedDeviceName]);

    useEffect(() => {
        const txtMatch = e => {
            const matchOn = txtFilter.toLowerCase()
            if (e.formattedTitle.toLowerCase().includes(matchOn)) {
                return true;
            }
            if (e.hasOwnProperty('altTitle') && e.altTitle.toLowerCase().includes(matchOn)) {
                return true;
            }
            if (e.hasOwnProperty('collection') && e.collection.toLowerCase().includes(matchOn)) {
                return true;
            }
            return false;
        }

        // catalogue filter
        const isMatch = (entry) => {
            if (!selectedAuthors.length || selectedAuthors.indexOf(entry.author) > -1) {
                if (!selectedYears.length || selectedYears.indexOf(entry.year) > -1) {
                    if (!selectedAudioTypes.length || entry.audioTypes.some(at => selectedAudioTypes.indexOf(at) > -1)) {
                        if (!selectedContentTypes.length || selectedContentTypes.indexOf(entry.contentType) > -1) {
                            if (!selectedFreshness.length || selectedFreshness.indexOf(entry.freshness) > -1) {
                                if (!selectedLanguages.length || selectedLanguages.indexOf(entry.language) > -1) {
                                    if (!txtFilter || txtMatch(entry)) {
                                        return true;
                                    }
                                }
                            }
                        }
                    }
                }
            }
            return false;
        }
        pushData(setFilteredEntries, () => entries.filter(isMatch), setErr);
    }, [entries, selectedAudioTypes, selectedYears, selectedAuthors, selectedContentTypes, selectedFreshness, selectedLanguages, txtFilter, setErr]);

    useEffect(() => {
        const d = availableDevices[selectedDeviceName];
        if (d && userDriven && d.hasOwnProperty('slots')) {
            const slot = d.slots.find(s => s.id === selectedSlotId);
            if (slot && slot.last && slot.last !== "ERROR" && slot.last !== "Empty") {
                setTxtFilter(slot.last);
            }
        }
    }, [availableDevices, selectedDeviceName, selectedSlotId, setTxtFilter, userDriven]);

    const devices = <Slots selectedDevice={availableDevices[selectedDeviceName]}
                           selectedEntryId={selectedEntryId}
                           selectedSlotId={selectedSlotId}
                           useWide={useWide}
                           setSelectedSlotId={setSelectedSlotId}
                           setUserDriven={setUserDriven}
                           setDevice={d => replaceDevice(d)}
                           setError={setErr}/>;
    const catalogue = <Catalogue entries={filteredEntries}
                                 setSelectedEntryId={setSelectedEntryId}
                                 selectedEntryId={selectedEntryId}
                                 useWide={useWide}
                                 selectedDevice={availableDevices[selectedDeviceName]}/>;
    const entry = <Entry selectedDevice={availableDevices[selectedDeviceName]}
                         selectedEntry={selectedEntryId ? entries.find(e => e.id === selectedEntryId) : null}
                         useWide={useWide}
                         setDevice={d => replaceDevice(d)}
                         selectedSlotId={selectedSlotId}
                         setError={setErr}/>;
    const footer = <Footer meta={meta}/>;
    return (
        <>
            <Header availableDevices={availableDevices}
                    setSelectedDeviceName={setSelectedDeviceName}
                    selectedDeviceName={selectedDeviceName}
                    selectedNav={selectedNav}
                    setSelectedNav={setSelectedNav}>
                <Search txtFilter={txtFilter}
                        setTxtFilter={setTxtFilter}
                        showFilters={showFilters}
                        toggleShowFilters={toggleShowFilters}/>
            </Header>
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
                        </Grid>r
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