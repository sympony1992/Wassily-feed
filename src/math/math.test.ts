import { describe, expect, it } from 'vitest';
import { rocAuc, bootstrapAucPercentile, binormalSample } from './auc';
import { BOUNDS, BOUND_BY_ID, jarFraction, vcEpsilon, confidenceLabel } from './bounds';
import { sha256Fields, sha256Hex } from './sha256';
import { betaCdf, betaInv, normalCdf, normalInv, rngFromSeed } from './stats';

describe('sha256', () => {
  it('matches FIPS test vectors', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('a'.repeat(1000))).toBe('41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3');
  });
  it('separates fields so ("ab","c") ≠ ("a","bc")', () => {
    expect(sha256Fields(['ab', 'c'])).not.toBe(sha256Fields(['a', 'bc']));
  });
});

describe('AUC', () => {
  it('counts ties as one half', () => {
    expect(rocAuc([0, 1], [0.2, 0.8])).toBe(1);
    expect(rocAuc([0, 1], [0.5, 0.5])).toBe(0.5);
    expect(rocAuc([0, 0, 1, 1], [0.1, 0.4, 0.35, 0.8])).toBe(0.75);
  });
  it('binormal samples hit the requested AUC', () => {
    const { labels, scores } = binormalSample(3000, 7000, 0.7, rngFromSeed(1));
    expect(rocAuc(labels, scores)).toBeCloseTo(0.7, 1);
    const lower = bootstrapAucPercentile(labels, scores, rngFromSeed(2), 200);
    expect(lower).toBeLessThan(rocAuc(labels, scores));
    expect(lower).toBeGreaterThan(0.68);
  });
});

describe('distributions', () => {
  it('normal quantiles round-trip', () => {
    expect(normalInv(0.95)).toBeCloseTo(1.6449, 3);
    expect(normalCdf(normalInv(0.3))).toBeCloseTo(0.3, 6);
  });
  it('beta quantiles round-trip', () => {
    expect(betaCdf(0.5, 2, 2)).toBeCloseTo(0.5, 6);
    expect(betaCdf(betaInv(0.05, 887, 544), 887, 544)).toBeCloseTo(0.05, 6);
  });
});

describe('bounds', () => {
  const base = { n: 2346, nPos: 723, auc: 0.62, aucStd: 0.0087, d: 28, delta: 0.05, bootLower: 0.6 };

  it('VC epsilon matches the original dashboard (0.274 at n=2346, d=28)', () => {
    expect(vcEpsilon(2346, 28, 0.05)).toBeCloseTo(0.2738, 3);
    expect(vcEpsilon(28, 28, 0.05)).toBe(1);
    const e = vcEpsilon(340, 28, 0.05);
    expect(e > 0 && e < 1).toBe(true);
  });

  it('every bound returns a floor below the measured AUC', () => {
    for (const b of BOUNDS) {
      const r = b.compute(base);
      expect(r.floor, b.id).toBeLessThanOrEqual(base.auc);
      expect(r.epsilon, b.id).toBeGreaterThanOrEqual(0);
    }
  });

  it('penalties shrink as the sample grows', () => {
    for (const b of BOUNDS.filter((x) => !x.uses.includes('bootstrap'))) {
      const small = b.compute({ ...base, n: 500, nPos: 154 }).epsilon;
      const large = b.compute({ ...base, n: 20000, nPos: 6160 }).epsilon;
      expect(large, b.id).toBeLessThan(small);
    }
  });

  it('Bayes and Wilcoxon agree in large samples (Bernstein–von Mises)', () => {
    const w = BOUND_BY_ID.wilcoxon.compute(base).floor;
    const bay = BOUND_BY_ID.bayes.compute(base).floor;
    expect(Math.abs(w - bay)).toBeLessThan(0.003);
  });

  it('jar and confidence mapping', () => {
    expect(jarFraction(0.55, 0.5, 0.6)).toBeCloseTo(0.5);
    expect(jarFraction(0.3, 0.5, 0.6)).toBe(0);
    expect(jarFraction(0.7, 0.5, 0.6)).toBe(1);
    expect(confidenceLabel(-0.14)).toBe('none');
    expect(confidenceLabel(0.6)).toBe('provisional');
  });
});
