import {describe, expect, it, vi} from 'vitest';
import {fireEvent, render, screen} from '@testing-library/react';
import PairMobileAppDialog, {serverOrigin} from './PairMobileAppDialog';

describe('PairMobileAppDialog', () => {
    it('renders nothing meaningful when closed', () => {
        render(<PairMobileAppDialog open={false} onClose={() => {}}/>);
        expect(screen.queryByText('Pair Mobile App')).not.toBeInTheDocument();
    });

    it('shows the current origin as text when open', () => {
        render(<PairMobileAppDialog open={true} onClose={() => {}}/>);
        expect(screen.getByText('Pair Mobile App')).toBeInTheDocument();
        expect(screen.getByText(serverOrigin())).toBeInTheDocument();
    });

    it('calls onClose when the Close button is clicked', () => {
        const onClose = vi.fn();
        render(<PairMobileAppDialog open={true} onClose={onClose}/>);

        fireEvent.click(screen.getByRole('button', {name: 'Close'}));

        expect(onClose).toHaveBeenCalled();
    });
});
