import {describe, expect, it} from 'vitest';
import {fireEvent, render, screen} from '@testing-library/react';
import {createTheme} from '@mui/material/styles';
import Minidsp from './index';

const theme = createTheme();

// Exhaustive gain-sync logic is covered against the shared hook directly in
// services/gains.test.js. This just confirms Minidsp is actually wired up to it.

const noop = () => {};

const baseDevice = (channelGain, masterVolume = -20) => ({
    name: 'minidsp',
    type: 'minidsp',
    masterVolume,
    mute: false,
    slots: [{
        id: '1',
        last: 'Test Filter',
        inputs: 1,
        outputs: 0,
        gains: [{id: '1', value: channelGain}],
        mutes: [{id: '1', value: false}],
        outputGains: [],
        outputMutes: []
    }]
});

const baseProps = (selectedDevice) => ({
    availableDevices: {minidsp: selectedDevice},
    setSelectedDeviceName: noop,
    selectedDeviceName: 'minidsp',
    selectedSlotId: '1',
    setErr: noop,
    setSelectedNav: noop,
    selectedNav: 'control',
    theme
});

const numberInputs = (container) => Array.from(container.querySelectorAll('input[type="number"]'));

describe('Minidsp gain panel wiring', () => {
    it('reflects an externally-applied gain change (e.g. Set Input Gain on upload) when idle', () => {
        const {rerender, container} = render(<Minidsp {...baseProps(baseDevice(0))}/>);
        fireEvent.click(screen.getByText(/Channels/));
        expect(numberInputs(container)[1].value).toBe('0');

        rerender(<Minidsp {...baseProps(baseDevice(-3.5))}/>);

        expect(numberInputs(container)[1].value).toBe('-3.5');
    });
});
