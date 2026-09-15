import { describe, expect, it } from 'vitest';
import { FEATURE_NAMES } from './features';
import { scoreToken, tradeSignal } from './tradeSignal';
import type { ScoringModel, Token } from './types';

const HOUR = 3_600_000;
const NOW = 1_789_000_000_000;

// Only the holder count moves this model: score = sigmoid(−2 + log1p(holders)).
const d = FEATURE_NAMES.length;
const model: ScoringModel = {
  bias: -2,
  weights: FEATURE_NAMES.map((n) => (n === 'holders_log' ? 1 : 0)),
  mu: new Array(d).fill(0),
  sigma: new Array(d).fill(1),
};

const token = (over: Partial<Token> = {}): Token => ({
  mint: '0x1000000000000000000000000000000000000001',
  name: 'Patient Otter',
  symbol: 'POTR',
  lore: '',
  loreRaw: '',
  loreWithheld: false,
  holders: 20,
  holdersMissing: false,
  peakMc: 15_000,
  status: 'pending',
  hour: 3,
  dow: 1,
  launchedAt: new Date(NOW - 3 * HOUR).toISOString(),
  deployer: '',
  hue: 38,
  ...over,
});

describe('Trade signal', () => {
  it('is active for a watched token between entry and target, scored at or above the minimum, while the jar is full', () => {
    const s = tradeSignal(token(), model, true, NOW);
    expect(s.score).toBeCloseTo(1 / (1 + Math.exp(-(-2 + Math.log1p(20)))), 10);
    expect(s).toMatchObject({ state: 'active', blockedBy: null });
    expect(s.ageHours).toBeCloseTo(3, 5);
  });

  it('keeps the button but disables it while the jar is not full', () => {
    expect(tradeSignal(token(), model, false, NOW)).toMatchObject({ state: 'disabled', blockedBy: 'jar' });
  });

  it('shows no button when any token gate fails, naming the first one', () => {
    expect(tradeSignal(token({ status: 'stalled' }), model, true, NOW)).toMatchObject({ state: 'none', blockedBy: 'watching' });
    expect(tradeSignal(token({ launchedAt: new Date(NOW - 0.5 * HOUR).toISOString() }), model, true, NOW)).toMatchObject({ state: 'none', blockedBy: 'age' });
    expect(tradeSignal(token({ launchedAt: new Date(NOW - 49 * HOUR).toISOString() }), model, true, NOW)).toMatchObject({ state: 'none', blockedBy: 'age' });
    expect(tradeSignal(token({ peakMc: 9_000 }), model, true, NOW)).toMatchObject({ state: 'none', blockedBy: 'entry' });
    expect(tradeSignal(token({ peakMc: 30_000 }), model, true, NOW)).toMatchObject({ state: 'none', blockedBy: 'below_target' }); // its answer is already in
    expect(tradeSignal(token({ holdersMissing: true }), model, true, NOW)).toMatchObject({ state: 'none', blockedBy: 'holders', score: null });
    expect(tradeSignal(token({ holders: 2 }), model, true, NOW)).toMatchObject({ state: 'none', blockedBy: 'score' });
  });

  it('never scores without the real model or the real holder count', () => {
    expect(scoreToken(token(), { bias: 0, weights: [], mu: [], sigma: [] })).toBeNull(); // the browser only has an empty model
    expect(scoreToken(token(), null)).toBeNull();
    expect(scoreToken(token({ holdersMissing: true }), model)).toBeNull();
  });
});
