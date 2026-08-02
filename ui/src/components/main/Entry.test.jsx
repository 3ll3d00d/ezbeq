import {beforeEach, describe, expect, it, vi} from 'vitest';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import Entry from './Entry';
import ezbeq from '../../services/ezbeq';

vi.mock('../../services/ezbeq', () => ({
    default: {
        loadWithMV: vi.fn(),
        sendFilter: vi.fn()
    }
}));

const gainCapableDevice = () => ({
    name: 'd1',
    slots: [{
        id: '1',
        gains: [{id: '1', value: 0}, {id: '2', value: 0}],
        mutes: [{id: '1', value: false}, {id: '2', value: false}]
    }]
});

const plainDevice = () => ({
    name: 'd1',
    slots: [{id: '1'}]
});

const entryWithMvAdjust = (mvAdjust = 3.5) => ({id: 'entry-1', title: 'Some Movie', mvAdjust});

const renderEntry = (props) => render(
    <Entry selectedDevice={null} selectedEntry={null} useWide={true} setDevice={vi.fn()}
           selectedSlotId="1" setError={vi.fn()} setSuccess={vi.fn()} setUploadPendingSlotId={vi.fn()}
           {...props}/>
);

beforeEach(() => {
    ezbeq.loadWithMV.mockReset().mockResolvedValue({name: 'd1'});
    ezbeq.sendFilter.mockReset().mockResolvedValue({name: 'd1'});
});

describe('Entry', () => {
    it('renders nothing when there is no selected entry', () => {
        const {container} = renderEntry({selectedEntry: null});
        expect(container).toBeEmptyDOMElement();
    });

    it('does not show the Set Input Gain checkbox for a slot that does not support gains', () => {
        renderEntry({selectedDevice: plainDevice(), selectedEntry: entryWithMvAdjust()});
        expect(screen.queryByRole('checkbox', {name: /Set Input Gain/i})).not.toBeInTheDocument();
    });

    it('shows the Set Input Gain checkbox, disabled, for an entry with no mvAdjust', () => {
        renderEntry({selectedDevice: gainCapableDevice(), selectedEntry: entryWithMvAdjust(0)});
        expect(screen.getByRole('checkbox', {name: /Set Input Gain/i})).toBeDisabled();
    });

    it('shows the Set Input Gain checkbox, enabled, for a gain-capable slot and an entry with mvAdjust', () => {
        renderEntry({selectedDevice: gainCapableDevice(), selectedEntry: entryWithMvAdjust(3.5)});
        expect(screen.getByRole('checkbox', {name: /Set Input Gain/i})).toBeEnabled();
    });

    it('uploads via the plain filter endpoint for a slot with no gain support', async () => {
        renderEntry({selectedDevice: plainDevice(), selectedEntry: entryWithMvAdjust()});

        fireEvent.click(screen.getByRole('button', {name: /upload/i}));

        await waitFor(() => expect(ezbeq.sendFilter).toHaveBeenCalledWith('d1', 'entry-1', '1'));
        expect(ezbeq.loadWithMV).not.toHaveBeenCalled();
    });

    it('zeroes every channel gain and leaves mutes untouched when uploading with the checkbox unchecked', async () => {
        renderEntry({selectedDevice: gainCapableDevice(), selectedEntry: entryWithMvAdjust(3.5)});

        fireEvent.click(screen.getByRole('button', {name: /upload/i}));

        await waitFor(() => expect(ezbeq.loadWithMV).toHaveBeenCalledWith('d1', 'entry-1', '1', {
            gains: [{id: '1', value: 0.0}, {id: '2', value: 0.0}],
            mutes: []
        }));
    });

    it('applies the catalogue mvAdjust and unmutes every channel when the checkbox is checked', async () => {
        renderEntry({selectedDevice: gainCapableDevice(), selectedEntry: entryWithMvAdjust(3.5)});

        fireEvent.click(screen.getByRole('checkbox', {name: /Set Input Gain/i}));
        fireEvent.click(screen.getByRole('button', {name: /upload/i}));

        await waitFor(() => expect(ezbeq.loadWithMV).toHaveBeenCalledWith('d1', 'entry-1', '1', {
            gains: [{id: '1', value: 3.5}, {id: '2', value: 3.5}],
            mutes: [{id: '1', value: false}, {id: '2', value: false}]
        }));
    });

    it('reports the returned device and a success message after a successful upload', async () => {
        const setDevice = vi.fn();
        const setSuccess = vi.fn();
        ezbeq.sendFilter.mockResolvedValue({name: 'd1', masterVolume: -10});
        renderEntry({selectedDevice: plainDevice(), selectedEntry: entryWithMvAdjust(), setDevice, setSuccess});

        fireEvent.click(screen.getByRole('button', {name: /upload/i}));

        await waitFor(() => expect(setDevice).toHaveBeenCalledWith({name: 'd1', masterVolume: -10}));
        expect(setSuccess).toHaveBeenCalledWith('Filter loaded');
    });

    it('reports the error and does not touch device state when the upload fails', async () => {
        const setDevice = vi.fn();
        const setError = vi.fn();
        const failure = new Error('device offline');
        ezbeq.sendFilter.mockRejectedValue(failure);
        renderEntry({selectedDevice: plainDevice(), selectedEntry: entryWithMvAdjust(), setDevice, setError});

        fireEvent.click(screen.getByRole('button', {name: /upload/i}));

        await waitFor(() => expect(setError).toHaveBeenCalledWith(failure));
        expect(setDevice).not.toHaveBeenCalled();
    });
});

