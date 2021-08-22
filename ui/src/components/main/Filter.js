import MultiSelect from "./MultiSelect";
import React, {useEffect, useState} from "react";
import {pushData} from "../../services/util";
import ezbeq from "../../services/ezbeq";

const Filter = ({
                    visible,
                    selectedAudioTypes,
                    setSelectedAudioTypes,
                    selectedFreshness,
                    setSelectedFreshness,
                    selectedYears,
                    setSelectedYears,
                    selectedLanguages,
                    setSelectedLanguages,
                    selectedAuthors,
                    setSelectedAuthors,
                    selectedContentTypes,
                    setSelectedContentTypes,
                    filteredEntries,
                    setError
                }) => {

    const freshness = ['Fresh', 'Updated', 'Stale'];
    const [authors, setAuthors] = useState([]);
    const [languages, setLanguages] = useState([]);
    const [years, setYears] = useState([]);
    const [audioTypes, setAudioTypes] = useState([]);
    const [contentTypes, setContentTypes] = useState([]);
    const [filteredYears, setFilteredYears] = useState([]);
    const [filteredAudioTypes, setFilteredAudioTypes] = useState([]);
    const [filteredLanguages, setFilteredLanguages] = useState([]);
    const [filteredFreshness, setFilteredFreshness] = useState([]);

    useEffect(() => {
        pushData(setAuthors, ezbeq.getAuthors, setError);
    }, [setError]);

    useEffect(() => {
        pushData(setLanguages, ezbeq.getLanguages, setError);
    }, [setError]);

    useEffect(() => {
        pushData(setYears, ezbeq.getYears, setError);
    }, [setError]);

    useEffect(() => {
        pushData(setAudioTypes, ezbeq.getAudioTypes, setError);
    }, [setError]);

    useEffect(() => {
        pushData(setContentTypes, ezbeq.getContentTypes, setError);
    }, [setError]);

    useEffect(() => {
        pushData(setFilteredYears, () => [...new Set(filteredEntries.map(e => e.year))], setError);
        pushData(setFilteredAudioTypes, () => [...new Set(filteredEntries.map(e => e.audioTypes).flat())], setError);
        pushData(setFilteredFreshness, () => [...new Set(filteredEntries.map(e => e.freshness).flat())], setError);
        pushData(setFilteredLanguages, () => [...new Set(filteredEntries.map(e => e.language))], setError);
    }, [filteredEntries, setError]);

    const addSelectedAudioTypes = values => {
        const matches = audioTypes.filter(at => values.some(v => v === at || at.toLowerCase().indexOf(v.toLowerCase()) > -1));
        setSelectedAudioTypes(matches);
    };

    const addSelectedFreshness = values => {
        const matches = freshness.filter(at => values.some(v => v === at || at.toLowerCase().indexOf(v.toLowerCase()) > -1));
        setSelectedFreshness(matches);
    };

    const addSelectedYears = values => {
        const matches = years.filter(y => values.some(v => v === y || `${y}`.indexOf(v) > -1));
        setSelectedYears(matches);
    };

    const addSelectedLanguages = values => {
        const matches = languages.filter(at => values.some(v => v === at || at.toLowerCase().indexOf(v.toLowerCase()) > -1));
        setSelectedLanguages(matches);
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
                <MultiSelect items={freshness}
                             selectedValues={selectedFreshness}
                             label="Fresh"
                             onToggleOption={selected => setSelectedFreshness(selected)}
                             onCreateOption={value => addSelectedFreshness(value)}
                             onClearOptions={() => setSelectedFreshness([])}
                             isInView={v => filteredFreshness.length === 0 || filteredFreshness.indexOf(v) > -1}/>
                <MultiSelect items={languages}
                             selectedValues={selectedLanguages}
                             label="Language"
                             onToggleOption={selected => setSelectedLanguages(selected)}
                             onCreateOption={value => addSelectedLanguages(value)}
                             onClearOptions={() => setSelectedLanguages([])}
                             isInView={v => filteredLanguages.length === 0 || filteredLanguages.indexOf(v) > -1}/>
            </>
        )
    } else {
        return null;
    }
};

export default Filter;