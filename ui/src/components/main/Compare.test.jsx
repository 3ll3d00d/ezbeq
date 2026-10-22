import {beforeEach, describe, expect, it, vi} from 'vitest';
import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import CompareDialog, {maxDifference, optimisationResponses, variantLabel} from './Compare';
import {coeffsFor} from '../../services/biquad';
import ezbeq from '../../services/ezbeq';

vi.mock('../../services/ezbeq', () => ({
    default: {
        getFilters: vi.fn(),
        getEntryCoefficients: vi.fn()
    }
}));

// uPlot needs a real canvas, just capture what it was asked to draw
vi.mock('uplot-react', () => ({
    default: ({options, data}) => (
        <div data-testid="chart" data-series={JSON.stringify(options.series.map(s => s.label))}
             data-ylabel={options.axes[1].label} data-legend={String(options.legend?.show !== false)}
             data-dashes={JSON.stringify(options.series.slice(1).map(s => s.dash || null))}
             data-first={JSON.stringify(data.slice(1).map(d => d[0]))}/>
    )
}));

const entry = (id, overrides = {}) => ({
    id, title: 'Some Movie', year: 2020, contentType: 'film', theMovieDB: '123', author: 'a1',
    audioTypes: ['Atmos'], ...overrides
});

const shelf = gain => ({type: 'LowShelf', freq: 30, q: 0.707, gain, count: 1});

describe('variantLabel', () => {
    it('describes season, episode and edition', () => {
        expect(variantLabel(entry('x'))).toBe('');
        expect(variantLabel(entry('x', {season: '1', episode: '2', edition: 'Extended'}))).toBe('S1E2 • Extended');
        expect(variantLabel(entry('x', {season: '3'}))).toBe('S3');
    });
});

describe('maxDifference', () => {
    it('finds the largest absolute deviation and where it is', () => {
        expect(maxDifference([0, 0, 0], [1, -3, 2], [10, 20, 30])).toEqual({db: -3, freq: 20});
        expect(maxDifference([1, 1], [1, 1], [10, 20])).toEqual({db: 0, freq: null});
    });
});

