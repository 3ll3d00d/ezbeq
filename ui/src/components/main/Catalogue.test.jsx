import {describe, expect, it, vi} from 'vitest';
import {fireEvent, render, screen} from '@testing-library/react';
import Catalogue from './Catalogue';

const entry = (id, author, formattedTitle, edition = '') => ({
    id, author, formattedTitle, edition, sortTitle: formattedTitle.toLowerCase(), audioTypes: 'Atmos', avsUrl: '', url: false
});

describe('Catalogue', () => {
    it('renders a grid row per entry, with the title text', () => {
        const entries = [entry(1, 'Alice Smith', 'Movie One'), entry(2, 'Bob Jones', 'Movie Two')];
        render(<Catalogue entries={entries} setSelectedEntryId={vi.fn()} selectedEntryId={-1} useWide={true} selectedDevice={null}/>);

        expect(screen.getByText('Movie One')).toBeInTheDocument();
        expect(screen.getByText('Movie Two')).toBeInTheDocument();
    });

    it('calls setSelectedEntryId with the row id when a row is clicked', () => {
        const setSelectedEntryId = vi.fn();
        const entries = [entry(1, 'Alice Smith', 'Movie One'), entry(2, 'Bob Jones', 'Movie Two')];
        render(<Catalogue entries={entries} setSelectedEntryId={setSelectedEntryId} selectedEntryId={-1} useWide={true} selectedDevice={null}/>);

        fireEvent.click(screen.getByText('Movie Two'));

        expect(setSelectedEntryId).toHaveBeenCalledWith(2);
    });

    it('hides the author avatar column when every entry shares the same author', () => {
        const entries = [entry(1, 'Alice Smith', 'Movie One'), entry(2, 'Alice Smith', 'Movie Two')];
        render(<Catalogue entries={entries} setSelectedEntryId={vi.fn()} selectedEntryId={-1} useWide={true} selectedDevice={null}/>);

        expect(screen.queryByRole('columnheader', {name: /^$/})).not.toBeInTheDocument();
        // the avatar-column initial ("A") is not rendered anywhere when the column is hidden
        expect(screen.queryByText('A')).not.toBeInTheDocument();
    });

    it('shows the author avatar column when entries have different authors', () => {
        const entries = [entry(1, 'Alice Smith', 'Movie One'), entry(2, 'Bob Jones', 'Movie Two')];
        render(<Catalogue entries={entries} setSelectedEntryId={vi.fn()} selectedEntryId={-1} useWide={true} selectedDevice={null}/>);

        expect(screen.getByText('A')).toBeInTheDocument();
        expect(screen.getByText('B')).toBeInTheDocument();
    });

    it('hides the edition column in narrow (non-wide) mode', () => {
        const entries = [entry(1, 'Alice Smith', 'Movie One', 'Extended Edition')];
        render(<Catalogue entries={entries} setSelectedEntryId={vi.fn()} selectedEntryId={-1} useWide={false} selectedDevice={null}/>);

        expect(screen.queryByText('Extended Edition')).not.toBeInTheDocument();
    });

    it('shows the edition column in wide mode', () => {
        const entries = [entry(1, 'Alice Smith', 'Movie One', 'Extended Edition')];
        render(<Catalogue entries={entries} setSelectedEntryId={vi.fn()} selectedEntryId={-1} useWide={true} selectedDevice={null}/>);

        expect(screen.getByText('Extended Edition')).toBeInTheDocument();
    });

    it('renders a link for entries that have a url, plain text otherwise', () => {
        const withUrl = {...entry(1, 'Alice Smith', 'Movie One'), url: true, avsUrl: 'https://example.com/1'};
        const withoutUrl = entry(2, 'Alice Smith', 'Movie Two');
        render(<Catalogue entries={[withUrl, withoutUrl]} setSelectedEntryId={vi.fn()} selectedEntryId={-1} useWide={true} selectedDevice={null}/>);

        expect(screen.getByRole('link', {name: 'Movie One'})).toHaveAttribute('href', 'https://example.com/1');
        expect(screen.queryByRole('link', {name: 'Movie Two'})).not.toBeInTheDocument();
    });
});
