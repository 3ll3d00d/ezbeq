import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';
import type { ReactElement } from 'react';

import CompareSheet, { maxDifference, optimisationResponses, variantLabel } from './CompareSheet';
import { coeffsFor } from '../../services/biquad';
import type { EzbeqApi } from '../../services/ezbeqApi';
import type { CatalogueEntry, EntryCoefficients, EntryFilters } from '../../types/ezbeq';

// Ported from ui/src/components/main/Compare.test.jsx.
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

// Modal renders through a Portal, which needs a provider
const renderInProvider = (element: ReactElement) => render(<PaperProvider>{element}</PaperProvider>);

const shelf = (gain: number) => ({ type: 'LowShelf', freq: 30, q: 0.707, gain, count: 1 });

describe('variantLabel', () => {
  it('describes season, episode and edition', () => {
    expect(variantLabel(entry(1))).toBe('');
    expect(variantLabel(entry(1, { season: '1', episode: '2', edition: 'Extended' }))).toBe('S1E2 • Extended');
    expect(variantLabel(entry(1, { season: '3' }))).toBe('S3');
  });
});

describe('maxDifference', () => {
  it('finds the largest absolute deviation and where it is', () => {
    expect(maxDifference([0, 0, 0], [1, -3, 2], [10, 20, 30])).toEqual({ db: -3, freq: 20 });
    expect(maxDifference([1, 1], [1, 1], [10, 20])).toEqual({ db: 0, freq: null });
  });
});

