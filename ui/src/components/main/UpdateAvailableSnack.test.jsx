import {describe, expect, it, vi} from 'vitest';
import {fireEvent, render, screen} from '@testing-library/react';
import UpdateAvailableSnack from './UpdateAvailableSnack';

describe('UpdateAvailableSnack', () => {
    it('shows nothing when no update is available', () => {
        render(<UpdateAvailableSnack updateAvailable={false} latestVersion="1.2.3" onDismiss={vi.fn()}/>);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('shows the latest version and a link to the release when an update is available', () => {
        render(<UpdateAvailableSnack updateAvailable={true} latestVersion="1.2.3" onDismiss={vi.fn()}/>);
        expect(screen.getByText(/ezbeq 1.2.3 is available/)).toBeInTheDocument();
        expect(screen.getByRole('link', {name: "See what's new"}))
            .toHaveAttribute('href', 'https://github.com/3ll3d00d/ezbeq/releases/tag/1.2.3');
    });

    it('calls onDismiss when the close button is clicked', () => {
        const onDismiss = vi.fn();
        render(<UpdateAvailableSnack updateAvailable={true} latestVersion="1.2.3" onDismiss={onDismiss}/>);

        fireEvent.click(screen.getByRole('button', {name: 'close'}));

        expect(onDismiss).toHaveBeenCalled();
    });
});
