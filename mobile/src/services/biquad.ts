import type { FilterParams } from '../types/ezbeq';

// Ported from ui/src/services/biquad.js: RBJ cookbook biquads, mirroring ezbeq/iir.py, so a
// filter's frequency response can be computed client side from {type, freq, gain, q} alone.
const FS = 96000;

export type Coefficients = { b0: number; b1: number; b2: number; a1: number; a2: number };

// null for a type with no biquad here, as ezbeq/iir.py does not support it either
export const coeffsFor = (type: string, freq: number, q: number, gain: number, fs = FS): Coefficients | null => {
  const w0 = (2.0 * Math.PI * freq) / fs;
  const cosW0 = Math.cos(w0);
  const alpha = Math.sin(w0) / (2.0 * q);
  const A = Math.pow(10.0, gain / 40.0);
  const sqrtA = Math.sqrt(A);
  let a0: number, a1: number, a2: number, b0: number, b1: number, b2: number;
  if (type === 'LowShelf') {
    a0 = A + 1 + (A - 1) * cosW0 + 2.0 * sqrtA * alpha;
    a1 = -2.0 * (A - 1 + (A + 1) * cosW0);
    a2 = A + 1 + (A - 1) * cosW0 - 2.0 * sqrtA * alpha;
    b0 = A * (A + 1 - (A - 1) * cosW0 + 2.0 * sqrtA * alpha);
    b1 = 2.0 * A * (A - 1 - (A + 1) * cosW0);
    b2 = A * (A + 1 - (A - 1) * cosW0 - 2.0 * sqrtA * alpha);
  } else if (type === 'HighShelf') {
    a0 = A + 1 - (A - 1) * cosW0 + 2.0 * sqrtA * alpha;
    a1 = 2.0 * (A - 1 - (A + 1) * cosW0);
    a2 = A + 1 - (A - 1) * cosW0 - 2.0 * sqrtA * alpha;
    b0 = A * (A + 1 + (A - 1) * cosW0 + 2.0 * sqrtA * alpha);
    b1 = -2.0 * A * (A - 1 + (A + 1) * cosW0);
    b2 = A * (A + 1 + (A - 1) * cosW0 - 2.0 * sqrtA * alpha);
  } else if (type === 'PeakingEQ') {
    a0 = 1.0 + alpha / A;
    a1 = -2.0 * cosW0;
    a2 = 1.0 - alpha / A;
    b0 = 1.0 + alpha * A;
    b1 = -2.0 * cosW0;
    b2 = 1.0 - alpha * A;
  } else {
    return null;
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
};

export const magnitudeDb = (c: Coefficients, freq: number, fs = FS): number => {
  const w = (2.0 * Math.PI * freq) / fs;
  const cos1 = Math.cos(w);
  const sin1 = Math.sin(w);
  const cos2 = Math.cos(2 * w);
  const sin2 = Math.sin(2 * w);
  const num = Math.hypot(c.b0 + c.b1 * cos1 + c.b2 * cos2, -c.b1 * sin1 - c.b2 * sin2);
  const den = Math.hypot(1 + c.a1 * cos1 + c.a2 * cos2, -c.a1 * sin1 - c.a2 * sin2);
  return den === 0 ? 0 : 20 * Math.log10(num / den);
};

export const logSpace = (min: number, max: number, points: number): number[] => {
  const logMin = Math.log10(min);
  const logMax = Math.log10(max);
  return Array.from({ length: points }, (_, i) =>
    Math.pow(10, logMin + (points === 1 ? 0 : i / (points - 1)) * (logMax - logMin))
  );
};

// cascaded response in dB at each of freqs, each filter applied `count` times, unsupported types are ignored
export const cascadeResponseDb = (filters: FilterParams[], freqs: number[], fs = FS): number[] => {
  const totals = new Array<number>(freqs.length).fill(0);
  filters.forEach((f) => {
    const c = coeffsFor(f.type, f.freq, f.q, f.gain, fs);
    if (!c) return;
    const count = f.count || 1;
    freqs.forEach((freq, i) => {
      totals[i] += count * magnitudeDb(c, freq, fs);
    });
  });
  return totals;
};

// cascaded response in dB of biquads as loaded into a device, [b0, b1, b2, a1, a2] with the a terms negated (the
// minidsp convention used by ezbeq/iir.py and the catalogue), quantise models the device's coefficient storage
export const coefficientResponseDb = (
  biquads: (string | number)[][],
  freqs: number[],
  fs = FS,
  quantise: (v: number) => number = (v) => v
): number[] => {
  const totals = new Array<number>(freqs.length).fill(0);
  biquads.forEach((bq) => {
    const [b0, b1, b2, a1, a2] = bq.map((v) => quantise(Number(v)));
    const c = { b0, b1, b2, a1: -a1, a2: -a2 };
    freqs.forEach((freq, i) => {
      totals[i] += magnitudeDb(c, freq, fs);
    });
  });
  return totals;
};
