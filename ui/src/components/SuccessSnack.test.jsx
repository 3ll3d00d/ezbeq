import {describe, expect, it, vi} from 'vitest';
import {fireEvent, render, screen} from '@testing-library/react';
import SuccessSnack from './SuccessSnack';

describe('SuccessSnack', () => {
    it('shows nothing when there is no message', () => {
        render(<SuccessSnack msg={null} setMsg={vi.fn()}/>);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('shows the given message', () => {
        render(<SuccessSnack msg="Filter loaded" setMsg={vi.fn()}/>);
        expect(screen.getByText('Filter loaded')).toBeInTheDocument();
        expect(screen.getByRole('alert')).toHaveClass('MuiAlert-colorSuccess');
    });

    it('calls setMsg(null) when the alert is closed', () => {
        const setMsg = vi.fn();
        render(<SuccessSnack msg="Filter loaded" setMsg={setMsg}/>);

        fireEvent.click(screen.getByRole('button', {name: 'Close'}));

        expect(setMsg).toHaveBeenCalledWith(null);
    });

    it('replaces the message when a new one is passed in', () => {
        const {rerender} = render(<SuccessSnack msg="first" setMsg={vi.fn()}/>);
        expect(screen.getByText('first')).toBeInTheDocument();

        rerender(<SuccessSnack msg="second" setMsg={vi.fn()}/>);

        expect(screen.queryByText('first')).not.toBeInTheDocument();
        expect(screen.getByText('second')).toBeInTheDocument();
    });
});