describe('Entry slot selection', () => {
    const multiSlotDevice = () => ({
        name: 'd1',
        slots: [{id: '1'}, {id: '2'}, {id: '3'}]
    });

    it('does not show a slot radio group for a device with only one slot', () => {
        renderEntry({selectedDevice: plainDevice(), selectedEntry: entryWithMvAdjust(), selectedSlotId: '1'});
        expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    });

    it('shows a slot radio per slot for a multi-slot device, defaulting to the selected slot', () => {
        renderEntry({selectedDevice: multiSlotDevice(), selectedEntry: entryWithMvAdjust(), selectedSlotId: '2'});
        expect(screen.getByRole('radio', {name: '1'})).not.toBeChecked();
        expect(screen.getByRole('radio', {name: '2'})).toBeChecked();
        expect(screen.getByRole('radio', {name: '3'})).not.toBeChecked();
    });

    it('uploads to the slot picked via the radio group, not the originally selected one', async () => {
        renderEntry({selectedDevice: multiSlotDevice(), selectedEntry: entryWithMvAdjust(), selectedSlotId: '1'});

        fireEvent.click(screen.getByRole('radio', {name: '3'}));
        fireEvent.click(screen.getByRole('button', {name: /upload/i}));

        await waitFor(() => expect(ezbeq.sendFilter).toHaveBeenCalledWith('d1', 'entry-1', '3'));
    });
});

describe('Entry gain checkbox reset', () => {
    it('unchecks Set Input Gain when the selected entry changes', () => {
        const entry1 = entryWithMvAdjust(3.5);
        const {rerender} = renderEntry({selectedDevice: gainCapableDevice(), selectedEntry: entry1});

        fireEvent.click(screen.getByRole('checkbox', {name: /Set Input Gain/i}));
        expect(screen.getByRole('checkbox', {name: /Set Input Gain/i})).toBeChecked();

        rerender(
            <Entry selectedDevice={gainCapableDevice()} selectedEntry={{id: 'entry-2', title: 'Other Movie', mvAdjust: 2}}
                   useWide={true} setDevice={vi.fn()} selectedSlotId="1" setError={vi.fn()}
                   setSuccess={vi.fn()} setUploadPendingSlotId={vi.fn()}/>
        );

        expect(screen.getByRole('checkbox', {name: /Set Input Gain/i})).not.toBeChecked();
    });
});

