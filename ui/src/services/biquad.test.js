import {describe, expect, it} from 'vitest';
import {cascadeResponseDb, coefficientResponseDb, coeffsFor, logSpace, magnitudeDb} from './biquad';

describe('biquad', () => {
    it('matches the coefficients ezbeq/iir.py publishes for a LowShelf', () => {
        // from tests/catalogue.json, 96kHz biquads use additive feedback so a1/a2 are negated
        const c = coeffsFor('LowShelf', 33.0, 0.9, 5.0);
        expect(c.b0).toBeCloseTo(1.0003468763586854, 12);
        expect(c.b1).toBeCloseTo(-1.9979191385126602, 12);
        expect(c.b2).toBeCloseTo(0.9975784764805841, 12);
        expect(-c.a1).toBeCloseTo(1.9979204983896346, 12);
        expect(-c.a2).toBeCloseTo(-0.9979239929622952, 12);
    });

    it('has the full shelf gain far below a LowShelf and none far above it', () => {
        const c = coeffsFor('LowShelf', 30, 0.707, 6);
        expect(magnitudeDb(c, 1)).toBeCloseTo(6, 1);
        expect(magnitudeDb(c, 2000)).toBeCloseTo(0, 1);
    });

    it('has the full shelf gain far above a HighShelf and none far below it', () => {
        const c = coeffsFor('HighShelf', 100, 0.707, -4);
        expect(magnitudeDb(c, 5)).toBeCloseTo(0, 1);
        expect(magnitudeDb(c, 10000)).toBeCloseTo(-4, 1);
    });

    it('peaks at the centre frequency for a PeakingEQ', () => {
        expect(magnitudeDb(coeffsFor('PeakingEQ', 40, 2, 3), 40)).toBeCloseTo(3, 6);
    });

    it('spaces points logarithmically between the bounds', () => {
        const f = logSpace(1, 100, 3);
        expect(f[0]).toBeCloseTo(1);
        expect(f[1]).toBeCloseTo(10);
        expect(f[2]).toBeCloseTo(100);
        expect(logSpace(5, 50, 1)).toHaveLength(1);
        expect(logSpace(5, 50, 1)[0]).toBeCloseTo(5);
    });

    it('sums the response of every filter, honouring count', () => {
        const freqs = [1];
        const one = {type: 'LowShelf', freq: 30, q: 0.707, gain: 6};
        const twice = cascadeResponseDb([one, one], freqs)[0];
        expect(cascadeResponseDb([{...one, count: 2}], freqs)[0]).toBeCloseTo(twice, 10);
        expect(twice).toBeCloseTo(12, 1);
        expect(cascadeResponseDb([], freqs)).toEqual([0]);
    });

    it('ignores filter types it cannot model rather than guessing', () => {
        expect(coeffsFor('Gain', 0, 0, 3)).toBeNull();
        const shelf = {type: 'LowShelf', freq: 30, q: 0.707, gain: 6};
        expect(cascadeResponseDb([shelf, {type: 'Gain', gain: 3}], [1]))
            .toEqual(cascadeResponseDb([shelf], [1]));
    });

    describe('coefficientResponseDb', () => {
        // as published, b0 b1 b2 then the negated a1 a2
        const asLoaded = (type, freq, q, gain) => {
            const c = coeffsFor(type, freq, q, gain);
            return [c.b0, c.b1, c.b2, -c.a1, -c.a2].map(String);
        };
        const filters = [{type: 'LowShelf', freq: 20, q: 0.9, gain: 5}, {type: 'PeakingEQ', freq: 40, q: 2, gain: -3}];
        const freqs = logSpace(1, 200, 20);

        it('matches the response of the filter parameters at full precision', () => {
            const actual = coefficientResponseDb(filters.map(f => asLoaded(f.type, f.freq, f.q, f.gain)), freqs);
            cascadeResponseDb(filters, freqs).forEach((v, i) => expect(actual[i]).toBeCloseTo(v, 6));
        });

        it('shows the error from quantising the coefficients at low frequencies', () => {
            const biquads = [asLoaded('LowShelf', 10, 0.7, 10)];
            const ideal = coefficientResponseDb(biquads, [2, 1000]);
            const realised = coefficientResponseDb(biquads, [2, 1000], 96000, Math.fround);
            expect(Math.abs(realised[0] - ideal[0])).toBeGreaterThan(0.01);
            expect(realised[1]).toBeCloseTo(ideal[1], 3);
        });
    });
});
