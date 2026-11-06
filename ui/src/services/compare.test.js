import {describe, expect, it} from 'vitest';
import {buildCompareIndex, findComparable} from './compare';

const entry = (id, overrides = {}) => ({
    id, title: 'Some Movie', year: 2020, contentType: 'film', theMovieDB: '123', author: 'a1',
    audioTypes: ['Atmos'], ...overrides
});

const comparable = (selected, entries) => findComparable(selected, buildCompareIndex(entries));

describe('findComparable', () => {
    const selected = entry('s', {audioTypes: ['Atmos', 'DTS-X']});

    it('returns nothing without a selection or an index', () => {
        expect(comparable(null, [entry('x')])).toEqual([]);
        expect(findComparable(selected, undefined)).toEqual([]);
        expect(comparable(selected, undefined)).toEqual([]);
    });

    it('matches the same title with an intersecting audio track, excluding the selection itself', () => {
        const matches = [entry('m1', {author: 'a2'}), entry('m2', {title: 'SOME MOVIE', audioTypes: ['DTS-X']})];
        const others = [
            entry('o1', {audioTypes: ['DD+']}),
            entry('o2', {title: 'Other Movie'}),
            entry('o3', {theMovieDB: '999'}),
            entry('o5', {audioTypes: undefined}),
            entry('o6', {title: undefined})
        ];
        expect(comparable(selected, [selected, ...matches, ...others])).toEqual(matches);
    });

    it('falls back to the year when either entry has no TMDb id', () => {
        const noTmdb = entry('s', {theMovieDB: undefined});
        const sameYear = entry('m1', {theMovieDB: undefined});
        const sameYearWithTmdb = entry('m2');
        const otherYear = entry('o1', {theMovieDB: undefined, year: 1999});
        const otherYearWithTmdb = entry('o2', {year: 1999});
        expect(comparable(noTmdb, [sameYear, sameYearWithTmdb, otherYear, otherYearWithTmdb]))
            .toEqual([sameYear, sameYearWithTmdb]);
        expect(comparable(sameYearWithTmdb, [noTmdb, otherYear])).toEqual([noTmdb]);
    });

    it('only matches the same season of a TV show', () => {
        const tv = (id, season, overrides = {}) => entry(id, {contentType: 'TV', season, ...overrides});
        const selectedTv = tv('s', '1', {episode: '1'});
        const sameSeason = [tv('m1', '1', {episode: '1'}), tv('m2', '1', {episode: '2', author: 'a2'})];
        expect(comparable(selectedTv, [selectedTv, ...sameSeason, tv('o1', '2'), tv('o2', undefined)])).toEqual(sameSeason);
    });

    it('matches across content types when the TMDb id agrees, since the catalogue has mislabelled entries', () => {
        const filmTaggedAsTv = entry('m1', {contentType: 'TV', season: '', author: 'a2'});
        const tvWithSeason = entry('m2', {contentType: 'TV', season: '1', author: 'a3'});
        const otherTmdb = entry('o1', {contentType: 'TV', season: '1', theMovieDB: '999'});
        const noTmdb = entry('o2', {contentType: 'TV', theMovieDB: undefined});
        expect(comparable(selected, [filmTaggedAsTv, tvWithSeason, otherTmdb, noTmdb]))
            .toEqual([filmTaggedAsTv, tvWithSeason]);
        expect(comparable(filmTaggedAsTv, [selected])).toEqual([selected]);
    });

    it('still requires the same content type when falling back to the year', () => {
        const noTmdb = entry('s', {theMovieDB: undefined});
        const tv = entry('o1', {contentType: 'TV', theMovieDB: undefined});
        expect(comparable(noTmdb, [tv])).toEqual([]);
    });

    it('treats a missing year or season as empty', () => {
        const noYear = (id, overrides = {}) => entry(id, {theMovieDB: undefined, year: undefined, ...overrides});
        expect(comparable(noYear('s'), [noYear('m1'), entry('o1', {theMovieDB: undefined})])).toEqual([noYear('m1')]);
        const tv = (id, season) => entry(id, {contentType: 'TV', season});
        expect(comparable(tv('s', undefined), [tv('m1', undefined), tv('o1', '1')])).toEqual([tv('m1', undefined)]);
        expect(comparable(tv('s', '1'), [tv('o1', undefined)])).toEqual([]);
    });

    it('matches nothing when the selection has no audio tracks', () => {
        expect(comparable(entry('s', {audioTypes: undefined}), [entry('o1')])).toEqual([]);
    });
});