describe('CompareSheet', () => {
  const selected = entry(1, { author: 'mine', mvAdjust: -2 });
  const other = entry(2, { author: 'theirs', edition: 'Extended' });
  let getFilters: jest.Mock;

  const api = () => ({ getFilters }) as unknown as EzbeqApi;

  const renderSheet = async (props: Partial<Parameters<typeof CompareSheet>[0]> = {}) =>
    renderInProvider(
      <CompareSheet
        api={api()}
        selectedEntry={selected}
        matches={[other]}
        onSelect={jest.fn()}
        onClose={jest.fn()}
        onError={jest.fn()}
        {...props}
      />
    );

  // the chart only draws once it has been laid out
  const layoutChart = async () => {
    fireEvent(await screen.findByTestId('response-chart'), 'layout', {
      nativeEvent: { layout: { width: 300, height: 180 } },
    });
    await waitFor(() => expect(screen.queryAllByTestId(/^series-/).length).toBeGreaterThan(0));
  };

  // y of the first point in a series' path, "M x1 y1 ..."
  const firstY = (key: string) => Number(screen.getByTestId(`series-${key}`).props.d.slice(1).trim().split(/\s+/)[1]);

  beforeEach(() => {
    getFilters = jest.fn().mockResolvedValue([
      { id: '1', filters: [shelf(6)] },
      { id: '2', filters: [shelf(4), { ...shelf(1), count: 2 }] },
    ] as EntryFilters[]);
  });

  it('loads the filters for the selection and every match and plots their responses', async () => {
    await renderSheet();
    await layoutChart();
    expect(getFilters).toHaveBeenCalledWith(['1', '2']);
    expect(screen.getByTestId('series-1')).toBeTruthy();
    expect(screen.getByTestId('series-2')).toBeTruthy();
    expect(screen.getByLabelText('Frequency response chart, dB against Hz')).toBeTruthy();
  });

  it('summarises each entry', async () => {
    await renderSheet();
    await layoutChart();
    const mine = screen.getByTestId('compare-row-1');
    expect(within(mine).getByText('mine — Atmos')).toBeTruthy();
    expect(within(mine).getByText('MV -2.0 dB • 1 filters')).toBeTruthy();
    expect(within(mine).getByText('Selected')).toBeTruthy();
    const theirs = screen.getByTestId('compare-row-2');
    expect(within(theirs).getByText('theirs — Atmos')).toBeTruthy();
    expect(within(theirs).getByText(/^Extended • 3 filters • max diff .* dB @ \d+ Hz$/)).toBeTruthy();
  });

  it('shows a zero max diff for identical filters', async () => {
    getFilters.mockResolvedValue([
      { id: '1', filters: [shelf(6)] },
      { id: '2', filters: [shelf(6)] },
    ]);
    await renderSheet();
    expect(await within(screen.getByTestId('compare-row-2')).findByText('Extended • 1 filters • max diff 0.0 dB')).toBeTruthy();
  });

  it('plots the difference against the selection on request', async () => {
    await renderSheet();
    await layoutChart();
    const responseY = firstY('1');
    fireEvent.press(screen.getByText('Difference'));
    expect(await screen.findByLabelText('Frequency response chart, Δ dB against Hz')).toBeTruthy();
    // the selection is flat at zero, the match within a fraction of a dB of it at 1Hz
    expect(firstY('1')).not.toBe(responseY);
    expect(Math.abs(firstY('2') - firstY('1'))).toBeLessThan(10);
  });

  it('dashes the series once the colours run out', async () => {
    const many = Array.from({ length: 9 }, (_, i) => entry(10 + i, { author: `a${i}` }));
    getFilters.mockResolvedValue(['1', ...many.map((m) => String(m.id))].map((id) => ({ id, filters: [shelf(6)] })));
    await renderSheet({ matches: many });
    await layoutChart();
    expect(screen.getByTestId('series-17').props.strokeDasharray).toBeUndefined();
    expect(screen.getByTestId('series-18').props.strokeDasharray).toEqual([6, 4]);
  });

  it('selects a match and closes', async () => {
    const onSelect = jest.fn();
    const onClose = jest.fn();
    await renderSheet({ onSelect, onClose });
    fireEvent.press(within(screen.getByTestId('compare-row-2')).getByText('Select'));
    expect(onSelect).toHaveBeenCalledWith(2);
    expect(onClose).toHaveBeenCalled();
  });

  it('closes from the close button', async () => {
    const onClose = jest.fn();
    await renderSheet({ onClose });
    fireEvent.press(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('omits entries whose filters could not be found and disables difference without the selection', async () => {
    getFilters.mockResolvedValue([{ id: '2', filters: [shelf(4)] }]);
    await renderSheet();
    await layoutChart();
    expect(screen.queryByTestId('series-1')).toBeNull();
    expect(screen.getByTestId('series-2')).toBeTruthy();
    fireEvent.press(screen.getByText('Difference'));
    expect(screen.getByLabelText('Frequency response chart, dB against Hz')).toBeTruthy();
  });

  it('reports a failure to load filters', async () => {
    const err = new Error('boom');
    getFilters.mockRejectedValue(err);
    const onError = jest.fn();
    await renderSheet({ onError });
    expect(await screen.findByText('Unable to load filters')).toBeTruthy();
    expect(onError).toHaveBeenCalledWith(err);
  });

  it('only reloads filters when the entries being compared change', async () => {
    const props = { api: api(), onSelect: jest.fn(), onClose: jest.fn(), onError: jest.fn() };
    const { rerender } = await renderInProvider(<CompareSheet selectedEntry={selected} matches={[other]} {...props} />);
    await screen.findByTestId('response-chart');
    // e.g. a catalogue refresh, same ids but new objects
    await rerender(
      <PaperProvider>
        <CompareSheet selectedEntry={{ ...selected }} matches={[{ ...other }]} {...props} />
      </PaperProvider>
    );
    expect(getFilters).toHaveBeenCalledTimes(1);
    await rerender(
      <PaperProvider>
        <CompareSheet selectedEntry={selected} matches={[other, entry(3)]} {...props} />
      </PaperProvider>
    );
    await waitFor(() => expect(getFilters).toHaveBeenCalledTimes(2));
    expect(getFilters).toHaveBeenLastCalledWith(['1', '2', '3']);
  });

  it('ignores a response which arrives after closing', async () => {
    let reject: (e: Error) => void = () => {};
    getFilters.mockReturnValue(new Promise((_, r) => (reject = r)));
    const onError = jest.fn();
    const { unmount } = await renderSheet({ onError });
    await unmount();
    // let the rejection's handlers run before asserting they did nothing
    await act(async () => reject(new Error('late')));
    expect(onError).not.toHaveBeenCalled();
  });

  it('clears a failure once a later load of different entries succeeds', async () => {
    getFilters.mockRejectedValueOnce(new Error('boom'));
    const props = { api: api(), onSelect: jest.fn(), onClose: jest.fn(), onError: jest.fn() };
    const { rerender } = await renderInProvider(<CompareSheet selectedEntry={selected} matches={[other]} {...props} />);
    expect(await screen.findByText('Unable to load filters')).toBeTruthy();
    await rerender(
      <PaperProvider>
        <CompareSheet selectedEntry={selected} matches={[other, entry(3)]} {...props} />
      </PaperProvider>
    );
    expect(await screen.findByTestId('response-chart')).toBeTruthy();
    expect(screen.queryByText('Unable to load filters')).toBeNull();
  });

  it('falls back to the formatted title when there is no title', async () => {
    await renderSheet({ selectedEntry: { ...selected, title: '', formattedTitle: 'Formatted' } });
    expect(screen.getByText('Compare: Formatted (2020)')).toBeTruthy();
  });
});

// as published, b0 b1 b2 then the negated a1 a2
const published = (type: string, freq: number, q: number, gain: number) => {
  const c = coeffsFor(type, freq, q, gain)!;
  return [c.b0, c.b1, c.b2, -c.a1, -c.a2].map(String);
};

// a low, high gain shelf which float32 storage at 96kHz realises badly, "optimised" here is just a nudged copy
const coefficients = (overrides: Partial<EntryCoefficients> = {}): EntryCoefficients => ({
  profile: 'float32-96k',
  label: 'float32 @ 96 kHz',
  rate: 96000,
  precision: 'float32',
  authored: [published('LowShelf', 10, 0.7, 10)],
  optimised: [published('LowShelf', 10.01, 0.7, 10)],
  ...overrides,
});

describe('optimisationResponses', () => {
  it('is null until the coefficients load', () => {
    expect(optimisationResponses(null)).toBeNull();
  });

  it('models float32 storage for the coefficients as loaded but not for the ideal', () => {
    const r = optimisationResponses(coefficients())!;
    expect(Math.abs(maxDifference(r.ideal, r.unoptimised).db)).toBeGreaterThan(0.01);
  });

  it('treats coefficients in an unmodelled precision as exact', () => {
    const r = optimisationResponses(coefficients({ precision: 'fixed' }))!;
    expect(maxDifference(r.ideal, r.unoptimised)).toEqual({ db: 0, freq: null });
  });
});

describe('CompareSheet optimisation', () => {
  const selected = entry(1, { author: 'mine' });
  const other = entry(2, { author: 'theirs' });
  let getFilters: jest.Mock;
  let getEntryCoefficients: jest.Mock;

  const renderSheet = async (props: Partial<Parameters<typeof CompareSheet>[0]> = {}) =>
    renderInProvider(
      <CompareSheet
        api={{ getFilters, getEntryCoefficients } as unknown as EzbeqApi}
        selectedEntry={selected}
        matches={[]}
        deviceName="d1"
        optimised
        onSelect={jest.fn()}
        onClose={jest.fn()}
        onError={jest.fn()}
        {...props}
      />
    );

  const layoutChart = async () => {
    fireEvent(await screen.findByTestId('response-chart'), 'layout', {
      nativeEvent: { layout: { width: 300, height: 180 } },
    });
    await waitFor(() => expect(screen.queryAllByTestId(/^series-/).length).toBeGreaterThan(0));
  };

  beforeEach(() => {
    getFilters = jest.fn().mockResolvedValue([
      { id: '1', filters: [shelf(6)] },
      { id: '2', filters: [shelf(4)] },
    ] as EntryFilters[]);
    getEntryCoefficients = jest.fn().mockResolvedValue(coefficients());
  });

  it('compares the selection with its optimised coefficients when there are no other releases', async () => {
    await renderSheet();
    await layoutChart();
    expect(getEntryCoefficients).toHaveBeenCalledWith('d1', '1');
    expect(getFilters).not.toHaveBeenCalled();
    expect(screen.queryByText('Releases (0)')).toBeNull();
    expect(screen.getByTestId('series-ideal')).toBeTruthy();
    expect(screen.getByTestId('series-unoptimised')).toBeTruthy();
    expect(screen.getByTestId('series-optimised')).toBeTruthy();
    expect(screen.getByText(/As loaded by d1 \(float32 @ 96 kHz\)/)).toBeTruthy();
    expect(within(screen.getByTestId('compare-row-ideal')).queryByText(/max error/)).toBeNull();
    expect(within(screen.getByTestId('compare-row-unoptimised')).getByText(/^max error .* dB @ \d+ Hz$/)).toBeTruthy();
    expect(within(screen.getByTestId('compare-row-optimised')).getByText(/^max error /)).toBeTruthy();
  });

  it('plots the error vs ideal on request', async () => {
    await renderSheet();
    await layoutChart();
    fireEvent.press(screen.getByText('Difference'));
    expect(await screen.findByLabelText('Frequency response chart, Δ dB against Hz')).toBeTruthy();
  });

  it('offers both comparisons when there are other releases too', async () => {
    await renderSheet({ matches: [other] });
    await layoutChart();
    expect(screen.getByTestId('series-2')).toBeTruthy();
    fireEvent.press(screen.getByText('Optimised'));
    expect(await screen.findByText('Unoptimised (as loaded)')).toBeTruthy();
    fireEvent.press(screen.getByText('Releases (1)'));
    expect(await screen.findByTestId('compare-row-2')).toBeTruthy();
  });

  it('only compares releases without a device', async () => {
    await renderSheet({ matches: [other], deviceName: null });
    await layoutChart();
    expect(screen.queryByText('Releases (1)')).toBeNull();
    expect(getEntryCoefficients).not.toHaveBeenCalled();
  });

  it('reports a failure to load the coefficients', async () => {
    const err = new Error('boom');
    getEntryCoefficients.mockRejectedValue(err);
    const onError = jest.fn();
    await renderSheet({ onError });
    expect(await screen.findByText('Unable to load filters')).toBeTruthy();
    expect(onError).toHaveBeenCalledWith(err);
  });
});
