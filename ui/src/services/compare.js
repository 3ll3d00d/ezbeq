// candidates share a title, everything else is decided per pair by sameRelease
const titleKey = e => (e.title || '').toLowerCase();

// the TMDb id identifies the release when both entries have one, and does so even when the content types disagree
// because the catalogue has entries tagged with the wrong one (e.g. a film tagged as TV with no season), otherwise
// fall back to the content type and year. Two TV entries must also be the same season since each season is its own
// soundtrack.
const sameRelease = (a, b) => {
    if (a.theMovieDB && b.theMovieDB) {
        if (a.theMovieDB !== b.theMovieDB) return false;
    } else if (a.contentType !== b.contentType || (a.year || '') !== (b.year || '')) {
        return false;
    }
    return a.contentType !== 'TV' || b.contentType !== 'TV' || (a.season || '') === (b.season || '');
};

// built once per catalogue so finding matches for a selection doesn't scan every entry
export const buildCompareIndex = entries => {
    const index = new Map();
    (entries || []).forEach(e => {
        const key = titleKey(e);
        const group = index.get(key);
        if (group) group.push(e); else index.set(key, [e]);
    });
    return index;
};

// other entries for the same title which share at least one audio track with the selected entry
export const findComparable = (selectedEntry, index) => {
    if (!selectedEntry || !index) return [];
    const audioTypes = new Set(selectedEntry.audioTypes || []);
    return (index.get(titleKey(selectedEntry)) || []).filter(e => e.id !== selectedEntry.id
        && sameRelease(selectedEntry, e)
        && (e.audioTypes || []).some(a => audioTypes.has(a)));
};
