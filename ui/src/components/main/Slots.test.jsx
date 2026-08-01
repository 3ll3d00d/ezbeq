import {describe, expect, it} from 'vitest';
import {fireEvent, render, screen} from '@testing-library/react';
import Slots from './Slots';

// Regression coverage for the gain-sync bug fixed alongside 70da033: Slots derives its
// displayed gain state from the `selectedDevice` prop, but must only treat a same
// device/slot update as an external truth refresh, not clobber a value the user is
// actively editing locally.

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

const rerenderSlots = (rerender, selectedDevice) => rerender(
    <Slots selectedDevice={selectedDevice} selectedSlotId="1" useWide={true}
           setDevice={noop} setUserDriven={noop} setError={noop} setSuccess={noop}
           uploadPendingSlotId={null}/>
);

const numberInputs = (container) => Array.from(container.querySelectorAll('input[type="number"]'));

const openChannels = () => fireEvent.click(screen.getByText(/Channels/));

describe('Slots gain sync', () => {
    it('reflects an externally-applied gain change (e.g. Set Input Gain on upload) when idle', () => {
        const {rerender, container} = renderSlots(baseDevice(0));
        openChannels();
        expect(numberInputs(container)[1].value).toBe('0');

        // same device name & slot id, but the input channel gain changed server-side
        // (this is what happens after Entry.jsx's "Set Input Gain" checkbox uploads and calls setDevice(...))
        rerenderSlots(rerender, baseDevice(-3.5));

        expect(numberInputs(container)[1].value).toBe('-3.5');
    });

    it('does not clobber an in-progress local edit with a stale device poll', () => {
        const {rerender, container} = renderSlots(baseDevice(0));
        openChannels();
        const channelInput = numberInputs(container)[1];

        fireEvent.change(channelInput, {target: {value: '-5'}});
        expect(channelInput.value).toBe('-5');

        // a poll lands mid-edit still reporting the pre-edit value - must not stomp the local edit
        rerenderSlots(rerender, baseDevice(0));

        expect(channelInput.value).toBe('-5');
    });

    it('adopts a device update once it catches up to a previously-committed local edit', () => {
        const {rerender, container} = renderSlots(baseDevice(0));
        openChannels();
        const channelInput = numberInputs(container)[1];

        fireEvent.change(channelInput, {target: {value: '-5'}});

        // device state now reflects the committed edit
        rerenderSlots(rerender, baseDevice(-5));
        expect(channelInput.value).toBe('-5');

        // a subsequent, genuinely new external change should still flow through
        rerenderSlots(rerender, baseDevice(2.5));
        expect(numberInputs(container)[1].value).toBe('2.5');
    });
});
