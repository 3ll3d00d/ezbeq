import {describe, expect, it, vi} from 'vitest';
import {fireEvent, render, screen} from '@testing-library/react';
import Gain from './Gain';

const gains = (overrides = {}) => ({
    master_mv: -10, master_mute: false,
    gains: [{id: '1', value: 0}],
    mutes: [{id: '1', value: false}],
    output_gains: [], output_mutes: [],
    ...overrides
});

const rangeInputs = (container) => Array.from(container.querySelectorAll('input[type="range"]'));
const numberInputs = (container) => Array.from(container.querySelectorAll('input[type="number"]'));
const openChannels = () => fireEvent.click(screen.getByText(/Channels/));

describe('Gain', () => {
    it('renders nothing when gains has no master_mv (device not yet loaded)', () => {
        const {container} = render(
            <Gain selectedSlotId="1" deviceGains={{}} gains={{}} updateGain={vi.fn()} commitGain={vi.fn()}/>
        );
        expect(container.firstChild).toBeEmptyDOMElement();
    });

    it('always renders the master row, with its own min/max/step, independent of channel support', () => {
        const g = gains({gains: [], mutes: []});
        const {container} = render(
            <Gain selectedSlotId={null} deviceGains={g} gains={g} updateGain={vi.fn()} commitGain={vi.fn()}/>
        );
        const master = rangeInputs(container)[0];
        expect(master).toHaveAttribute('min', '-127');
        expect(master).toHaveAttribute('max', '0');
        expect(master).toHaveAttribute('step', '0.5');
        expect(master).toHaveAttribute('aria-valuenow', '-10');
    });

    it('does not show the Channels toggle when no slot is selected, even if channel gains are present', () => {
        render(<Gain selectedSlotId={null} deviceGains={gains()} gains={gains()} updateGain={vi.fn()} commitGain={vi.fn()}/>);
        expect(screen.queryByText(/Channels/)).not.toBeInTheDocument();
    });

    it('does not show the Channels toggle when a slot is selected but it has no input or output gains', () => {
        const g = gains({gains: [], mutes: [], output_gains: [], output_mutes: []});
        render(<Gain selectedSlotId="1" deviceGains={g} gains={g} updateGain={vi.fn()} commitGain={vi.fn()}/>);
        expect(screen.queryByText(/Channels/)).not.toBeInTheDocument();
    });

    it('shows the channel count and keeps channel rows collapsed until clicked', () => {
        const g = gains();
        const {container} = render(
            <Gain selectedSlotId="1" deviceGains={g} gains={g} updateGain={vi.fn()} commitGain={vi.fn()}/>
        );
        expect(screen.getByText('Channels (1)')).toBeInTheDocument();
        expect(rangeInputs(container)).toHaveLength(1); // only the master row, channel row not mounted yet

        openChannels();

        expect(rangeInputs(container)).toHaveLength(2);
    });

    it('counts input and output channels together in the toggle label', () => {
        const g = gains({
            output_gains: [{id: '1', value: 0}, {id: '2', value: 0}],
            output_mutes: [{id: '1', value: false}, {id: '2', value: false}]
        });
        render(<Gain selectedSlotId="1" deviceGains={g} gains={g} updateGain={vi.fn()} commitGain={vi.fn()}/>);
        expect(screen.getByText('Channels (3)')).toBeInTheDocument(); // 1 input + 2 output
    });

    it('uses the wider input channel range (-72/12/0.25) rather than the master range', () => {
        const g = gains();
        const {container} = render(
            <Gain selectedSlotId="1" deviceGains={g} gains={g} updateGain={vi.fn()} commitGain={vi.fn()}/>
        );
        openChannels();

        const channelSlider = rangeInputs(container)[1];
        expect(channelSlider).toHaveAttribute('min', '-72');
        expect(channelSlider).toHaveAttribute('max', '12');
        expect(channelSlider).toHaveAttribute('step', '0.25');
    });

    it('labels input and output rows distinctly and separates them with a divider', () => {
        const g = gains({
            output_gains: [{id: '1', value: 0}],
            output_mutes: [{id: '1', value: false}]
        });
        render(<Gain selectedSlotId="1" deviceGains={g} gains={g} updateGain={vi.fn()} commitGain={vi.fn()}/>);
        openChannels();

        expect(screen.getByText('In 1')).toBeInTheDocument();
        expect(screen.getByText('Out 1')).toBeInTheDocument();
    });

    it('routes master gain edits through updateGain/commitGain with the "master" key', () => {
        const updateGain = vi.fn();
        const commitGain = vi.fn();
        const g = gains();
        const {container} = render(
            <Gain selectedSlotId="1" deviceGains={g} gains={g} updateGain={updateGain} commitGain={commitGain}/>
        );

        fireEvent.change(numberInputs(container)[0], {target: {value: '-20'}});
        expect(updateGain).toHaveBeenCalledWith('master', 'mv', '-20');

        fireEvent.blur(numberInputs(container)[0], {target: {value: '-20'}});
        expect(commitGain).toHaveBeenCalledWith('master', 'mv', '-20.0');
    });

    it('clamps a text-field blur value to the row min/max before committing', () => {
        const commitGain = vi.fn();
        const g = gains();
        const {container} = render(
            <Gain selectedSlotId="1" deviceGains={g} gains={g} updateGain={vi.fn()} commitGain={commitGain}/>
        );

        fireEvent.change(numberInputs(container)[0], {target: {value: '50'}}); // master max is 0
        fireEvent.blur(numberInputs(container)[0], {target: {value: '50'}});

        expect(commitGain).toHaveBeenCalledWith('master', 'mv', '0.0');
    });

    it('routes an input channel edit through updateGain/commitGain keyed by channel id', () => {
        const updateGain = vi.fn();
        const commitGain = vi.fn();
        const g = gains();
        const {container} = render(
            <Gain selectedSlotId="1" deviceGains={g} gains={g} updateGain={updateGain} commitGain={commitGain}/>
        );
        openChannels();

        fireEvent.change(numberInputs(container)[1], {target: {value: '3.5'}});
        expect(updateGain).toHaveBeenCalledWith('1', 'mv', '3.5');
    });

    it('routes an output channel edit through updateGain/commitGain with the out_ prefix', () => {
        const updateGain = vi.fn();
        const g = gains({
            gains: [], mutes: [], // isolate to output-only so the number-input index below is unambiguous
            output_gains: [{id: '1', value: 0}],
            output_mutes: [{id: '1', value: false}]
        });
        const {container} = render(
            <Gain selectedSlotId="1" deviceGains={g} gains={g} updateGain={updateGain} commitGain={vi.fn()}/>
        );
        openChannels();

        fireEvent.change(numberInputs(container)[1], {target: {value: '-6'}});
        expect(updateGain).toHaveBeenCalledWith('out_1', 'mv', '-6');
    });

    it('toggles mute via commitGain and disables the slider while muted', () => {
        const commitGain = vi.fn();
        const g = gains();
        const {container, rerender} = render(
            <Gain selectedSlotId="1" deviceGains={g} gains={g} updateGain={vi.fn()} commitGain={commitGain}/>
        );

        fireEvent.click(screen.getByRole('button', {name: 'Mute'}));
        expect(commitGain).toHaveBeenCalledWith('master', 'mute', true);

        const muted = gains({master_mute: true});
        rerender(<Gain selectedSlotId="1" deviceGains={g} gains={muted} updateGain={vi.fn()} commitGain={commitGain}/>);

        expect(rangeInputs(container)[0]).toBeDisabled();
        expect(screen.getByRole('button', {name: 'Unmute'})).toBeInTheDocument();
    });

    it('falls back to the row minimum when the local value is not a valid number', () => {
        const g = gains({master_mv: ''});
        const {container} = render(
            <Gain selectedSlotId="1" deviceGains={g} gains={g} updateGain={vi.fn()} commitGain={vi.fn()}/>
        );
        expect(rangeInputs(container)[0]).toHaveAttribute('aria-valuenow', '-127');
    });
});
