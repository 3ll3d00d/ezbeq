// candidates share a content type and title, and a season for TV since each season is its own soundtrack
const groupKey = e => `${e.contentType}|${(e.title || '').toLowerCase()}|${e.contentType === 'TV' ? e.season || '' : ''}`;

// the TMDb id identifies the release when both entries have one, otherwise fall back to the year
const sameRelease = (a, b) => a.theMovieDB && b.theMovieDB
    ? a.theMovieDB === b.theMovieDB
    : (a.year || '') === (b.year || '');

// built once per catalogue so finding matches for a selection doesn't scan every entry
export const buildCompareIndex = entries => {
    const index = new Map();
    (entries || []).forEach(e => {
        const key = groupKey(e);
        const group = index.get(key);
        if (group) group.push(e); else index.set(key, [e]);
    });
    return index;
};

// other entries for the same title which share at least one audio track with the selected entry
export const findComparable = (selectedEntry, index) => {
    if (!selectedEntry || !index) return [];
    const audioTypes = new Set(selectedEntry.audioTypes || []);
    return (index.get(groupKey(selectedEntry)) || []).filter(e => e.id !== selectedEntry.id
        && sameRelease(selectedEntry, e)
        && (e.audioTypes || []).some(a => audioTypes.has(a)));
};
