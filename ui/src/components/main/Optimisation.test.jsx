import {beforeEach, describe, expect, it, vi} from 'vitest';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {
    describeReason,
    EntryOptimisationChip,
    OptimisationControl,
    SlotCoefficientsChip,
    useEntryOptimisation
} from './Optimisation';
import ezbeq from '../../services/ezbeq';

vi.mock('../../services/ezbeq', () => ({
    default: {
        setOptimisationEnabled: vi.fn(),
        getEntryOptimisation: vi.fn()
    }
}));

const optimisation = (overrides = {}) => ({
    profile: 'float32-96k',
    label: 'float32 @ 96 kHz',
    enabled: true,
    available: true,
    reason: null,
    ...overrides
});

const device = (opt) => ({name: 'd1', slots: [], ...(opt === undefined ? {} : {optimisation: opt})});

describe('describeReason', () => {
    it('is null when optimised filters are in use', () => {
        expect(describeReason(null)).toBeNull();
        expect(describeReason(optimisation())).toBeNull();
    });

    it.each(['disabled', 'no_profile', 'profile_unavailable', 'rate_mismatch', 'precision_mismatch'])(
        'describes %s', (reason) => {
            expect(describeReason(optimisation({reason}))).toMatch(/authored coefficients are loaded/);
        });

    it('describes an unknown reason', () => {
        expect(describeReason(optimisation({reason: 'other'}))).toBe('Optimised filters are not in use (other)');
    });

    it('names the composite member', () => {
        expect(describeReason(optimisation({reason: 'no_profile', member: 'sub2'}))).toMatch(/^sub2: No optimised/);
    });
});

describe('OptimisationControl', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders nothing for devices which are sent filter parameters', () => {
        const {container} = render(<OptimisationControl selectedDevice={device()} setDevice={vi.fn()}
                                                        setError={vi.fn()}/>);
        expect(container).toBeEmptyDOMElement();
    });

    it('renders nothing without a device', () => {
        const {container} = render(<OptimisationControl selectedDevice={null} setDevice={vi.fn()}
                                                        setError={vi.fn()}/>);
        expect(container).toBeEmptyDOMElement();
    });

    it('shows an enabled switch and no warning when optimised filters are in use', () => {
        render(<OptimisationControl selectedDevice={device(optimisation())} setDevice={vi.fn()} setError={vi.fn()}/>);
        expect(screen.getByLabelText('Use optimised filters (float32 @ 96 kHz)')).toBeChecked();
        expect(screen.queryByText('Unoptimised')).toBeNull();
    });

    it('warns when switched off', () => {
        render(<OptimisationControl selectedDevice={device(optimisation({enabled: false, reason: 'disabled'}))}
                                    setDevice={vi.fn()} setError={vi.fn()}/>);
        expect(screen.getByRole('switch')).not.toBeChecked();
        expect(screen.getByText('Unoptimised')).toBeInTheDocument();
    });

    it('warns without a switch when the device cannot be optimised', () => {
        render(<OptimisationControl
            selectedDevice={device(optimisation({profile: null, label: null, available: false, reason: 'no_profile'}))}
            setDevice={vi.fn()} setError={vi.fn()}/>);
        expect(screen.queryByRole('switch')).toBeNull();
        expect(screen.getByText('Unoptimised')).toBeInTheDocument();
    });

    it('toggles optimisation and updates the device', async () => {
        const updated = device(optimisation({enabled: false, reason: 'disabled'}));
        ezbeq.setOptimisationEnabled.mockResolvedValue(updated);
        const setDevice = vi.fn();
        render(<OptimisationControl selectedDevice={device(optimisation())} setDevice={setDevice} setError={vi.fn()}/>);
        fireEvent.click(screen.getByRole('switch'));
        await waitFor(() => expect(setDevice).toHaveBeenCalledWith(updated));
        expect(ezbeq.setOptimisationEnabled).toHaveBeenCalledWith('d1', false);
    });

    it('reports a failed toggle', async () => {
        const err = new Error('boom');
        ezbeq.setOptimisationEnabled.mockRejectedValue(err);
        const setError = vi.fn();
        render(<OptimisationControl selectedDevice={device(optimisation())} setDevice={vi.fn()} setError={setError}/>);
        fireEvent.click(screen.getByRole('switch'));
        await waitFor(() => expect(setError).toHaveBeenCalledWith(err));
    });
});

