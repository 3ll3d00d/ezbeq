import {beforeEach, describe, expect, it, vi} from 'vitest';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {
    describeReason,
    EntryOptimisationChip,
    isOptimisable,
    OptimisationControl,
    SlotCoefficientsChip,
    slotOptimises,
    useEntryOptimisation,
    useOptimisedEntryIds
} from './Optimisation';
import ezbeq from '../../services/ezbeq';

vi.mock('../../services/ezbeq', () => ({
    default: {
        setOptimise: vi.fn(),
        getEntryOptimisation: vi.fn(),
        getOptimisedEntries: vi.fn()
    }
}));

const optimisation = (overrides = {}) => ({
    profile: 'float32-96k',
    label: 'float32 @ 96 kHz',
    available: true,
    reason: null,
    ...overrides
});

const device = (opt) => ({name: 'd1', slots: [], ...(opt === undefined ? {} : {optimisation: opt})});

// slot 1 optimises, slot 2 does not
const slotted = (opt) => ({...device(opt), slots: [{id: '1', optimise: true}, {id: '2', optimise: false}]});

describe('describeReason', () => {
    it('is null when optimised filters are in use', () => {
        expect(describeReason(null)).toBeNull();
        expect(describeReason(optimisation())).toBeNull();
    });

    it.each(['no_profile', 'profile_unavailable', 'rate_mismatch', 'precision_mismatch'])(
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

    it('shows a labelled switch for the selected slot', () => {
        render(<OptimisationControl selectedDevice={slotted(optimisation())} selectedSlotId="1" setDevice={vi.fn()}
                                    setError={vi.fn()}/>);
        expect(screen.getByText('Optimise')).toBeInTheDocument();
        expect(screen.getByRole('switch', {name: 'Load filters optimised for float32 @ 96 kHz into slot 1'})).toBeChecked();
        expect(screen.getByRole('switch')).toBeEnabled();
    });

    it('reflects the setting of the selected slot', () => {
        const {rerender} = render(<OptimisationControl selectedDevice={slotted(optimisation())} selectedSlotId="2"
                                                       setDevice={vi.fn()} setError={vi.fn()}/>);
        expect(screen.getByRole('switch')).not.toBeChecked();
        rerender(<OptimisationControl selectedDevice={slotted(optimisation())} selectedSlotId="1"
                                      setDevice={vi.fn()} setError={vi.fn()}/>);
        expect(screen.getByRole('switch')).toBeChecked();
    });

    it('treats a slot which does not report the setting as optimising', () => {
        render(<OptimisationControl selectedDevice={{...device(optimisation()), slots: [{id: '1'}]}} selectedSlotId="1"
                                    setDevice={vi.fn()} setError={vi.fn()}/>);
        expect(screen.getByRole('switch')).toBeChecked();
    });

    it('names the slot, and the device when the profile has no label', () => {
        render(<OptimisationControl
            selectedDevice={{...device(optimisation({label: null})), slots: [{id: '1', name: 'Movies'}]}}
            selectedSlotId="1" setDevice={vi.fn()} setError={vi.fn()}/>);
        expect(screen.getByRole('switch', {name: 'Load filters optimised for this device into slot Movies'})).toBeChecked();
    });

    it('is disabled for a device which does not report its slots', () => {
        render(<OptimisationControl selectedDevice={{name: 'd1', optimisation: optimisation()}} selectedSlotId="1"
                                    setDevice={vi.fn()} setError={vi.fn()}/>);
        expect(screen.getByRole('switch', {name: /into the selected slot$/})).toBeDisabled();
    });

    it('is disabled when no slot is selected', () => {
        render(<OptimisationControl selectedDevice={slotted(optimisation())} selectedSlotId={null}
                                    setDevice={vi.fn()} setError={vi.fn()}/>);
        expect(screen.getByRole('switch')).toBeDisabled();
    });

    it('shows a disabled switch when the device cannot be optimised', () => {
        render(<OptimisationControl
            selectedDevice={slotted(optimisation({profile: null, label: null, available: false, reason: 'no_profile'}))}
            selectedSlotId="1" setDevice={vi.fn()} setError={vi.fn()}/>);
        expect(screen.getByRole('switch')).not.toBeChecked();
        expect(screen.getByRole('switch')).toBeDisabled();
    });

    it('toggles optimisation for the selected slot and updates the device', async () => {
        const updated = slotted(optimisation());
        ezbeq.setOptimise.mockResolvedValue(updated);
        const setDevice = vi.fn();
        render(<OptimisationControl selectedDevice={slotted(optimisation())} selectedSlotId="1" setDevice={setDevice}
                                    setError={vi.fn()}/>);
        fireEvent.click(screen.getByRole('switch'));
        await waitFor(() => expect(setDevice).toHaveBeenCalledWith(updated));
        expect(ezbeq.setOptimise).toHaveBeenCalledWith('d1', '1', false);
    });

    it('reports a failed toggle', async () => {
        const err = new Error('boom');
        ezbeq.setOptimise.mockRejectedValue(err);
        const setError = vi.fn();
        render(<OptimisationControl selectedDevice={slotted(optimisation())} selectedSlotId="1" setDevice={vi.fn()}
                                    setError={setError}/>);
        fireEvent.click(screen.getByRole('switch'));
        await waitFor(() => expect(setError).toHaveBeenCalledWith(err));
    });
});

describe('slotOptimises', () => {
    it('is false only for a missing slot or one which has optimisation off', () => {
        expect(slotOptimises(null)).toBe(false);
        expect(slotOptimises({id: '1', optimise: false})).toBe(false);
        expect(slotOptimises({id: '1', optimise: true})).toBe(true);
        expect(slotOptimises({id: '1'})).toBe(true);
    });
});

describe('isOptimisable', () => {
    it('is true only for a device with an available profile', () => {
        expect(isOptimisable(null)).toBe(false);
        expect(isOptimisable(device())).toBe(false);
        expect(isOptimisable(device(optimisation()))).toBe(true);
        expect(isOptimisable(device(optimisation({available: false, reason: 'profile_unavailable'})))).toBe(false);
    });
});

const IdsProbe = ({selectedDevice, selectedOptimisation, setError}) => {
    const ids = useOptimisedEntryIds(selectedDevice, selectedOptimisation, null, setError);
    return <span data-testid="ids">{ids ? [...ids].join(',') : 'none'}</span>;
};

describe('useOptimisedEntryIds', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('loads ids only while searching on optimisation', async () => {
        ezbeq.getOptimisedEntries.mockResolvedValue({profiles: ['float32-96k'], ids: ['e1', 'e2']});
        const {rerender} = render(<IdsProbe selectedDevice={device(optimisation())} selectedOptimisation={null}/>);
        expect(ezbeq.getOptimisedEntries).not.toHaveBeenCalled();
        expect(screen.getByTestId('ids')).toHaveTextContent('none');
        rerender(<IdsProbe selectedDevice={device(optimisation())} selectedOptimisation="optimised"/>);
        await waitFor(() => expect(screen.getByTestId('ids')).toHaveTextContent('e1,e2'));
        expect(ezbeq.getOptimisedEntries).toHaveBeenCalledWith('d1');
    });

    it('does not load ids for a device which cannot be optimised', () => {
        render(<IdsProbe selectedDevice={device()} selectedOptimisation="optimised"/>);
        expect(ezbeq.getOptimisedEntries).not.toHaveBeenCalled();
    });

    it('ignores a load which completes after the search has changed', async () => {
        let resolve;
        ezbeq.getOptimisedEntries.mockReturnValueOnce(new Promise(r => {
            resolve = r;
        }));
        const {rerender} = render(<IdsProbe selectedDevice={device(optimisation())} selectedOptimisation="optimised"/>);
        rerender(<IdsProbe selectedDevice={device(optimisation())} selectedOptimisation={null}/>);
        resolve({profiles: ['float32-96k'], ids: ['e1']});
        await Promise.resolve();
        expect(screen.getByTestId('ids')).toHaveTextContent('none');
    });

    it('ignores a failure which completes after the search has changed', async () => {
        let reject;
        ezbeq.getOptimisedEntries.mockReturnValueOnce(new Promise((_, r) => {
            reject = r;
        }));
        const setError = vi.fn();
        const {rerender} = render(<IdsProbe selectedDevice={device(optimisation())} selectedOptimisation="optimised"
                                            setError={setError}/>);
        rerender(<IdsProbe selectedDevice={device(optimisation())} selectedOptimisation={null} setError={setError}/>);
        reject(new Error('boom'));
        await Promise.resolve();
        await Promise.resolve();
        expect(setError).not.toHaveBeenCalled();
    });

    it('reports a failed load', async () => {
        const err = new Error('boom');
        ezbeq.getOptimisedEntries.mockRejectedValue(err);
        const setError = vi.fn();
        render(<IdsProbe selectedDevice={device(optimisation())} selectedOptimisation="optimised" setError={setError}/>);
        await waitFor(() => expect(setError).toHaveBeenCalledWith(err));
        expect(screen.getByTestId('ids')).toHaveTextContent('none');
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
        render(<EntryOptimisationChip entryOptimisation={{optimised: true, profile: 'float32-96k'}}/>);
        expect(screen.getByText('Optimised for this device')).toBeInTheDocument();
    });

    it('warns when the target slot will not use the optimised coefficients', () => {
        render(<EntryOptimisationChip entryOptimisation={{optimised: true, profile: 'float32-96k'}} optimise={false}/>);
        expect(screen.getByText('Unoptimised')).toBeInTheDocument();
    });

    it.each([null, {optimised: false}])('shows nothing for %o', (entryOptimisation) => {
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
        ezbeq.getEntryOptimisation.mockResolvedValue({optimised: true});
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

    it('ignores a lookup which completes after the entry has changed', async () => {
        let resolve;
        ezbeq.getEntryOptimisation.mockReturnValueOnce(new Promise(r => {
            resolve = r;
        }));
        const {rerender} = render(<HookProbe selectedDevice={device(optimisation())} selectedEntry={{id: 'e1'}}/>);
        rerender(<HookProbe selectedDevice={device(optimisation())} selectedEntry={null}/>);
        resolve({optimised: true});
        await Promise.resolve();
        expect(screen.getByTestId('result')).toHaveTextContent('null');
    });

    it('ignores a failure which completes after the entry has changed', async () => {
        let reject;
        ezbeq.getEntryOptimisation.mockReturnValueOnce(new Promise((_, r) => {
            reject = r;
        }));
        const {rerender} = render(<HookProbe selectedDevice={device(optimisation())} selectedEntry={{id: 'e1'}}/>);
        rerender(<HookProbe selectedDevice={device(optimisation())} selectedEntry={null}/>);
        reject(new Error('boom'));
        await Promise.resolve();
        await Promise.resolve();
        expect(screen.getByTestId('result')).toHaveTextContent('null');
    });

    it('does not refetch when unrelated device state changes', async () => {
        ezbeq.getEntryOptimisation.mockResolvedValue({optimised: true});
        const {rerender} = render(<HookProbe selectedDevice={device(optimisation())} selectedEntry={{id: 'e1'}}/>);
        await waitFor(() => expect(ezbeq.getEntryOptimisation).toHaveBeenCalledTimes(1));
        rerender(<HookProbe selectedDevice={{...device(optimisation()), masterVolume: -10}} selectedEntry={{id: 'e1'}}/>);
        rerender(<HookProbe selectedDevice={device(optimisation({profile: 'float32-48k'}))}
                            selectedEntry={{id: 'e1'}}/>);
        await waitFor(() => expect(ezbeq.getEntryOptimisation).toHaveBeenCalledTimes(2));
    });
});