describe('CompareDialog', () => {
    const selected = entry('s', {author: 'mine', mvAdjust: -2});
    const other = entry('m', {author: 'theirs', edition: 'Extended'});

    const renderDialog = (props = {}) => render(
        <CompareDialog selectedEntry={selected} matches={[other]} onSelect={vi.fn()} onClose={vi.fn()}
                       setError={vi.fn()} {...props}/>
    );

    beforeEach(() => {
        ezbeq.getFilters.mockReset().mockResolvedValue([
            {id: 's', filters: [shelf(6)]},
            {id: 'm', filters: [shelf(4), {...shelf(1), count: 2}]}
        ]);
    });

    it('loads the filters for the selection and every match and plots their responses', async () => {
        renderDialog();
        const chart = await screen.findByTestId('chart');
        expect(ezbeq.getFilters).toHaveBeenCalledWith(['s', 'm']);
        expect(JSON.parse(chart.dataset.series)).toEqual(['Hz', 'Selected: mine — Atmos', 'theirs — Atmos']);
        expect(chart.dataset.ylabel).toBe('Gain (dB)');
        expect(chart.dataset.legend).toBe('true');
        const [sel, oth] = JSON.parse(chart.dataset.first);
        expect(sel).toBeCloseTo(6, 0);
        expect(oth).toBeCloseTo(6, 0);
    });

    it('summarises each entry in the table', async () => {
        renderDialog();
        await screen.findByTestId('chart');
        const rows = within(screen.getByRole('table', {name: 'matching filters'})).getAllByRole('row');
        expect(within(rows[1]).getByText('mine')).toBeInTheDocument();
        expect(within(rows[1]).getByText('-2.0 dB')).toBeInTheDocument();
        expect(within(rows[1]).getByText('Selected')).toBeInTheDocument();
        expect(within(rows[1]).getByText('1')).toBeInTheDocument();
        expect(within(rows[2]).getByText('theirs')).toBeInTheDocument();
        expect(within(rows[2]).getByText('Extended')).toBeInTheDocument();
        expect(within(rows[2]).getByText('3')).toBeInTheDocument();
        expect(within(rows[2]).getByText(/dB @ \d+ Hz/)).toBeInTheDocument();
    });

    it('plots the difference against the selection on request', async () => {
        renderDialog();
        await screen.findByTestId('chart');
        fireEvent.click(screen.getByRole('button', {name: 'Difference'}));
        const chart = screen.getByTestId('chart');
        expect(chart.dataset.ylabel).toBe('Difference vs selected (dB)');
        const [sel, oth] = JSON.parse(chart.dataset.first);
        expect(sel).toBe(0);
        expect(Math.abs(oth)).toBeLessThan(0.5);
    });

    it('uses a list and drops the chart legend on a narrow screen', async () => {
        const matchMedia = window.matchMedia;
        window.matchMedia = query => ({
            matches: true, media: query, addListener: vi.fn(), removeListener: vi.fn(),
            addEventListener: vi.fn(), removeEventListener: vi.fn()
        });
        try {
            const onSelect = vi.fn();
            const onClose = vi.fn();
            renderDialog({onSelect, onClose});
            const chart = await screen.findByTestId('chart');
            expect(chart.dataset.legend).toBe('false');
            expect(chart.dataset.ylabel).toBe('dB');
            expect(screen.queryByRole('table')).not.toBeInTheDocument();
            const items = within(screen.getByRole('list', {name: 'matching filters'})).getAllByRole('listitem');
            expect(within(items[0]).getByText('mine \u2014 Atmos')).toBeInTheDocument();
            expect(within(items[0]).getByText('MV -2.0 dB \u2022 1 filters')).toBeInTheDocument();
            expect(within(items[0]).getByText('Selected')).toBeInTheDocument();
            expect(within(items[1]).getByText(/^Extended \u2022 3 filters \u2022 max diff .* dB @ \d+ Hz$/)).toBeInTheDocument();
            fireEvent.click(within(items[1]).getByRole('button', {name: 'Select'}));
            expect(onSelect).toHaveBeenCalledWith('m');
            fireEvent.click(screen.getByRole('button', {name: 'Close'}));
            // once from select, once from the close icon
            expect(onClose).toHaveBeenCalledTimes(2);
        } finally {
            window.matchMedia = matchMedia;
        }
    });

    it('shows a zero max diff for identical filters', async () => {
        ezbeq.getFilters.mockResolvedValue([{id: 's', filters: [shelf(6)]}, {id: 'm', filters: [shelf(6)]}]);
        renderDialog();
        await screen.findByTestId('chart');
        const rows = within(screen.getByRole('table', {name: 'matching filters'})).getAllByRole('row');
        expect(within(rows[2]).getByText('0.0 dB')).toBeInTheDocument();
    });

    it('dashes the series once the colours run out', async () => {
        const many = Array.from({length: 9}, (_, i) => entry(`m${i}`, {author: `a${i}`}));
        ezbeq.getFilters.mockResolvedValue(['s', ...many.map(m => m.id)].map(id => ({id, filters: [shelf(6)]})));
        renderDialog({matches: many});
        const chart = await screen.findByTestId('chart');
        const dashes = JSON.parse(chart.dataset.dashes);
        expect(dashes.slice(0, 9)).toEqual(Array(9).fill(null));
        expect(dashes[9]).toEqual([6, 4]);
    });

    it('only reloads filters when the entries being compared change', async () => {
        const props = {onSelect: vi.fn(), onClose: vi.fn(), setError: vi.fn()};
        const {rerender} = render(<CompareDialog selectedEntry={selected} matches={[other]} {...props}/>);
        await screen.findByTestId('chart');
        // e.g. a catalogue refresh, same ids but new objects
        rerender(<CompareDialog selectedEntry={{...selected}} matches={[{...other}]} {...props}/>);
        expect(ezbeq.getFilters).toHaveBeenCalledTimes(1);
        rerender(<CompareDialog selectedEntry={selected} matches={[other, entry('n')]} {...props}/>);
        await waitFor(() => expect(ezbeq.getFilters).toHaveBeenCalledTimes(2));
        expect(ezbeq.getFilters).toHaveBeenLastCalledWith(['s', 'm', 'n']);
    });

    it('selects a match and closes', async () => {
        const onSelect = vi.fn();
        const onClose = vi.fn();
        renderDialog({onSelect, onClose});
        fireEvent.click(screen.getByRole('button', {name: 'Select'}));
        expect(onSelect).toHaveBeenCalledWith('m');
        expect(onClose).toHaveBeenCalled();
    });

    it('closes from the close button', () => {
        const onClose = vi.fn();
        renderDialog({onClose});
        fireEvent.click(screen.getByRole('button', {name: 'Close'}));
        expect(onClose).toHaveBeenCalled();
    });

    it('omits entries whose filters could not be found and disables difference without the selection', async () => {
        ezbeq.getFilters.mockResolvedValue([{id: 'm', filters: [shelf(4)]}]);
        renderDialog();
        const chart = await screen.findByTestId('chart');
        expect(JSON.parse(chart.dataset.series)).toEqual(['Hz', 'theirs — Atmos']);
        expect(screen.getByRole('button', {name: 'Difference'})).toBeDisabled();
    });

    it('reports a failure to load filters', async () => {
        const err = new Error('boom');
        ezbeq.getFilters.mockRejectedValue(err);
        const setError = vi.fn();
        renderDialog({setError});
        expect(await screen.findByText('Unable to load filters')).toBeInTheDocument();
        expect(setError).toHaveBeenCalledWith(err);
    });

    it('ignores a failure which arrives after closing', async () => {
        let reject;
        ezbeq.getFilters.mockReturnValue(new Promise((_, r) => {
            reject = r;
        }));
        const setError = vi.fn();
        const {unmount} = renderDialog({setError});
        unmount();
        // let the rejection's handlers run before asserting they did nothing
        await act(async () => reject(new Error('late')));
        expect(setError).not.toHaveBeenCalled();
    });

    it('clears a failure once a later load of different entries succeeds', async () => {
        ezbeq.getFilters.mockRejectedValueOnce(new Error('boom'));
        const props = {onSelect: vi.fn(), onClose: vi.fn(), setError: vi.fn()};
        const {rerender} = render(<CompareDialog selectedEntry={selected} matches={[other]} {...props}/>);
        expect(await screen.findByText('Unable to load filters')).toBeInTheDocument();
        rerender(<CompareDialog selectedEntry={selected} matches={[other, entry('n')]} {...props}/>);
        expect(await screen.findByTestId('chart')).toBeInTheDocument();
        expect(screen.queryByText('Unable to load filters')).not.toBeInTheDocument();
    });
});

