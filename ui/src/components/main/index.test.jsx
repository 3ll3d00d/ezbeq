import {beforeEach, describe, expect, it, vi} from 'vitest';
import {useState} from 'react';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {computeNewCount, deriveTxtFilterFromActiveSlot, isMatch, txtMatch} from './index';
import MainView from './index';
import ezbeq from '../../services/ezbeq';

vi.mock('../../services/ezbeq', () => ({
    default: {
        getWhatsNew: vi.fn(() => Promise.resolve([])),
        getVersion: vi.fn(() => Promise.resolve({})),
        getAuthors: vi.fn(() => Promise.resolve([])),
        getLanguages: vi.fn(() => Promise.resolve([])),
        getYears: vi.fn(() => Promise.resolve([])),
        getAudioTypes: vi.fn(() => Promise.resolve([])),
        getContentTypes: vi.fn(() => Promise.resolve([])),
        sendFilter: vi.fn(),
        loadWithMV: vi.fn()
    }
}));

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

// Full-tree rendering: MainView is the assembler wiring Header/Search/Filter/Slots/Catalogue/
// Entry/Footer/WhatsNew together. Nothing else exercises that wiring actually works end to end -
// each child's own test file only proves its half of a prop contract in isolation.
describe('MainView', () => {
    const entry = (id, overrides = {}) => {
        const title = overrides.formattedTitle ?? `Movie ${id}`;
        return {
            id, title, author: 'Alice', formattedTitle: title, sortTitle: title.toLowerCase(),
            audioTypes: ['Atmos'], edition: '', avsUrl: '', url: false,
            year: 2020, contentType: 'film', freshness: 'Fresh', language: 'English',
            ...overrides
        };
    };

    const renderMainView = (props) => render(
        <MainView entries={[]} availableDevices={{}} setErr={vi.fn()} setSuccess={vi.fn()}
                  replaceDevice={vi.fn()} selectedDeviceName={null} setSelectedDeviceName={vi.fn()}
                  selectedSlotId={null} setSelectedSlotId={vi.fn()} useWide={true}
                  setSelectedNav={vi.fn()} selectedNav="catalogue" meta={{}}
                  {...props}/>
    );

    beforeEach(() => {
        ezbeq.getWhatsNew.mockClear().mockResolvedValue([]);
        ezbeq.getVersion.mockClear().mockResolvedValue({});
    });

    it('renders the full tree without crashing: header, search, catalogue rows, footer', async () => {
        renderMainView({entries: [entry(1), entry(2)]});

        expect(screen.getByPlaceholderText('Search…')).toBeInTheDocument();
        expect(await screen.findByText('Movie 1')).toBeInTheDocument();
        expect(screen.getByText('Movie 2')).toBeInTheDocument();
    });

    it('auto-selects the first available device when none is selected', () => {
        const setSelectedDeviceName = vi.fn();
        renderMainView({availableDevices: {d1: {name: 'd1'}}, selectedDeviceName: null, setSelectedDeviceName});

        expect(setSelectedDeviceName).toHaveBeenCalledWith('d1');
    });

    it('selecting a catalogue entry displays it in the Entry pane', async () => {
        renderMainView({
            entries: [entry(1, {formattedTitle: 'Unique Title'})],
            availableDevices: {d1: {name: 'd1', slots: [{id: '1'}]}},
            selectedDeviceName: 'd1'
        });

        fireEvent.click(await screen.findByText('Unique Title'));

        // Entry pane renders "{title} ({year})" as a heading, distinct from the plain grid cell text
        await waitFor(() => expect(screen.getByRole('heading', {name: /Unique Title \(2020\)/})).toBeInTheDocument());
    });

    it('narrows the catalogue to entries matching the search text', async () => {
        renderMainView({entries: [entry(1, {formattedTitle: 'Alpha'}), entry(2, {formattedTitle: 'Beta'})]});

        await screen.findByText('Alpha');
        fireEvent.change(screen.getByPlaceholderText('Search…'), {target: {value: 'alpha'}});

        await waitFor(() => expect(screen.queryByText('Beta')).not.toBeInTheDocument(), {timeout: 1000});
        expect(screen.getByText('Alpha')).toBeInTheDocument();
    });

    it("opens What's New from the header badge and selects an entry from it", async () => {
        const recent = [{id: 1, formattedTitle: 'Recent Movie', created_at: Math.floor(Date.now() / 1000)}];
        ezbeq.getWhatsNew.mockResolvedValue(recent);
        renderMainView({entries: [entry(1, {formattedTitle: 'Recent Movie'})]});

        await waitFor(() => expect(ezbeq.getWhatsNew).toHaveBeenCalled());
        fireEvent.click(screen.getByRole('button', {name: "What's New"}));

        // Queries by heading rather than plain text - the mobile header's overflow menu now also
        // has a "What's New" entry of its own (see Header.jsx), so the text alone is no longer
        // unique; the sheet's title is the only "What's New" rendered as a heading.
        expect(await screen.findByRole('heading', {name: "What's New"})).toBeInTheDocument();
        fireEvent.click(screen.getByText('Recent Movie', {selector: 'p'}));

        // selecting from the drawer sets selectedEntryId, which the Entry pane then renders too
        // (with " (2020)" appended, per the entry() fixture's default year)
        await waitFor(() => expect(screen.getByRole('heading', {name: /Recent Movie \(2020\)/})).toBeInTheDocument());
    });

    it('shows the update-available snack when a newer version is reported', async () => {
        ezbeq.getVersion.mockResolvedValue({updateAvailable: true, latestVersion: '9.9.9'});
        renderMainView({});

        expect(await screen.findByText(/ezbeq 9\.9\.9 is available/)).toBeInTheDocument();
    });

    // The bug that kicked off this whole test-coverage effort lived exactly in this seam:
    // Entry's "Set Input Gain" upload calls setDevice(...) with the backend's response, and
    // Slots derives what it displays from that same availableDevices state. Each component's
    // own test file only proves its half of the contract (Entry sends the right payload; Slots
    // reflects whatever device prop it's given) - only rendering both for real, wired through
    // the same state a parent would own, proves the seam itself is correct.
    it('reflects a gain applied via Entry\'s "Set Input Gain" checkbox in the Slots gain panel', async () => {
        const gainDevice = (channelGain) => ({
            name: 'd1',
            masterVolume: -10,
            mute: false,
            slots: [{
                id: '1',
                last: 'Empty',
                gains: [{id: '1', value: channelGain}],
                mutes: [{id: '1', value: false}],
                outputGains: [],
                outputMutes: []
            }]
        });

        const StatefulMainView = (initialProps) => {
            const Wrapper = () => {
                const [availableDevices, setAvailableDevices] = useState(initialProps.availableDevices);
                const replaceDevice = d => setAvailableDevices(prev => ({...prev, [d.name]: d}));
                return <MainView {...initialProps} availableDevices={availableDevices} replaceDevice={replaceDevice}/>;
            };
            return render(<Wrapper/>);
        };

        ezbeq.loadWithMV.mockResolvedValue(gainDevice(3.5));

        const {container} = StatefulMainView({
            entries: [entry(1, {formattedTitle: 'Gain Movie', mvAdjust: 3.5})],
            availableDevices: {d1: gainDevice(0)},
            selectedDeviceName: 'd1',
            selectedSlotId: '1'
        });

        fireEvent.click(await screen.findByText('Gain Movie'));
        fireEvent.click(await screen.findByRole('checkbox', {name: /Set Input Gain/i}));
        fireEvent.click(screen.getByRole('button', {name: /upload/i}));

        await waitFor(() => expect(ezbeq.loadWithMV).toHaveBeenCalledWith('d1', 1, '1', {
            gains: [{id: '1', value: 3.5}],
            mutes: [{id: '1', value: false}]
        }));

        fireEvent.click(screen.getByText(/Channels/));
        await waitFor(() => {
            const channelInput = Array.from(container.querySelectorAll('input[type="number"]'))[1];
            expect(channelInput.value).toBe('3.5');
        });
    });
});
