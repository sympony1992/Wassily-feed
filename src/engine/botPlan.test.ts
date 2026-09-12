import { describe, expect, it } from 'vitest';
import { planTrade } from './botPlan';
import { FEATURE_NAMES } from './features';
import type { Token } from './types';

const d = FEATURE_NAMES.length;

// Zero weights, so every token scores sigmoid(bias) = p.
const modelAt = (p: number, n = 500) => ({
  n,
  medianHolders: 120,
  model: { weights: new Array(d).fill(0), bias: Math.log(p / (1 - p)), mu: new Array(d).fill(0), sigma: new Array(d).fill(1) },
});

const token = (over: Partial<Token> = {}): Token => ({
  mint: '0xabc',
  name: 'Test Coin',
  symbol: 'TEST',
  lore: 'a coin for tests',
  loreWithheld: false,
  holders: 0,
  peakMc: 12_000,
  status: 'pending',
  hour: 14,
  dow: 2,
  launchedAt: '2026-09-12T14:00:00.000Z',
  deployer: '0xdef',
  hue: 40,
  ...over,
});

describe('planTrade (coming-soon dry run)', () => {
  it('waits for a model before judging a watched token', () => {
    const plan = planTrade(token(), null, null);
    expect(plan.decision).toBe('warming');
    expect(plan.score).toBeNull();
    expect(plan.stakeUsd).toBeNull();
  });

  it('skips tokens that are already labelled, however well they score', () => {
    expect(planTrade(token({ status: 'passed' }), modelAt(0.9), { unlocked: true }).decision).toBe('skip');
  });

  it('skips a token scoring under the minimum', () => {
    const plan = planTrade(token(), modelAt(0.4), { unlocked: true });
    expect(plan.checks.score).toBe(false);
    expect(plan.decision).toBe('skip');
    expect(plan.stakeUsd).toBeNull();
  });

  it('holds a qualifying token behind the safety lock', () => {
    const plan = planTrade(token(), modelAt(0.8), { unlocked: false });
    expect(plan.decision).toBe('blocked');
    expect(plan.stakeUsd).toBe(30); // halfway from 0.60 to 1 → halfway from $10 to $50
  });

  it('enters only when every rule passes, and sets the exits', () => {
    const plan = planTrade(token(), modelAt(0.999_999), { unlocked: true });
    expect(plan.decision).toBe('enter');
    expect(plan.stakeUsd).toBe(50);
    expect(plan.takeProfitMc).toBe(30_000);
    expect(plan.stopLossMc).toBe(6_000);
    expect(plan.timeStopAt).toBe('2026-09-14T14:00:00.000Z');
  });
});