// as published, b0 b1 b2 then the negated a1 a2
const published = (type, freq, q, gain) => {
    const c = coeffsFor(type, freq, q, gain);
    return [c.b0, c.b1, c.b2, -c.a1, -c.a2].map(String);
};

// a low, high gain shelf which float32 storage at 96kHz realises badly, "optimised" here is just a nudged copy
const coefficients = (overrides = {}) => ({
    profile: 'float32-96k', label: 'float32 @ 96 kHz', rate: 96000, precision: 'float32',
    authored: [published('LowShelf', 10, 0.7, 10)],
    optimised: [published('LowShelf', 10.01, 0.7, 10)],
    ...overrides
});

describe('optimisationResponses', () => {
    it('is null until the coefficients load', () => {
        expect(optimisationResponses(null)).toBeNull();
    });

    it('models float32 storage for the coefficients as loaded but not for the ideal', () => {
        const r = optimisationResponses(coefficients());
        expect(Math.abs(maxDifference(r.ideal, r.unoptimised).db)).toBeGreaterThan(0.01);
    });

    it('treats coefficients in an unmodelled precision as exact', () => {
        const r = optimisationResponses(coefficients({precision: 'fixed'}));
        expect(maxDifference(r.ideal, r.unoptimised)).toEqual({db: 0, freq: null});
    });
});

