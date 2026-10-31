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
import {isOptimisable, OPTIMISED, useOptimisedEntryIds} from "./Optimisation";
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

// punctuation is mostly ignored when searching. Apostrophes are dropped, so Ocean's is found by oceans
// and its s doesn't start a word. Other punctuation between two words becomes a GAP, which a search
// matches with a space or nothing, so Spider-Man is found by spiderman, spider man or spider-man and
// Mission: Impossible by mission impossible. Punctuation in the search still ranks titles with a word
// break in the same place first (see PUNCTUATION_DIFFERS). Listed explicitly rather than via regex
// unicode property escapes; this covers every regex special character so a search never needs escaping
const APOSTROPHES = /['`\u00b4\u02bc\u2018\u2019]/g;
const PUNCTUATION = /[!-/:-@[-`{-~\u00a1\u00ab\u00b7\u00bb\u00bf\u00d7\u2010-\u2027\u2030-\u205e]+/g;
const GAP = '\u0000';

// lower case, apostrophes dropped, punctuation next to whitespace or at either end dropped, punctuation
// between two words reduced to a GAP, whitespace collapsed. The search and every title are normalised
// the same way; titles are cached as each search checks the same ones over and over
const normalised = new Map();
const normaliseText = text => {
    let n = normalised.get(text);
    if (n === undefined) {
        n = text.toLowerCase().replace(APOSTROPHES, '').replace(PUNCTUATION, GAP)
            .replace(/[\s\u0000]*\s[\s\u0000]*/g, ' ').replace(/^[ \u0000]+|[ \u0000]+$/g, '');
        if (normalised.size > 50000) normalised.clear();
        normalised.set(text, n);
    }
    return n;
};

// q must come from normaliseText. The text may have a GAP between any two characters of q, a space
// in q needs a space or GAP, and so does a GAP in q when the punctuation must match, else it's optional
const searchPattern = (q, punctuationMustMatch) => new RegExp(
    q.split(GAP)
        .map(part => Array.from(part).map(c => c === ' ' ? '[ \u0000]' : c).join('\u0000?'))
        .join(punctuationMustMatch ? '[ \u0000]' : '[ \u0000]?'),
    'g');

// letters (anything with case) and digits, enough to find word boundaries without regex unicode
// property escapes; spaces, GAPs and any symbol PUNCTUATION doesn't list (e.g. a superscript 3 or a trademark sign) are not
const isWordChar = c => c !== undefined && (c.toLowerCase() !== c.toUpperCase() || (c >= '0' && c <= '9'));

// the search and its patterns, compiled once per search rather than per entry
let compiled = null;
const compileSearch = txtFilter => {
    if (compiled?.txtFilter !== txtFilter) {
        const q = normaliseText(txtFilter);
        compiled = {
            txtFilter,
            q,
            // a search of nothing but punctuation is matched literally
            literal: txtFilter.trim().toLowerCase(),
            strict: q ? searchPattern(q, true) : null,
            loose: q ? searchPattern(q, false) : null,
            hasPunctuation: q.includes(GAP),
        };
    }
    return compiled;
};

export const hasSearch = txtFilter => !!compileSearch(txtFilter).q;

const matchesAny = (texts, pattern) => texts.some(t => {
    if (!t) return false;
    pattern.lastIndex = 0;
    return pattern.test(normaliseText(t));
});

export const txtMatch = (entry, txtFilter) => {
    const {literal, loose} = compileSearch(txtFilter);
    const texts = [entry.formattedTitle, entry.altTitle, entry.collection];
    if (loose) return matchesAny(texts, loose);
    return texts.some(t => t && t.toLowerCase().includes(literal));
};

// a leading article is ignored, as a library files titles, so The Thing starts with Thing
const LEADING_ARTICLE = /^(?:the|a|an)\s+/;
const withoutArticle = t => t.replace(LEADING_ARTICLE, '');

// while searching, the list is ordered by the best reason each entry matches, each group alphabetical.
// The title (or the altTitle, which exists to catch such searches) is checked for how it matches, so
// "thing" lists The Thing, then Swamp Thing, then Things Heard & Seen, then Stranger Things, then
// Something in the Water, then anything only matched on its collection. When the search has
// punctuation, every entry with a word break where the search has punctuation comes first, in those
// groups, then the entries without one, in the same groups offset by PUNCTUATION_DIFFERS, so
// spider-man lists Spider-Man, then The Amazing Spider-Man, then Spiderman
export const TITLE_STARTS_WITH_WORD = 0, HAS_WORD = 1, TITLE_STARTS = 2, WORD_STARTS = 3, TITLE_CONTAINS = 4,
    OTHER_MATCH = 5, PUNCTUATION_DIFFERS = 6;

const rankTitle = (title, pattern) => {
    const t = normaliseText(title);
    const titleStart = t.length - withoutArticle(t).length;
    let best = null;
    pattern.lastIndex = 0;
    for (let m = pattern.exec(t); m; pattern.lastIndex = m.index + 1, m = pattern.exec(t)) {
        const i = m.index;
        let rank = TITLE_CONTAINS;
        if (!isWordChar(t[i - 1])) {
            const atTitleStart = i === 0 || i === titleStart;
            if (!isWordChar(t[i + m[0].length])) {
                if (atTitleStart) return TITLE_STARTS_WITH_WORD;
                rank = HAS_WORD;
            } else {
                rank = atTitleStart ? TITLE_STARTS : WORD_STARTS;
            }
        }
        if (best === null || rank < best) best = rank;
    }
    return best;
};

// the best group the entry matches pattern in, null if it doesn't
const rankMatch = (entry, pattern) => {
    let rank = rankTitle(entry.formattedTitle, pattern);
    if (rank !== TITLE_STARTS_WITH_WORD && entry.altTitle) {
        const altRank = rankTitle(entry.altTitle, pattern);
        if (altRank !== null && (rank === null || altRank < rank)) rank = altRank;
    }
    if (rank !== null) return rank;
    return matchesAny([entry.collection], pattern) ? OTHER_MATCH : null;
};

// null means no match
export const matchRank = (entry, txtFilter) => {
    const {strict, loose, hasPunctuation} = compileSearch(txtFilter);
    if (!strict) return txtMatch(entry, txtFilter) ? OTHER_MATCH : null;
    const rank = rankMatch(entry, strict);
    if (rank !== null || !hasPunctuation) return rank;
    const looseRank = rankMatch(entry, loose);
    return looseRank === null ? null : looseRank + PUNCTUATION_DIFFERS;
};

// by match group then by the title as displayed (ignoring a leading article), year and author
export const sortByMatchRank = (entries, txtFilter) => {
    if (!hasSearch(txtFilter)) return entries;
    return entries
        .map(e => ({e, rank: matchRank(e, txtFilter) ?? OTHER_MATCH, title: withoutArticle(e.formattedTitle.toLowerCase())}))
        .sort((a, b) => a.rank - b.rank
            || a.title.localeCompare(b.title)
            || (a.e.year || 0) - (b.e.year || 0)
            || (a.e.author || '').localeCompare(b.e.author || ''))
        .map(({e}) => e);
};

// catalogue filter: entry passes only if it satisfies every selected filter dimension
export const isMatch = (entry, filters) => {
    const {
        selectedAuthors, selectedYears, selectedAudioTypes, selectedContentTypes,
        selectedFreshness, selectedLanguages, selectedFilterAuthors, debouncedTxtFilter,
        selectedOptimisation = null, optimisedIds = null
    } = filters;
    // optimisedIds is only loaded while searching on optimisation for a device which can be optimised
    if (selectedOptimisation && optimisedIds) {
        const optimised = optimisedIds.has(entry.id);
        if (selectedOptimisation === OPTIMISED ? !optimised : optimised) return false;
    }
    if (selectedAuthors.length && selectedAuthors.indexOf(entry.author) === -1) return false;
    if (selectedFilterAuthors.length && selectedFilterAuthors.indexOf(entry.filterAuthor) === -1) return false;
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
    const [selectedFilterAuthors, setSelectedFilterAuthors] = useLocalStorage('selectedFilterAuthors', []);
    const [selectedLanguages, setSelectedLanguages] = useState([]);
    const [selectedYears, setSelectedYears] = useState([]);
    const [selectedAudioTypes, setSelectedAudioTypes] = useState([]);
    const [selectedContentTypes, setSelectedContentTypes] = useState([]);
    const [selectedFreshness, setSelectedFreshness] = useState([]);
    const [selectedOptimisation, setSelectedOptimisation] = useState(null);
    const [txtFilter, setTxtFilter] = useState('');
    const [debouncedTxtFilter, setDebouncedTxtFilter] = useState('');
    const [showFilters, setShowFilters] = useState(false);
    const [selectedEntryId, setSelectedEntryId] = useState(-1);
    const [userDriven, setUserDriven] = useState(false);
    const [filteredEntries, setFilteredEntries] = useState([]);
    // set alongside filteredEntries so the grid only stops sorting by title once ranked rows arrive
    const [rankedBySearch, setRankedBySearch] = useState(false);
    const [uploadPendingSlotId, setUploadPendingSlotId] = useState(null);

    // whats new
    const [lastChecked, setLastChecked] = useLocalStorage('whatsNewLastChecked', TWO_WEEKS_AGO_SECS());
    const [recentEntries, setRecentEntries] = useState([]);
    const [whatsNewOpen, setWhatsNewOpen] = useState(false);

    useEffect(() => {
        pushData(setRecentEntries, () => ezbeq.getWhatsNew(), setErr);
    }, [meta]);

    const optimisedIds = useOptimisedEntryIds(availableDevices[selectedDeviceName], selectedOptimisation, meta, setErr);

    const filters = useMemo(() => ({
        selectedAuthors, selectedYears, selectedAudioTypes, selectedContentTypes,
        selectedFreshness, selectedLanguages, selectedFilterAuthors, debouncedTxtFilter,
        selectedOptimisation, optimisedIds
    }), [selectedAuthors, selectedYears, selectedAudioTypes, selectedContentTypes, selectedFreshness, selectedLanguages, selectedFilterAuthors, debouncedTxtFilter, selectedOptimisation, optimisedIds]);

    // What's New should only surface entries that also pass the catalogue filters, so the two
    // views never disagree about what's currently in scope
    const filteredRecentEntries = useMemo(
        () => recentEntries.filter(e => isMatch(e, filters)),
        [recentEntries, filters]
    );

    const newCount = computeNewCount(filteredRecentEntries, lastChecked);

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
        const txt = filters.debouncedTxtFilter;
        const setRanked = matches => {
            setFilteredEntries(matches);
            setRankedBySearch(hasSearch(txt));
        };
        pushData(setRanked, () => sortByMatchRank(entries.filter(e => isMatch(e, filters)), txt), setErr);
    }, [entries, filters, setErr]);

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
                       rankedBySearch={rankedBySearch}
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
                         setUploadPendingSlotId={setUploadPendingSlotId}
                         entries={entries}
                         setSelectedEntryId={setSelectedEntryId}/>;
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
            {whatsNewOpen && <WhatsNew onClose={() => setWhatsNewOpen(false)} entries={filteredRecentEntries}
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
                    selectedFilterAuthors={selectedFilterAuthors}
                    setSelectedFilterAuthors={setSelectedFilterAuthors}
                    selectedContentTypes={selectedContentTypes}
                    optimisable={isOptimisable(availableDevices[selectedDeviceName])}
                    selectedOptimisation={selectedOptimisation}
                    setSelectedOptimisation={setSelectedOptimisation}
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