import {describe, expect, it} from 'vitest';
import {fireEvent, render, screen} from '@testing-library/react';
import {createTheme} from '@mui/material/styles';
import Minidsp from './index';

const theme = createTheme();

// Same regression coverage as Slots.test.jsx: Minidsp duplicates the identical gain-sync
// effect (copy-pasted in 70da033), so it carries the same failure modes independently.

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

const renderMinidsp = (selectedDevice) => render(<Minidsp {...baseProps(selectedDevice)}/>);

const rerenderMinidsp = (rerender, selectedDevice) => rerender(<Minidsp {...baseProps(selectedDevice)}/>);

const numberInputs = (container) => Array.from(container.querySelectorAll('input[type="number"]'));

const openChannels = () => fireEvent.click(screen.getByText(/Channels/));

describe('Minidsp gain sync', () => {
    it('reflects an externally-applied gain change (e.g. Set Input Gain on upload) when idle', () => {
        const {rerender, container} = renderMinidsp(baseDevice(0));
        openChannels();
        expect(numberInputs(container)[1].value).toBe('0');

        rerenderMinidsp(rerender, baseDevice(-3.5));

        expect(numberInputs(container)[1].value).toBe('-3.5');
    });

    it('does not clobber an in-progress local edit with a stale device poll', () => {
        const {rerender, container} = renderMinidsp(baseDevice(0));
        openChannels();
        const channelInput = numberInputs(container)[1];

        fireEvent.change(channelInput, {target: {value: '-5'}});
        expect(channelInput.value).toBe('-5');

        rerenderMinidsp(rerender, baseDevice(0));

        expect(channelInput.value).toBe('-5');
    });

    it('adopts a device update once it catches up to a previously-committed local edit', () => {
        const {rerender, container} = renderMinidsp(baseDevice(0));
        openChannels();
        const channelInput = numberInputs(container)[1];

        fireEvent.change(channelInput, {target: {value: '-5'}});

        rerenderMinidsp(rerender, baseDevice(-5));
        expect(channelInput.value).toBe('-5');

        rerenderMinidsp(rerender, baseDevice(2.5));
        expect(numberInputs(container)[1].value).toBe('2.5');
    });
});
