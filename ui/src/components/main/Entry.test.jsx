import {beforeEach, describe, expect, it, vi} from 'vitest';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import Entry from './Entry';
import ezbeq from '../../services/ezbeq';

vi.mock('../../services/ezbeq', () => ({
    default: {
        loadWithMV: vi.fn(),
        sendFilter: vi.fn()
    }
}));

const gainCapableDevice = () => ({
    name: 'd1',
    slots: [{
        id: '1',
        gains: [{id: '1', value: 0}, {id: '2', value: 0}],
        mutes: [{id: '1', value: false}, {id: '2', value: false}]
    }]
});

const plainDevice = () => ({
    name: 'd1',
    slots: [{id: '1'}]
});

const entryWithMvAdjust = (mvAdjust = 3.5) => ({id: 'entry-1', title: 'Some Movie', mvAdjust});

const renderEntry = (props) => render(
    <Entry selectedDevice={null} selectedEntry={null} useWide={true} setDevice={vi.fn()}
           selectedSlotId="1" setError={vi.fn()} setSuccess={vi.fn()} setUploadPendingSlotId={vi.fn()}
           {...props}/>
);

beforeEach(() => {
    ezbeq.loadWithMV.mockReset().mockResolvedValue({name: 'd1'});
    ezbeq.sendFilter.mockReset().mockResolvedValue({name: 'd1'});
});

describe('Entry', () => {
    it('renders nothing when there is no selected entry', () => {
        const {container} = renderEntry({selectedEntry: null});
        expect(container).toBeEmptyDOMElement();
    });

    it('does not show the Set Input Gain checkbox for a slot that does not support gains', () => {
        renderEntry({selectedDevice: plainDevice(), selectedEntry: entryWithMvAdjust()});
        expect(screen.queryByRole('checkbox', {name: /Set Input Gain/i})).not.toBeInTheDocument();
    });

    it('shows the Set Input Gain checkbox, disabled, for an entry with no mvAdjust', () => {
        renderEntry({selectedDevice: gainCapableDevice(), selectedEntry: entryWithMvAdjust(0)});
        expect(screen.getByRole('checkbox', {name: /Set Input Gain/i})).toBeDisabled();
    });

    it('shows the Set Input Gain checkbox, enabled, for a gain-capable slot and an entry with mvAdjust', () => {
        renderEntry({selectedDevice: gainCapableDevice(), selectedEntry: entryWithMvAdjust(3.5)});
        expect(screen.getByRole('checkbox', {name: /Set Input Gain/i})).toBeEnabled();
    });

    it('uploads via the plain filter endpoint for a slot with no gain support', async () => {
        renderEntry({selectedDevice: plainDevice(), selectedEntry: entryWithMvAdjust()});

        fireEvent.click(screen.getByRole('button', {name: /upload/i}));

        await waitFor(() => expect(ezbeq.sendFilter).toHaveBeenCalledWith('d1', 'entry-1', '1'));
        expect(ezbeq.loadWithMV).not.toHaveBeenCalled();
    });

    it('zeroes every channel gain and leaves mutes untouched when uploading with the checkbox unchecked', async () => {
        renderEntry({selectedDevice: gainCapableDevice(), selectedEntry: entryWithMvAdjust(3.5)});

        fireEvent.click(screen.getByRole('button', {name: /upload/i}));

        await waitFor(() => expect(ezbeq.loadWithMV).toHaveBeenCalledWith('d1', 'entry-1', '1', {
            gains: [{id: '1', value: 0.0}, {id: '2', value: 0.0}],
            mutes: []
        }));
    });

    it('applies the catalogue mvAdjust and unmutes every channel when the checkbox is checked', async () => {
        renderEntry({selectedDevice: gainCapableDevice(), selectedEntry: entryWithMvAdjust(3.5)});

        fireEvent.click(screen.getByRole('checkbox', {name: /Set Input Gain/i}));
        fireEvent.click(screen.getByRole('button', {name: /upload/i}));

        await waitFor(() => expect(ezbeq.loadWithMV).toHaveBeenCalledWith('d1', 'entry-1', '1', {
            gains: [{id: '1', value: 3.5}, {id: '2', value: 3.5}],
            mutes: [{id: '1', value: false}, {id: '2', value: false}]
        }));
    });

    it('reports the returned device and a success message after a successful upload', async () => {
        const setDevice = vi.fn();
        const setSuccess = vi.fn();
        ezbeq.sendFilter.mockResolvedValue({name: 'd1', masterVolume: -10});
        renderEntry({selectedDevice: plainDevice(), selectedEntry: entryWithMvAdjust(), setDevice, setSuccess});

        fireEvent.click(screen.getByRole('button', {name: /upload/i}));

        await waitFor(() => expect(setDevice).toHaveBeenCalledWith({name: 'd1', masterVolume: -10}));
        expect(setSuccess).toHaveBeenCalledWith('Filter loaded');
    });

    it('reports the error and does not touch device state when the upload fails', async () => {
        const setDevice = vi.fn();
        const setError = vi.fn();
        const failure = new Error('device offline');
        ezbeq.sendFilter.mockRejectedValue(failure);
        renderEntry({selectedDevice: plainDevice(), selectedEntry: entryWithMvAdjust(), setDevice, setError});

        fireEvent.click(screen.getByRole('button', {name: /upload/i}));

        await waitFor(() => expect(setError).toHaveBeenCalledWith(failure));
        expect(setDevice).not.toHaveBeenCalled();
    });
});
