import {describe, expect, it} from 'vitest';
import {computeNewCount, deriveTxtFilterFromActiveSlot, isMatch, txtMatch} from './index';

describe('computeNewCount', () => {
    it('counts entries created or updated at or after lastChecked', () => {
        const entries = [
            {id: 1, created_at: 100},
            {id: 2, updated_at: 200},
            {id: 3, created_at: 50, updated_at: 99}
        ];
        expect(computeNewCount(entries, 100)).toBe(2);
    });

    it('treats a missing created_at/updated_at as 0', () => {
        expect(computeNewCount([{id: 1}], 0)).toBe(1);
        expect(computeNewCount([{id: 1}], 1)).toBe(0);
    });
});

describe('txtMatch', () => {
    it('matches on formattedTitle case-insensitively', () => {
        expect(txtMatch({formattedTitle: 'Some Movie'}, 'movie')).toBe(true);
        expect(txtMatch({formattedTitle: 'Some Movie'}, 'xyz')).toBe(false);
    });

    it('matches on altTitle when present', () => {
        expect(txtMatch({formattedTitle: 'A', altTitle: 'Alt Name'}, 'alt')).toBe(true);
    });

    it('matches on collection when present', () => {
        expect(txtMatch({formattedTitle: 'A', collection: 'Trilogy'}, 'trilogy')).toBe(true);
    });

    it('does not match altTitle/collection when the entry does not have them', () => {
        expect(txtMatch({formattedTitle: 'A'}, 'alt')).toBe(false);
    });
});

describe('isMatch', () => {
    const noFilters = {
        selectedAuthors: [], selectedYears: [], selectedAudioTypes: [], selectedContentTypes: [],
        selectedFreshness: [], selectedLanguages: [], debouncedTxtFilter: ''
    };
    const entry = {
        formattedTitle: 'Some Movie', author: 'author1', year: 2020,
        audioTypes: ['Atmos'], contentType: 'film', freshness: 'new', language: 'English'
    };

    it('matches everything when no filters are set', () => {
        expect(isMatch(entry, noFilters)).toBe(true);
    });

    it('excludes an entry whose author is not in the selected authors', () => {
        expect(isMatch(entry, {...noFilters, selectedAuthors: ['someone-else']})).toBe(false);
        expect(isMatch(entry, {...noFilters, selectedAuthors: ['author1']})).toBe(true);
    });

    it('excludes an entry whose year is not in the selected years', () => {
        expect(isMatch(entry, {...noFilters, selectedYears: [1999]})).toBe(false);
        expect(isMatch(entry, {...noFilters, selectedYears: [2020]})).toBe(true);
    });

    it('matches an audio type filter against any of the entry\'s audio types', () => {
        expect(isMatch(entry, {...noFilters, selectedAudioTypes: ['DTS:X']})).toBe(false);
        expect(isMatch(entry, {...noFilters, selectedAudioTypes: ['DTS:X', 'Atmos']})).toBe(true);
    });

    it('excludes an entry whose content type is not selected', () => {
        expect(isMatch(entry, {...noFilters, selectedContentTypes: ['tv']})).toBe(false);
    });

    it('excludes an entry whose freshness is not selected', () => {
        expect(isMatch(entry, {...noFilters, selectedFreshness: ['stale']})).toBe(false);
    });

    it('excludes an entry whose language is not selected', () => {
        expect(isMatch(entry, {...noFilters, selectedLanguages: ['French']})).toBe(false);
    });

    it('applies the text filter only when every other selected dimension already matches', () => {
        const filters = {...noFilters, selectedAuthors: ['author1'], debouncedTxtFilter: 'movie'};
        expect(isMatch(entry, filters)).toBe(true);
        expect(isMatch(entry, {...filters, debouncedTxtFilter: 'no-match'})).toBe(false);
    });

    it('requires every selected dimension to pass simultaneously', () => {
        const filters = {
            ...noFilters,
            selectedAuthors: ['author1'], // matches
            selectedYears: [1999] // does not match
        };
        expect(isMatch(entry, filters)).toBe(false);
    });
});

describe('deriveTxtFilterFromActiveSlot', () => {
    const deviceWithSlot = (last) => ({
        name: 'd1',
        slots: [{id: '1', last}]
    });

    it('returns null when there is no device', () => {
        expect(deriveTxtFilterFromActiveSlot(null, true, '1')).toBeNull();
    });

    it('returns null when the change was not user-driven', () => {
        expect(deriveTxtFilterFromActiveSlot(deviceWithSlot('Some Filter'), false, '1')).toBeNull();
    });

    it('returns null when the device has no slots (not a filter-capable device)', () => {
        expect(deriveTxtFilterFromActiveSlot({name: 'd1'}, true, '1')).toBeNull();
    });

    it('returns null for an empty or errored slot rather than overwriting the search text', () => {
        expect(deriveTxtFilterFromActiveSlot(deviceWithSlot('Empty'), true, '1')).toBeNull();
        expect(deriveTxtFilterFromActiveSlot(deviceWithSlot('ERROR'), true, '1')).toBeNull();
    });

    it("returns the active slot's last-loaded filter name when user-driven", () => {
        expect(deriveTxtFilterFromActiveSlot(deviceWithSlot('Avengers Endgame'), true, '1')).toBe('Avengers Endgame');
    });
});
