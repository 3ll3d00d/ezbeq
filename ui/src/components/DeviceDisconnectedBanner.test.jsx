import {describe, expect, it} from 'vitest';
import {render, screen} from '@testing-library/react';
import DeviceDisconnectedBanner from './DeviceDisconnectedBanner';

describe('DeviceDisconnectedBanner', () => {
    it('shows the title and the given device name', () => {
        render(<DeviceDisconnectedBanner deviceName="minidsp-1"/>);
        expect(screen.getByText('Device Unreachable')).toBeInTheDocument();
        expect(screen.getByText(/minidsp-1 is not responding/)).toBeInTheDocument();
    });

    it('renders as a filled error alert', () => {
        render(<DeviceDisconnectedBanner deviceName="minidsp-1"/>);
        const alert = screen.getByRole('alert');
        expect(alert).toHaveClass('MuiAlert-filled');
        expect(alert).toHaveClass('MuiAlert-colorError');
    });
});
