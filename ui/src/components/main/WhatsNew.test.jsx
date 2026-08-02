import {describe, expect, it, vi} from 'vitest';
import {fireEvent, render, screen} from '@testing-library/react';
import WhatsNew from './WhatsNew';

const entry = (id, overrides = {}) => ({
    id, formattedTitle: `Title ${id}`, created_at: 0, updated_at: 0, freshness: 'Fresh', ...overrides
});

const baseProps = {
    onClose: vi.fn(),
    entries: [],
    lastChecked: 100,
    onSelect: vi.fn(),
    initialMode: 'new',
    updateInfo: {updateAvailable: false},
    onDismissUpdate: vi.fn(),
    pythonInfo: {pythonUnsupported: false},
    onDismissPythonWarning: vi.fn()
};

describe('WhatsNew mode filtering', () => {
    it('shows only entries updated/created at or after lastChecked in "new" mode', () => {
        const entries = [entry(1, {created_at: 200}), entry(2, {created_at: 50, updated_at: 99})];
        render(<WhatsNew {...baseProps} entries={entries} lastChecked={100} initialMode="new"/>);

        expect(screen.getByText('Title 1')).toBeInTheDocument();
        expect(screen.queryByText('Title 2')).not.toBeInTheDocument();
    });

    it('shows every entry in "recent" mode regardless of lastChecked', () => {
        const entries = [entry(1, {created_at: 200}), entry(2, {created_at: 50, updated_at: 99})];
        render(<WhatsNew {...baseProps} entries={entries} lastChecked={100} initialMode="recent"/>);

        expect(screen.getByText('Title 1')).toBeInTheDocument();
        expect(screen.getByText('Title 2')).toBeInTheDocument();
    });

    it('switches the visible set when the New/Recent toggle is clicked', () => {
        const entries = [entry(1, {created_at: 200}), entry(2, {created_at: 50, updated_at: 99})];
        render(<WhatsNew {...baseProps} entries={entries} lastChecked={100} initialMode="new"/>);

        expect(screen.queryByText('Title 2')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: 'Recent'}));
        expect(screen.getByText('Title 2')).toBeInTheDocument();
    });

    it('shows a "nothing new" message for an empty new-mode result', () => {
        render(<WhatsNew {...baseProps} entries={[entry(1, {created_at: 0})]} lastChecked={100} initialMode="new"/>);
        expect(screen.getByText('Nothing new since your last check.')).toBeInTheDocument();
    });

    it('shows a "no recent titles" message for an empty recent-mode result', () => {
        render(<WhatsNew {...baseProps} entries={[]} initialMode="recent"/>);
        expect(screen.getByText('No recent titles in the last 2 weeks.')).toBeInTheDocument();
    });
});

describe('WhatsNew entry rendering and selection', () => {
    it('appends the year to the title when present', () => {
        render(<WhatsNew {...baseProps} entries={[entry(1, {year: 2020})]} initialMode="recent"/>);
        expect(screen.getByText('Title 1 (2020)')).toBeInTheDocument();
    });

    it('shows a "New" chip for Fresh entries and "Updated" otherwise', () => {
        render(<WhatsNew {...baseProps} entries={[entry(1, {freshness: 'Fresh'}), entry(2, {freshness: 'Stale'})]} initialMode="recent"/>);
        // "New" also appears as the mode-toggle button label, so scope to the chip label
        expect(screen.getByText('New', {selector: '.MuiChip-label'})).toBeInTheDocument();
        expect(screen.getByText('Updated')).toBeInTheDocument();
    });

    it('shows an author chip only when the entry has an author', () => {
        render(<WhatsNew {...baseProps} entries={[entry(1, {author: 'Some Author'})]} initialMode="recent"/>);
        expect(screen.getByText('Some Author')).toBeInTheDocument();
    });

    it('shows an audio type chip per audio type', () => {
        render(<WhatsNew {...baseProps} entries={[entry(1, {audioTypes: ['Atmos', 'DTS:X']})]} initialMode="recent"/>);
        expect(screen.getByText('Atmos')).toBeInTheDocument();
        expect(screen.getByText('DTS:X')).toBeInTheDocument();
    });

    it('calls onSelect with the entry id when a row is clicked', () => {
        const onSelect = vi.fn();
        render(<WhatsNew {...baseProps} entries={[entry(42)]} initialMode="recent" onSelect={onSelect}/>);

        fireEvent.click(screen.getByText('Title 42'));

        expect(onSelect).toHaveBeenCalledWith(42);
    });

    it('calls onClose when the close button is clicked', () => {
        const onClose = vi.fn();
        render(<WhatsNew {...baseProps} onClose={onClose}/>);

        fireEvent.click(screen.getByTestId('CloseIcon').closest('button'));

        expect(onClose).toHaveBeenCalled();
    });
});

describe('WhatsNew update/python notices', () => {
    it('shows the update alert and dismisses it', () => {
        const onDismissUpdate = vi.fn();
        render(<WhatsNew {...baseProps} updateInfo={{updateAvailable: true, latestVersion: '1.2.3'}} onDismissUpdate={onDismissUpdate}/>);

        expect(screen.getByText(/ezbeq 1.2.3 is available/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: 'Dismiss'}));
        expect(onDismissUpdate).toHaveBeenCalled();
    });

    it('hides the update alert when no update is available', () => {
        render(<WhatsNew {...baseProps} updateInfo={{updateAvailable: false}}/>);
        expect(screen.queryByText(/is available/)).not.toBeInTheDocument();
    });

    it('shows the python warning alert and dismisses it', () => {
        const onDismissPythonWarning = vi.fn();
        render(<WhatsNew {...baseProps}
                          pythonInfo={{pythonUnsupported: true, pythonVersion: '3.9', minPythonVersion: '3.11'}}
                          onDismissPythonWarning={onDismissPythonWarning}/>);

        expect(screen.getByText(/Running Python 3.9/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: 'Dismiss'}));
        expect(onDismissPythonWarning).toHaveBeenCalled();
    });

    it('hides the python warning alert when python is supported', () => {
        render(<WhatsNew {...baseProps} pythonInfo={{pythonUnsupported: false}}/>);
        expect(screen.queryByText(/Running Python/)).not.toBeInTheDocument();
    });
});
