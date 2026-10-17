import { buildCompareIndex, findComparable } from './compare';
import type { CatalogueEntry } from '../types/ezbeq';

// Ported from ui/src/services/compare.test.js.
const entry = (id: number, overrides: Partial<CatalogueEntry> = {}): CatalogueEntry => ({
  id,
  title: 'Some Movie',
  formattedTitle: 'Some Movie',
  year: 2020,
  contentType: 'film',
  theMovieDB: '123',
  author: 'a1',
  audioTypes: ['Atmos'],
  ...overrides,
});

const comparable = (selected: CatalogueEntry | null, entries?: CatalogueEntry[]) =>
  findComparable(selected, buildCompareIndex(entries));

describe('findComparable', () => {
  const selected = entry(0, { audioTypes: ['Atmos', 'DTS-X'] });

  it('returns nothing without a selection or an index', () => {
    expect(comparable(null, [entry(1)])).toEqual([]);
    expect(findComparable(selected, undefined)).toEqual([]);
    expect(comparable(selected, undefined)).toEqual([]);
  });

  it('matches the same title with an intersecting audio track, excluding the selection itself', () => {
    const matches = [entry(1, { author: 'a2' }), entry(2, { title: 'SOME MOVIE', audioTypes: ['DTS-X'] })];
    const others = [
      entry(10, { audioTypes: ['DD+'] }),
      entry(11, { title: 'Other Movie' }),
      entry(12, { theMovieDB: '999' }),
      entry(13, { contentType: 'TV' }),
      entry(14, { audioTypes: undefined as unknown as string[] }),
      entry(15, { title: undefined }),
    ];
    expect(comparable(selected, [selected, ...matches, ...others])).toEqual(matches);
  });

  it('falls back to the year when either entry has no TMDb id', () => {
    const noTmdb = entry(0, { theMovieDB: undefined });
    const sameYear = entry(1, { theMovieDB: undefined });
    const sameYearWithTmdb = entry(2);
    const otherYear = entry(10, { theMovieDB: undefined, year: 1999 });
    const otherYearWithTmdb = entry(11, { year: 1999 });
    expect(comparable(noTmdb, [sameYear, sameYearWithTmdb, otherYear, otherYearWithTmdb])).toEqual([
      sameYear,
      sameYearWithTmdb,
    ]);
    expect(comparable(sameYearWithTmdb, [noTmdb, otherYear])).toEqual([noTmdb]);
  });

  it('only matches the same season of a TV show', () => {
    const tv = (id: number, season: string | undefined, overrides: Partial<CatalogueEntry> = {}) =>
      entry(id, { contentType: 'TV', season, ...overrides });
    const selectedTv = tv(0, '1', { episode: '1' });
    const sameSeason = [tv(1, '1', { episode: '1' }), tv(2, '1', { episode: '2', author: 'a2' })];
    expect(comparable(selectedTv, [selectedTv, ...sameSeason, tv(10, '2'), tv(11, undefined)])).toEqual(sameSeason);
  });
});
