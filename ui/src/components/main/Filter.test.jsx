import {beforeEach, describe, expect, it, vi} from 'vitest';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import Filter from './Filter';
import {matchAudioTypes, matchFreshness, matchLanguages, matchYears} from './Filter';
import ezbeq from '../../services/ezbeq';

vi.mock('../../services/ezbeq', () => ({
    default: {
        getAuthors: vi.fn(),
        getLanguages: vi.fn(),
        getYears: vi.fn(),
        getAudioTypes: vi.fn(),
        getContentTypes: vi.fn()
    }
}));

const noop = () => {};

const baseProps = {
    visible: true,
    selectedAudioTypes: [], setSelectedAudioTypes: noop,
    selectedFreshness: [], setSelectedFreshness: noop,
    selectedYears: [], setSelectedYears: noop,
    selectedLanguages: [], setSelectedLanguages: noop,
    selectedAuthors: [], setSelectedAuthors: noop,
    selectedContentTypes: [], setSelectedContentTypes: noop,
    filteredEntries: [],
    setError: noop
};

beforeEach(() => {
    ezbeq.getAuthors.mockResolvedValue(['Author A', 'Author B']);
    ezbeq.getLanguages.mockResolvedValue(['English']);
    ezbeq.getYears.mockResolvedValue([2020, 2021]);
    ezbeq.getAudioTypes.mockResolvedValue(['Atmos']);
    ezbeq.getContentTypes.mockResolvedValue(['film', 'tv']);
});

describe('Filter rendering', () => {
    it('renders nothing when not visible', () => {
        const {container} = render(<Filter {...baseProps} visible={false}/>);
        expect(container).toBeEmptyDOMElement();
    });

    it('renders a field for every filter dimension when visible', async () => {
        render(<Filter {...baseProps}/>);
        expect(screen.getByText('Content Types')).toBeInTheDocument();
        expect(screen.getByText('Author')).toBeInTheDocument();
        expect(screen.getByText('Year')).toBeInTheDocument();
        expect(screen.getByText('Audio Types')).toBeInTheDocument();
        expect(screen.getByText('Fresh')).toBeInTheDocument();
        expect(screen.getByText('Language')).toBeInTheDocument();
    });

    it('populates the author options from the fetched author list', async () => {
        const {container} = render(<Filter {...baseProps}/>);

        await waitFor(() => expect(ezbeq.getAuthors).toHaveBeenCalled());

        const authorInput = screen.getByText('Author').closest('.MuiFormControl-root').querySelector('input');
        fireEvent.mouseDown(authorInput);

        expect(await screen.findByRole('option', {name: 'Author A'})).toBeInTheDocument();
        expect(screen.getByRole('option', {name: 'Author B'})).toBeInTheDocument();
    });

    it('calls setSelectedContentTypes with the new selection when a content type is picked', async () => {
        const setSelectedContentTypes = vi.fn();
        render(<Filter {...baseProps} setSelectedContentTypes={setSelectedContentTypes}/>);

        await waitFor(() => expect(ezbeq.getContentTypes).toHaveBeenCalled());
        const input = screen.getByText('Content Types').closest('.MuiFormControl-root').querySelector('input');
        fireEvent.mouseDown(input);
        fireEvent.click(await screen.findByRole('option', {name: 'film'}));

        expect(setSelectedContentTypes).toHaveBeenCalledWith(['film']);
    });
});

describe('fuzzy free-text-create matching', () => {
    it('matchAudioTypes matches case-insensitively and by substring', () => {
        expect(matchAudioTypes(['Atmos', 'DTS:X'], ['atmos'])).toEqual(['Atmos']);
        expect(matchAudioTypes(['Dolby Atmos', 'DTS:X'], ['atmos'])).toEqual(['Dolby Atmos']);
        expect(matchAudioTypes(['Atmos', 'DTS:X'], ['nomatch'])).toEqual([]);
    });

    it('matchFreshness matches case-insensitively', () => {
        expect(matchFreshness(['Fresh', 'Updated', 'Stale'], ['fresh'])).toEqual(['Fresh']);
    });

    it('matchYears matches an exact number or a substring of the year', () => {
        expect(matchYears([2020, 2021, 1999], [2020])).toEqual([2020]);
        expect(matchYears([2020, 2021, 1999], ['202'])).toEqual([2020, 2021]);
    });

    it('matchLanguages matches case-insensitively and by substring', () => {
        expect(matchLanguages(['English', 'French'], ['eng'])).toEqual(['English']);
    });
});
