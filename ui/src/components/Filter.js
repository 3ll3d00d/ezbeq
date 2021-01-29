import MultiSelect from "./MultiSelect";
import React, {useEffect, useState} from "react";
import {pushData} from "../services/util";
import ezbeq from "../services/ezbeq";

const Filter = ({
                    visible,
                    selectedAudioTypes,
                    setSelectedAudioTypes,
                    selectedYears,
                    setSelectedYears,
                    selectedAuthors,
                    setSelectedAuthors,
                    selectedContentTypes,
                    setSelectedContentTypes,
                    filteredEntries
                }) => {

    const [authors, setAuthors] = useState([]);
    const [years, setYears] = useState([]);
    const [audioTypes, setAudioTypes] = useState([]);
    const [contentTypes, setContentTypes] = useState([]);
    const [filteredYears, setFilteredYears] = useState([]);
    const [filteredAudioTypes, setFilteredAudioTypes] = useState([]);

    useEffect(() => {
        pushData(setAuthors, ezbeq.getAuthors);
    }, []);

    useEffect(() => {
        pushData(setYears, ezbeq.getYears);
    }, []);

    useEffect(() => {
        pushData(setAudioTypes, ezbeq.getAudioTypes);
    }, []);

    useEffect(() => {
        pushData(setContentTypes, ezbeq.getContentTypes);
    }, []);

    useEffect(() => {
        pushData(setFilteredYears, () => [...new Set(filteredEntries.map(e => e.year))]);
        pushData(setFilteredAudioTypes, () => [...new Set(filteredEntries.map(e => e.audioTypes).flat())]);
    }, [filteredEntries]);

    const addSelectedAudioTypes = values => {
        const matches = audioTypes.filter(at => values.some(v => v === at || at.toLowerCase().indexOf(v.toLowerCase()) > -1));
        setSelectedAudioTypes(matches);
    };

    const addSelectedYears = values => {
        const matches = years.filter(y => values.some(v => v === y || `${y}`.indexOf(v) > -1));
        setSelectedYears(matches);
    };

    if (visible) {
        return (
            <>
                <MultiSelect items={contentTypes}
                             selectedValues={selectedContentTypes}
                             label="Content Types"
                             onToggleOption={selected => setSelectedContentTypes(selected)}
                             onClearOptions={() => setSelectedContentTypes([])}/>
                <MultiSelect items={authors}
                             selectedValues={selectedAuthors}
                             label="Author"
                             onToggleOption={selected => setSelectedAuthors(selected)}
                             onClearOptions={() => setSelectedAuthors([])}/>
                <MultiSelect items={years}
                             selectedValues={selectedYears}
                             label="Year"
                             onToggleOption={selected => setSelectedYears(selected)}
                             onCreateOption={value => addSelectedYears(value)}
                             onClearOptions={() => setSelectedYears([])}
                             getOptionLabel={o => `${o}`}
                             isInView={v => filteredYears.length === 0 || filteredYears.indexOf(v) > -1}/>
                <MultiSelect items={audioTypes}
                             selectedValues={selectedAudioTypes}
                             label="Audio Types"
                             onToggleOption={selected => setSelectedAudioTypes(selected)}
                             onCreateOption={value => addSelectedAudioTypes(value)}
                             onClearOptions={() => setSelectedAudioTypes([])}
                             isInView={v => filteredAudioTypes.length === 0 || filteredAudioTypes.indexOf(v) > -1}/>
            </>
        )
    } else {
        return null;
    }
};

export default Filter;