describe('Entry metadata rendering', () => {
    it('shows the title with year, edition, and a distinct alt title', () => {
        renderEntry({selectedEntry: {id: 1, title: 'Movie', year: 2020, edition: "Director's Cut", altTitle: 'Alt Name'}});
        expect(screen.getByText('Movie (2020)')).toBeInTheDocument();
        expect(screen.getByText("Director's Cut")).toBeInTheDocument();
        expect(screen.getByText('Alt Name')).toBeInTheDocument();
    });

    it('does not repeat the alt title when it matches the title', () => {
        renderEntry({selectedEntry: {id: 1, title: 'Movie', altTitle: 'Movie'}});
        expect(screen.getAllByText('Movie')).toHaveLength(1);
    });

    it('formats season/episode information', () => {
        renderEntry({selectedEntry: {id: 1, title: 'Show', season: '1', episodes: '5'}});
        expect(screen.getByText('S1 E5')).toBeInTheDocument();
    });

    it('formats a non-numeric episode range', () => {
        renderEntry({selectedEntry: {id: 1, title: 'Show', season: '1', episodes: '1-3'}});
        expect(screen.getByText('S1 1-3')).toBeInTheDocument();
    });

    it('shows a positive MV adjustment with an explicit plus sign', () => {
        renderEntry({selectedEntry: {id: 1, title: 'Movie', mvAdjust: 2.5}});
        expect(screen.getByText(/MV Adjustment: \+2\.5 dB/)).toBeInTheDocument();
    });

    it('shows a negative MV adjustment without an extra sign', () => {
        renderEntry({selectedEntry: {id: 1, title: 'Movie', mvAdjust: -2.5}});
        expect(screen.getByText(/MV Adjustment: -2\.5 dB/)).toBeInTheDocument();
    });

    it('shows note and warning text', () => {
        renderEntry({selectedEntry: {id: 1, title: 'Movie', note: 'A note', warning: 'A warning'}});
        expect(screen.getByText('A note')).toBeInTheDocument();
        expect(screen.getByText('A warning')).toBeInTheDocument();
    });

    it('shows extra metadata (rating, runtime, language, genres, author)', () => {
        renderEntry({
            selectedEntry: {
                id: 1, title: 'Movie', rating: 'PG-13', runtime: 125,
                language: 'French', genres: ['Action', 'Drama'], author: 'Some Author'
            }
        });
        expect(screen.getByText(/PG-13/)).toBeInTheDocument();
        expect(screen.getByText(/2h 5m/)).toBeInTheDocument();
        expect(screen.getByText(/French/)).toBeInTheDocument();
        expect(screen.getByText(/Action, Drama/)).toBeInTheDocument();
        expect(screen.getByText(/Some Author/)).toBeInTheDocument();
    });

    it('omits English from the extra metadata (only non-English languages are called out)', () => {
        renderEntry({selectedEntry: {id: 1, title: 'Movie', language: 'English', author: 'A'}});
        expect(screen.queryByText(/English/)).not.toBeInTheDocument();
    });
});

describe('Entry links', () => {
    it('shows TMDb, Discuss and Catalogue links only when the corresponding url is present', () => {
        renderEntry({
            selectedEntry: {
                id: 1, title: 'Movie', theMovieDB: '123', contentType: 'film',
                avsUrl: 'https://avs.example/thread', beqcUrl: 'https://beqc.example/entry'
            }
        });
        expect(screen.getByRole('link', {name: 'TMDb'})).toHaveAttribute('href', 'https://themoviedb.org/movie/123');
        expect(screen.getByRole('link', {name: 'Discuss'})).toHaveAttribute('href', 'https://avs.example/thread');
        expect(screen.getByRole('link', {name: 'Catalogue'})).toHaveAttribute('href', 'https://beqc.example/entry');
    });

    it('links to the tv path on TMDb for a non-film content type', () => {
        renderEntry({selectedEntry: {id: 1, title: 'Show', theMovieDB: '123', contentType: 'tv'}});
        expect(screen.getByRole('link', {name: 'TMDb'})).toHaveAttribute('href', 'https://themoviedb.org/tv/123');
    });

    it('shows none of the links when their urls are absent', () => {
        renderEntry({selectedEntry: {id: 1, title: 'Movie'}});
        expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });
});

describe('Entry layout', () => {
    const cardChildOrder = (container) => Array.from(container.querySelector('.MuiCard-root').children).length;

    it('renders the upload action before the title/content in narrow (non-wide) mode', () => {
        const {container} = renderEntry({selectedDevice: plainDevice(), selectedEntry: entryWithMvAdjust(), useWide: false});
        const children = Array.from(container.querySelector('.MuiCard-root').children);
        const uploadIdx = children.findIndex(c => c.textContent.includes('Upload'));
        const titleIdx = children.findIndex(c => c.textContent.includes('Some Movie'));
        expect(uploadIdx).toBeLessThan(titleIdx);
    });

    it('renders the title/content before the upload action in wide mode', () => {
        const {container} = renderEntry({selectedDevice: plainDevice(), selectedEntry: entryWithMvAdjust(), useWide: true});
        const children = Array.from(container.querySelector('.MuiCard-root').children);
        const uploadIdx = children.findIndex(c => c.textContent.includes('Upload'));
        const titleIdx = children.findIndex(c => c.textContent.includes('Some Movie'));
        expect(titleIdx).toBeLessThan(uploadIdx);
    });

    it('does not render an upload action when there is no selected device', () => {
        renderEntry({selectedDevice: null, selectedEntry: entryWithMvAdjust()});
        expect(screen.queryByRole('button', {name: /upload/i})).not.toBeInTheDocument();
    });
});
