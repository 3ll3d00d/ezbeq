import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import ezbeq from './ezbeq';

describe('buildTargetedPayload', () => {
    it('builds a master gain payload with no slots key', () => {
        expect(ezbeq.buildTargetedPayload('master', 'mv', '-15.5', '1')).toEqual({masterVolume: -15.5});
    });

    it('builds a master mute payload with no slots key', () => {
        expect(ezbeq.buildTargetedPayload('master', 'mute', true, '1')).toEqual({mute: true});
    });

    it('builds an input channel gain payload', () => {
        expect(ezbeq.buildTargetedPayload('2', 'mv', '-3.5', '1')).toEqual({
            slots: [{id: '1', gains: [{id: '2', value: -3.5}]}]
        });
    });

    it('builds an input channel mute payload', () => {
        expect(ezbeq.buildTargetedPayload('2', 'mute', true, '1')).toEqual({
            slots: [{id: '1', mutes: [{id: '2', value: true}]}]
        });
    });

    it('builds an output channel gain payload from the out_ prefixed id', () => {
        expect(ezbeq.buildTargetedPayload('out_3', 'mv', '-6', '1')).toEqual({
            slots: [{id: '1', outputGains: [{id: '3', value: -6}]}]
        });
    });

    it('builds an output channel mute payload from the out_ prefixed id', () => {
        expect(ezbeq.buildTargetedPayload('out_3', 'mute', true, '1')).toEqual({
            slots: [{id: '1', outputMutes: [{id: '3', value: true}]}]
        });
    });
});

describe('createPatchPayload', () => {
    it('includes masterVolume and mute when present', () => {
        const payload = ezbeq.createPatchPayload(null, {master_mv: -12.5, master_mute: true});
        expect(payload.masterVolume).toBe(-12.5);
        expect(payload.mute).toBe(true);
    });

    it('includes gains and mutes for the target slot', () => {
        const payload = ezbeq.createPatchPayload('1', {
            gains: [{id: '1', value: '0'}],
            mutes: [{id: '1', value: false}]
        });
        expect(payload.slots).toEqual([{
            id: '1',
            gains: [{id: '1', value: 0}],
            mutes: [{id: '1', value: false}]
        }]);
    });

    it('omits empty output gain/mute arrays rather than sending an empty list', () => {
        const payload = ezbeq.createPatchPayload('1', {
            gains: [{id: '1', value: 0}],
            mutes: [{id: '1', value: false}],
            output_gains: [],
            output_mutes: []
        });
        expect(payload.slots[0]).not.toHaveProperty('outputGains');
        expect(payload.slots[0]).not.toHaveProperty('outputMutes');
    });

    it('includes non-empty output gains/mutes', () => {
        const payload = ezbeq.createPatchPayload('1', {
            output_gains: [{id: '1', value: '-2'}],
            output_mutes: [{id: '1', value: true}]
        });
        expect(payload.slots[0].outputGains).toEqual([{id: '1', value: -2}]);
        expect(payload.slots[0].outputMutes).toEqual([{id: '1', value: true}]);
    });

    it('attaches the catalogue entry to the slot when an entryId is given', () => {
        const payload = ezbeq.createPatchPayload('1', {gains: [{id: '1', value: 0}]}, 'abc123');
        expect(payload.slots[0].entry).toBe('abc123');
    });

    // guard added alongside the per-field PATCH work: a master-only update (no slot selected)
    // must not emit a `slots` array at all, since the server only patches slots it's told about
    it('omits the slots key entirely when no slot id is given, even with an entry to load', () => {
        const payload = ezbeq.createPatchPayload(null, {master_mv: -10}, 'abc123');
        expect(payload).not.toHaveProperty('slots');
        expect(payload.masterVolume).toBe(-10);
    });

    it('omits the slots key when slotId is undefined', () => {
        const payload = ezbeq.createPatchPayload(undefined, {gains: [{id: '1', value: 0}]});
        expect(payload).not.toHaveProperty('slots');
    });
});

describe('network calls', () => {
    beforeEach(() => {
        global.fetch = vi.fn();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('sendFilter without gains PUTs the entry id to the slot', async () => {
        global.fetch.mockResolvedValue({ok: true, json: () => Promise.resolve({name: 'd1'})});

        await ezbeq.sendFilter('d1', 'entry-1', '1');

        expect(global.fetch).toHaveBeenCalledWith('/api/1/devices/d1/filter/1', expect.objectContaining({
            method: 'PUT',
            body: JSON.stringify({entryId: 'entry-1'})
        }));
    });

    it('sendFilter with gains PATCHes the targeted device endpoint with the built payload', async () => {
        global.fetch.mockResolvedValue({ok: true, json: () => Promise.resolve({name: 'd1'})});

        await ezbeq.sendFilter('d1', 'entry-1', '1', {master_mv: -10});

        expect(global.fetch).toHaveBeenCalledWith('/api/3/devices/d1', expect.objectContaining({
            method: 'PATCH',
            body: JSON.stringify({masterVolume: -10, slots: [{id: '1', entry: 'entry-1'}]})
        }));
    });

    it('doGet throws with the endpoint name on a non-ok response', async () => {
        global.fetch.mockResolvedValue({ok: false, status: 404});

        await expect(ezbeq.doGet('authors')).rejects.toThrow('EzBeq.getauthors failed, HTTP status 404');
    });

    it('surfaces the server message for a 5xx PATCH failure', async () => {
        global.fetch.mockResolvedValue({
            ok: false, status: 500,
            json: () => Promise.resolve({message: 'device offline'})
        });

        await expect(ezbeq.patchSingle('d1', 'master', 'mv', '-5', '1'))
            .rejects.toThrow(/device offline/);
    });

    it('raises a generic error for a 4xx PATCH failure without a message body', async () => {
        global.fetch.mockResolvedValue({ok: false, status: 400});

        await expect(ezbeq.patchSingle('d1', 'master', 'mv', '-5', '1'))
            .rejects.toThrow(/invalid request \(400\)/);
    });
});
