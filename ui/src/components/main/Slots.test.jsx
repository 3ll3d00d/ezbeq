import {beforeEach, describe, expect, it, vi} from 'vitest';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import Slots from './Slots';
import ezbeq from '../../services/ezbeq';

vi.mock('../../services/ezbeq', () => ({
    default: {
        clearSlot: vi.fn(),
        activateSlot: vi.fn(),
        patchSingle: vi.fn(() => Promise.resolve({}))
    }
}));

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

describe('Slots slot management', () => {
    beforeEach(() => {
        ezbeq.clearSlot.mockReset();
        ezbeq.activateSlot.mockReset();
    });

    const slotsDevice = () => ({
        name: 'minidsp',
        slots: [
            {id: '1', last: 'Filter One'},
            {id: '2', last: 'Filter Two'},
            {id: '3', last: 'Filter Three'}
        ]
    });

    const clearButtonFor = (text) => screen.getByText(text).closest('.MuiPaper-root').querySelector('button');

    const renderSlotsFull = (props) => render(
        <Slots selectedDevice={slotsDevice()} selectedSlotId={null} useWide={true}
               setDevice={vi.fn()} setUserDriven={vi.fn()} setError={vi.fn()} setSuccess={vi.fn()}
               uploadPendingSlotId={null} {...props}/>
    );

    it('renders a row per slot, using the slot id as a fallback label', () => {
        renderSlotsFull();
        expect(screen.getByText('1: Filter One')).toBeInTheDocument();
        expect(screen.getByText('2: Filter Two')).toBeInTheDocument();
        expect(screen.getByText('3: Filter Three')).toBeInTheDocument();
    });

    it('activates a slot when clicked and reports the returned device', async () => {
        const setDevice = vi.fn();
        const setUserDriven = vi.fn();
        ezbeq.activateSlot.mockResolvedValue({name: 'minidsp', active: '2'});
        renderSlotsFull({setDevice, setUserDriven});

        fireEvent.click(screen.getByText('2: Filter Two'));

        expect(ezbeq.activateSlot).toHaveBeenCalledWith('minidsp', '2');
        await waitFor(() => expect(setDevice).toHaveBeenCalledWith({name: 'minidsp', active: '2'}));
        expect(setUserDriven).toHaveBeenCalledWith(true);
    });

    it('activates a slot when the surrounding card is clicked, not just its text', () => {
        ezbeq.activateSlot.mockResolvedValue({name: 'minidsp', active: '2'});
        renderSlotsFull();

        const card = screen.getByText('2: Filter Two').closest('.MuiPaper-root');
        fireEvent.click(card);

        expect(ezbeq.activateSlot).toHaveBeenCalledWith('minidsp', '2');
    });

    it('clears a slot when its clear button is clicked and reports success', async () => {
        const setDevice = vi.fn();
        const setSuccess = vi.fn();
        ezbeq.clearSlot.mockResolvedValue({name: 'minidsp'});
        renderSlotsFull({setDevice, setSuccess});

        fireEvent.click(clearButtonFor('1: Filter One'));

        expect(ezbeq.clearSlot).toHaveBeenCalledWith('minidsp', '1');
        await waitFor(() => expect(setDevice).toHaveBeenCalledWith({name: 'minidsp'}));
        expect(setSuccess).toHaveBeenCalledWith('Slot cleared');
    });

    it('clearing a slot does not also activate it, even though the clear button now sits inside the clickable card', () => {
        renderSlotsFull();

        fireEvent.click(clearButtonFor('1: Filter One'));

        expect(ezbeq.activateSlot).not.toHaveBeenCalled();
    });

    it('shows a pending spinner and disables the button while a clear is in flight', async () => {
        let resolveClear;
        ezbeq.clearSlot.mockReturnValue(new Promise(r => { resolveClear = r; }));
        renderSlotsFull();

        const button = clearButtonFor('1: Filter One');
        fireEvent.click(button);

        expect(button).toBeDisabled();

        resolveClear({name: 'minidsp'});
        await waitFor(() => expect(button).not.toBeDisabled());
    });

    it('reports an error and stops the spinner when clearing fails', async () => {
        const setError = vi.fn();
        const failure = new Error('device offline');
        ezbeq.clearSlot.mockRejectedValue(failure);
        renderSlotsFull({setError});

        const button = clearButtonFor('1: Filter One');
        fireEvent.click(button);

        await waitFor(() => expect(setError).toHaveBeenCalledWith(failure));
        expect(button).not.toBeDisabled();
    });

    it('treats the slot named by uploadPendingSlotId as pending too', () => {
        renderSlotsFull({uploadPendingSlotId: '3'});
        expect(clearButtonFor('3: Filter Three')).toBeDisabled();
        expect(clearButtonFor('1: Filter One')).not.toBeDisabled();
    });
});

describe('Slots optimisation', () => {
    it('shows the optimisation control and the coefficients loaded in each slot', () => {
        renderSlots({
            ...baseDevice(0),
            optimisation: {profile: 'float32-96k', label: 'float32 @ 96 kHz', available: true, reason: null},
            slots: [
                {...baseDevice(0).slots[0], coefficients: 'optimised', profile: 'float32-96k', optimise: false},
                {...baseDevice(0).slots[0], id: '2', coefficients: 'unoptimised', profile: 'float32-96k'}
            ]
        });
        // the toggle shows the selected slot's (slot 1) setting, in the master volume row
        expect(screen.getByText('Optimise')).toBeInTheDocument();
        expect(screen.getByRole('switch', {name: /into slot 1$/})).not.toBeChecked();
        expect(screen.getByText('Optimised')).toBeInTheDocument();
        expect(screen.getAllByText('Unoptimised')).toHaveLength(1);
    });

    it('shows the optimisation control above the slots for a device without a master volume', () => {
        const {masterVolume: _masterVolume, ...device} = baseDevice(0);
        renderSlots({
            ...device,
            optimisation: {profile: 'float32-96k', label: 'float32 @ 96 kHz', available: true, reason: null}
        });
        expect(screen.getByRole('switch', {name: /into slot 1$/})).toBeChecked();
    });
});
