import {describe, expect, it, vi} from 'vitest';
import {fireEvent, render, screen} from '@testing-library/react';
import ErrorSnack from './ErrorSnack';

describe('ErrorSnack', () => {
    it('shows nothing when there is no error', () => {
        render(<ErrorSnack err={null} setErr={vi.fn()}/>);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('shows the error message', () => {
        render(<ErrorSnack err={new Error('device offline')} setErr={vi.fn()}/>);
        expect(screen.getByText('device offline')).toBeInTheDocument();
    });

    it('calls setErr(null) when the close button is clicked', () => {
        const setErr = vi.fn();
        render(<ErrorSnack err={new Error('boom')} setErr={setErr}/>);

        fireEvent.click(screen.getByRole('button', {name: 'close'}));

        expect(setErr).toHaveBeenCalledWith(null);
    });

    it('renders a standard, bottom-left alert for a non-persistent error', () => {
        const {container} = render(<ErrorSnack err={new Error('boom')} setErr={vi.fn()}/>);
        expect(container.querySelector('.MuiSnackbar-anchorOriginBottomLeft')).toBeInTheDocument();
        expect(screen.getByRole('alert')).toHaveClass('MuiAlert-standard');
    });

    it('renders a filled, top-center alert for a persistent error', () => {
        const err = new Error('critical');
        err.persistent = true;
        const {container} = render(<ErrorSnack err={err} setErr={vi.fn()}/>);
        expect(container.querySelector('.MuiSnackbar-anchorOriginTopCenter')).toBeInTheDocument();
        expect(screen.getByRole('alert')).toHaveClass('MuiAlert-filled');
    });

    it('still dismisses a persistent error via its own close button', () => {
        const setErr = vi.fn();
        const err = new Error('critical');
        err.persistent = true;
        render(<ErrorSnack err={err} setErr={setErr}/>);

        fireEvent.click(screen.getByRole('button', {name: 'close'}));

        expect(setErr).toHaveBeenCalledWith(null);
    });

    it('replaces the message when a new error is passed in', () => {
        const {rerender} = render(<ErrorSnack err={new Error('first')} setErr={vi.fn()}/>);
        expect(screen.getByText('first')).toBeInTheDocument();

        rerender(<ErrorSnack err={new Error('second')} setErr={vi.fn()}/>);

        expect(screen.queryByText('first')).not.toBeInTheDocument();
        expect(screen.getByText('second')).toBeInTheDocument();
    });
});
