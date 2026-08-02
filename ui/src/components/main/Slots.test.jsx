import {describe, expect, it} from 'vitest';
import {fireEvent, render, screen} from '@testing-library/react';
import Slots from './Slots';

// Exhaustive gain-sync logic (merge, debounce, string/number normalization) is covered against
// the shared hook directly in services/gains.test.js. This just confirms Slots is actually
// wired up to it - i.e. that a device prop update reaches the rendered gain controls.

const noop = () => {};

const baseDevice = (channelGain, masterVolume = -20) => ({
    name: 'minidsp',
    masterVolume,
    mute: false,
    slots: [{
        id: '1',
        last: 'Test Filter',
        gains: [{id: '1', value: channelGain}],
        mutes: [{id: '1', value: false}],
        outputGains: [],
        outputMutes: []
    }]
});

const renderSlots = (selectedDevice) => render(
    <Slots selectedDevice={selectedDevice} selectedSlotId="1" useWide={true}
           setDevice={noop} setUserDriven={noop} setError={noop} setSuccess={noop}
           uploadPendingSlotId={null}/>
);

const numberInputs = (container) => Array.from(container.querySelectorAll('input[type="number"]'));

describe('Slots gain panel wiring', () => {
    it('reflects an externally-applied gain change (e.g. Set Input Gain on upload) when idle', () => {
        const {rerender, container} = renderSlots(baseDevice(0));
        fireEvent.click(screen.getByText(/Channels/));
        expect(numberInputs(container)[1].value).toBe('0');

        // same device name & slot id, but the input channel gain changed server-side
        // (this is what happens after Entry.jsx's "Set Input Gain" checkbox uploads and calls setDevice(...))
        rerender(
            <Slots selectedDevice={baseDevice(-3.5)} selectedSlotId="1" useWide={true}
                   setDevice={noop} setUserDriven={noop} setError={noop} setSuccess={noop}
                   uploadPendingSlotId={null}/>
        );

        expect(numberInputs(container)[1].value).toBe('-3.5');
    });
});
