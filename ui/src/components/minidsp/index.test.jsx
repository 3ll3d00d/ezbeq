import {beforeEach, describe, expect, it, vi} from 'vitest';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {createTheme} from '@mui/material/styles';
import Minidsp from './index';
import ezbeq from '../../services/ezbeq';

vi.mock('../../services/ezbeq', () => ({
    default: {sendTextCommands: vi.fn()}
}));

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

describe('Minidsp advanced upload form', () => {
    beforeEach(() => {
        ezbeq.sendTextCommands.mockReset();
        // useLocalStorage persists commandType/inputs/outputs to real jsdom localStorage
        // (that's the point of it in prod), so tests must clear it or leak into each other
        window.localStorage.clear();
    });

    const deviceWithChannels = (inputs, outputs) => ({
        name: 'minidsp',
        type: 'minidsp',
        slots: [{id: '1', last: 'Test Filter', inputs, outputs}]
    });

    const renderMinidsp = (device, overrides = {}) => render(
        <Minidsp availableDevices={{minidsp: device}} setSelectedDeviceName={() => {}}
                 selectedDeviceName="minidsp" selectedSlotId="1" setErr={() => {}}
                 setSelectedNav={() => {}} selectedNav="control" theme={theme} {...overrides}/>
    );

    it('only shows input/output channel selectors when the slot has channels of that kind', () => {
        renderMinidsp(deviceWithChannels(0, 0));
        expect(screen.queryByLabelText('Input')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Output')).not.toBeInTheDocument();
    });

    it('shows the right number of input and output channels as selectable options', () => {
        renderMinidsp(deviceWithChannels(2, 4));
        expect(screen.getByLabelText('Input')).toBeInTheDocument();
        expect(screen.getByLabelText('Output')).toBeInTheDocument();

        fireEvent.mouseDown(screen.getByLabelText('Input'));
        expect(screen.getAllByRole('option')).toHaveLength(2);
    });

    it('disables Upload until there are commands to send', () => {
        renderMinidsp(deviceWithChannels(0, 0));
        expect(screen.getByRole('button', {name: /Upload/})).toBeDisabled();

        fireEvent.change(screen.getByLabelText('Biquads'), {target: {value: 'bq1 ...'}});

        expect(screen.getByRole('button', {name: /Upload/})).toBeEnabled();
    });

    it('relabels the command text field for the selected mode', () => {
        renderMinidsp(deviceWithChannels(0, 0));
        expect(screen.getByLabelText('Biquads')).toBeInTheDocument();

        fireEvent.mouseDown(screen.getByLabelText('Mode'));
        fireEvent.click(screen.getByRole('option', {name: 'RS'}));

        expect(screen.getByLabelText('Minidsp RS')).toBeInTheDocument();
    });

    it('uploads the entered commands, swapping in a spinner icon without crashing while pending', async () => {
        let resolveUpload;
        ezbeq.sendTextCommands.mockReturnValue(new Promise(r => { resolveUpload = r; }));
        const {container} = renderMinidsp(deviceWithChannels(0, 0));

        fireEvent.change(screen.getByLabelText('Biquads'), {target: {value: 'bq1 ...'}});
        const uploadButton = screen.getByRole('button', {name: /Upload/});
        fireEvent.click(uploadButton);

        // this used to throw ReferenceError: CircularProgress is not defined (missing import)
        expect(container.querySelector('.MuiCircularProgress-root')).toBeInTheDocument();

        resolveUpload({});
        await waitFor(() => expect(container.querySelector('.MuiCircularProgress-root')).not.toBeInTheDocument());
        expect(ezbeq.sendTextCommands).toHaveBeenCalledWith('minidsp', '1', [], [], 'bq', 'bq1 ...', true);
    });

    it('reports an error via setErr when the upload fails', async () => {
        const setErr = vi.fn();
        const failure = new Error('device offline');
        ezbeq.sendTextCommands.mockRejectedValue(failure);
        renderMinidsp(deviceWithChannels(0, 0), {setErr});

        fireEvent.change(screen.getByLabelText('Biquads'), {target: {value: 'bq1 ...'}});
        fireEvent.click(screen.getByRole('button', {name: /Upload/}));

        await waitFor(() => expect(setErr).toHaveBeenCalledWith(failure));
    });

    it('sends overwrite=false when the Overwrite switch is turned off', async () => {
        ezbeq.sendTextCommands.mockResolvedValue({});
        renderMinidsp(deviceWithChannels(0, 0));

        fireEvent.click(screen.getByRole('switch', {name: /Overwrite/}));
        fireEvent.change(screen.getByLabelText('Biquads'), {target: {value: 'bq1 ...'}});
        fireEvent.click(screen.getByRole('button', {name: /Upload/}));

        await waitFor(() => expect(ezbeq.sendTextCommands).toHaveBeenCalledWith('minidsp', '1', [], [], 'bq', 'bq1 ...', false));
    });
});