describe('SlotCoefficientsChip', () => {
    it('shows optimised slots', () => {
        render(<SlotCoefficientsChip slot={{coefficients: 'optimised', profile: 'float32-96k'}}/>);
        expect(screen.getByText('Optimised')).toBeInTheDocument();
    });

    it('warns on unoptimised slots', () => {
        render(<SlotCoefficientsChip slot={{coefficients: 'unoptimised'}}/>);
        expect(screen.getByText('Unoptimised')).toBeInTheDocument();
    });

    it.each([{coefficients: 'standard'}, {}, null])('shows nothing for %o', (slot) => {
        const {container} = render(<SlotCoefficientsChip slot={slot}/>);
        expect(container).toBeEmptyDOMElement();
    });
});

describe('EntryOptimisationChip', () => {
    it('shows entries optimised for this device', () => {
        render(<EntryOptimisationChip entryOptimisation={{optimised: true, inUse: true, profile: 'float32-96k'}}/>);
        expect(screen.getByText('Optimised for this device')).toBeInTheDocument();
    });

    it('warns when optimised coefficients will not be used', () => {
        render(<EntryOptimisationChip entryOptimisation={{optimised: true, inUse: false, profile: 'float32-96k'}}/>);
        expect(screen.getByText('Unoptimised')).toBeInTheDocument();
    });

    it.each([null, {optimised: false, inUse: false}])('shows nothing for %o', (entryOptimisation) => {
        const {container} = render(<EntryOptimisationChip entryOptimisation={entryOptimisation}/>);
        expect(container).toBeEmptyDOMElement();
    });
});

const HookProbe = ({selectedDevice, selectedEntry}) => {
    const result = useEntryOptimisation(selectedDevice, selectedEntry);
    return <span data-testid="result">{JSON.stringify(result)}</span>;
};

describe('useEntryOptimisation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('looks up the entry for an optimisable device', async () => {
        ezbeq.getEntryOptimisation.mockResolvedValue({optimised: true, inUse: true});
        render(<HookProbe selectedDevice={device(optimisation())} selectedEntry={{id: 'e1'}}/>);
        await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('"optimised":true'));
        expect(ezbeq.getEntryOptimisation).toHaveBeenCalledWith('d1', 'e1');
    });

    it('does not look up entries for devices without a profile', () => {
        render(<HookProbe selectedDevice={device()} selectedEntry={{id: 'e1'}}/>);
        render(<HookProbe selectedDevice={device(optimisation({profile: null}))} selectedEntry={{id: 'e1'}}/>);
        expect(ezbeq.getEntryOptimisation).not.toHaveBeenCalled();
    });

    it('ignores lookup failures', async () => {
        ezbeq.getEntryOptimisation.mockRejectedValue(new Error('boom'));
        render(<HookProbe selectedDevice={device(optimisation())} selectedEntry={{id: 'e1'}}/>);
        await waitFor(() => expect(ezbeq.getEntryOptimisation).toHaveBeenCalled());
        expect(screen.getByTestId('result')).toHaveTextContent('null');
    });

    it('does not refetch when unrelated device state changes', async () => {
        ezbeq.getEntryOptimisation.mockResolvedValue({optimised: true, inUse: true});
        const {rerender} = render(<HookProbe selectedDevice={device(optimisation())} selectedEntry={{id: 'e1'}}/>);
        await waitFor(() => expect(ezbeq.getEntryOptimisation).toHaveBeenCalledTimes(1));
        rerender(<HookProbe selectedDevice={{...device(optimisation()), masterVolume: -10}} selectedEntry={{id: 'e1'}}/>);
        rerender(<HookProbe selectedDevice={device(optimisation({enabled: false, reason: 'disabled'}))}
                            selectedEntry={{id: 'e1'}}/>);
        await waitFor(() => expect(ezbeq.getEntryOptimisation).toHaveBeenCalledTimes(2));
    });
});
