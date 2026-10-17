import type { CatalogueEntry } from '../types/ezbeq';

// Ported from ui/src/services/compare.js.

// candidates share a content type and title, and a season for TV since each season is its own soundtrack
const groupKey = (e: CatalogueEntry): string =>
  `${e.contentType}|${(e.title || '').toLowerCase()}|${e.contentType === 'TV' ? e.season || '' : ''}`;

// the TMDb id identifies the release when both entries have one, otherwise fall back to the year
const sameRelease = (a: CatalogueEntry, b: CatalogueEntry): boolean =>
  a.theMovieDB && b.theMovieDB ? a.theMovieDB === b.theMovieDB : (a.year || '') === (b.year || '');

export type CompareIndex = Map<string, CatalogueEntry[]>;

// built once per catalogue so finding matches for a selection doesn't scan every entry
export const buildCompareIndex = (entries: CatalogueEntry[] | null | undefined): CompareIndex => {
  const index: CompareIndex = new Map();
  (entries || []).forEach((e) => {
    const key = groupKey(e);
    const group = index.get(key);
    if (group) group.push(e);
    else index.set(key, [e]);
  });
  return index;
};

// other entries for the same title which share at least one audio track with the selected entry
export const findComparable = (
  selectedEntry: CatalogueEntry | null | undefined,
  index: CompareIndex | null | undefined
): CatalogueEntry[] => {
  if (!selectedEntry || !index) return [];
  const audioTypes = new Set(selectedEntry.audioTypes || []);
  return (index.get(groupKey(selectedEntry)) || []).filter(
    (e) =>
      e.id !== selectedEntry.id && sameRelease(selectedEntry, e) && (e.audioTypes || []).some((a) => audioTypes.has(a))
  );
};
