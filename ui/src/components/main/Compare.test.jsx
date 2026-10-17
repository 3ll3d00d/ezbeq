import {beforeEach, describe, expect, it, vi} from 'vitest';
import {fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import CompareDialog, {maxDifference, variantLabel} from './Compare';
import ezbeq from '../../services/ezbeq';

vi.mock('../../services/ezbeq', () => ({
    default: {
        getFilters: vi.fn()
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

    it('ignores a response which arrives after closing', async () => {
        let resolve;
        ezbeq.getFilters.mockReturnValue(new Promise(r => {
            resolve = r;
        }));
        const setError = vi.fn();
        const {unmount} = renderDialog({setError});
        unmount();
        resolve([]);
        await waitFor(() => expect(setError).not.toHaveBeenCalled());
    });
});