describe('CompareDialog optimisation', () => {
    const selected = entry('s', {author: 'mine'});
    const other = entry('m', {author: 'theirs'});

    const renderDialog = (props = {}) => render(
        <CompareDialog selectedEntry={selected} matches={[]} deviceName="d1" optimised onSelect={vi.fn()}
                       onClose={vi.fn()} setError={vi.fn()} {...props}/>
    );

    beforeEach(() => {
        ezbeq.getFilters.mockReset().mockResolvedValue([
            {id: 's', filters: [shelf(6)]},
            {id: 'm', filters: [shelf(4)]}
        ]);
        ezbeq.getEntryCoefficients.mockReset().mockResolvedValue(coefficients());
    });

    it('compares the selection with its optimised coefficients when there are no other releases', async () => {
        renderDialog();
        const chart = await screen.findByTestId('chart');
        expect(ezbeq.getEntryCoefficients).toHaveBeenCalledWith('d1', 's');
        expect(ezbeq.getFilters).not.toHaveBeenCalled();
        expect(screen.queryByRole('tab')).not.toBeInTheDocument();
        expect(JSON.parse(chart.dataset.series))
            .toEqual(['Hz', 'Ideal', 'Unoptimised (as loaded)', 'Optimised (as loaded)']);
        expect(chart.dataset.ylabel).toBe('Gain (dB)');
        expect(screen.getByText(/As loaded by d1 \(float32 @ 96 kHz\)/)).toBeInTheDocument();
        const rows = within(screen.getByRole('table', {name: 'coefficients'})).getAllByRole('row');
        expect(within(rows[1]).getByText('Ideal')).toBeInTheDocument();
        expect(within(rows[2]).getByText(/dB @ \d+ Hz/)).toBeInTheDocument();
        expect(within(rows[3]).getByText(/dB/)).toBeInTheDocument();
    });

    it('plots the error vs ideal on request', async () => {
        renderDialog();
        await screen.findByTestId('chart');
        fireEvent.click(screen.getByRole('button', {name: 'Difference'}));
        const chart = screen.getByTestId('chart');
        expect(chart.dataset.ylabel).toBe('Error vs ideal (dB)');
        const [ideal, unoptimised] = JSON.parse(chart.dataset.first);
        expect(ideal).toBe(0);
        expect(Math.abs(unoptimised)).toBeGreaterThan(0.01);
    });

    it('offers both comparisons as tabs when there are other releases too', async () => {
        renderDialog({matches: [other]});
        let chart = await screen.findByTestId('chart');
        expect(JSON.parse(chart.dataset.series)).toEqual(['Hz', 'Selected: mine — Atmos', 'theirs — Atmos']);
        expect(screen.getByRole('tab', {name: 'Releases (1)'})).toHaveAttribute('aria-selected', 'true');
        fireEvent.click(screen.getByRole('tab', {name: 'Optimised'}));
        await waitFor(() => expect(JSON.parse(screen.getByTestId('chart').dataset.series)[1]).toBe('Ideal'));
        fireEvent.click(screen.getByRole('tab', {name: 'Releases (1)'}));
        chart = await screen.findByTestId('chart');
        expect(JSON.parse(chart.dataset.series)[1]).toBe('Selected: mine — Atmos');
    });

    it('only compares releases without a device', async () => {
        renderDialog({matches: [other], deviceName: null});
        await screen.findByTestId('chart');
        expect(screen.queryByRole('tab')).not.toBeInTheDocument();
        expect(ezbeq.getEntryCoefficients).not.toHaveBeenCalled();
    });

    it('uses a list on a narrow screen', async () => {
        const matchMedia = window.matchMedia;
        window.matchMedia = query => ({
            matches: true, media: query, addListener: vi.fn(), removeListener: vi.fn(),
            addEventListener: vi.fn(), removeEventListener: vi.fn()
        });
        try {
            renderDialog();
            await screen.findByTestId('chart');
            const items = within(screen.getByRole('list', {name: 'coefficients'})).getAllByRole('listitem');
            expect(items).toHaveLength(3);
            expect(within(items[1]).getByText(/^max error .* dB @ \d+ Hz$/)).toBeInTheDocument();
        } finally {
            window.matchMedia = matchMedia;
        }
    });

    it('reports a failure to load the coefficients', async () => {
        const err = new Error('boom');
        ezbeq.getEntryCoefficients.mockRejectedValue(err);
        const setError = vi.fn();
        renderDialog({setError});
        expect(await screen.findByText('Unable to load filters')).toBeInTheDocument();
        expect(setError).toHaveBeenCalledWith(err);
    });
});
