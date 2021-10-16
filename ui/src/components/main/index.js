import Header from "../Header";
import Filter from "./Filter";
import {Grid} from "@material-ui/core";
import React, {useEffect, useState} from "react";
import {pushData} from "../../services/util";
import useMediaQuery from "@material-ui/core/useMediaQuery";
import Slots from "./Slots";
import Catalogue from "./Catalogue";
import Entry from "./Entry";
import Search from "./Search";

const MainView = ({
                      entries,
                      availableDevices,
                      setErr,
                      replaceDevice,
                      selectedDeviceName,
                      setSelectedDeviceName,
                      showBottomNav,
                      selectedSlotId,
                      setSelectedSlotId,
                      getSelectedDevice
                  }) => {
    const [selectedAuthors, setSelectedAuthors] = useState([]);
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
        if (availableDevices && !selectedDeviceName) {
            const deviceNames = Object.keys(availableDevices);
            if (deviceNames.length > 0) {
                setSelectedDeviceName(deviceNames[0]);
            }
        }
    }, [availableDevices, selectedDeviceName, setSelectedDeviceName]);

    useEffect(() => {
        const txtMatch = e => {
            const matchOn = txtFilter.toLowerCase()
            if (e.formattedTitle.toLowerCase().includes(matchOn)) {
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
                                 useWide={useWide}
                                 showBottomNav={showBottomNav}/>;
    const entry = <Entry selectedDeviceName={selectedDeviceName}
                         selectedEntry={selectedEntryId ? entries.find(e => e.id === selectedEntryId) : null}
                         useWide={useWide}
                         setDevice={d => replaceDevice(d)}
                         selectedSlotId={selectedSlotId}
                         device={getSelectedDevice()}
                         setError={setErr}/>;

    return (
        <>
            <Header availableDeviceNames={Object.keys(availableDevices)}
                    setSelectedDeviceName={setSelectedDeviceName}
                    selectedDeviceName={selectedDeviceName}>
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
        </>
    )
};

export default MainView;