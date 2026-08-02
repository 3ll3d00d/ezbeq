import {describe, expect, it, vi} from 'vitest';
import {fireEvent, render, screen} from '@testing-library/react';
import PythonVersionWarningSnack from './PythonVersionWarningSnack';

describe('PythonVersionWarningSnack', () => {
    it('shows nothing when python is supported', () => {
        render(<PythonVersionWarningSnack pythonUnsupported={false} pythonVersion="3.9" minPythonVersion="3.11" onDismiss={vi.fn()}/>);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('shows the running and required python versions when unsupported', () => {
        render(<PythonVersionWarningSnack pythonUnsupported={true} pythonVersion="3.9" minPythonVersion="3.11" onDismiss={vi.fn()}/>);
        expect(screen.getByText(/Running Python 3.9/)).toBeInTheDocument();
        expect(screen.getByText(/requires 3.11\+/)).toBeInTheDocument();
    });

    it('calls onDismiss when the close button is clicked', () => {
        const onDismiss = vi.fn();
        render(<PythonVersionWarningSnack pythonUnsupported={true} pythonVersion="3.9" minPythonVersion="3.11" onDismiss={onDismiss}/>);

        fireEvent.click(screen.getByRole('button', {name: 'close'}));

        expect(onDismiss).toHaveBeenCalled();
    });
});
