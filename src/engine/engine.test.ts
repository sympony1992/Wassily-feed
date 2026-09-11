import { describe, expect, it } from 'vitest';
import { PERSONAS } from '@/config/personas';
import { sha256Fields } from '@/math/sha256';
import { generateCycle } from './ideas';
import { sanitizeLore } from './sanitize';
import { Market, toTrainingRow } from './simulator';
import { trainRun } from './trainer';

const NOW = Date.UTC(2026, 8, 11, 16, 0, 0);

describe('simulated market + trainer', () => {
  const tokens = new Market(7).history(2346, NOW);
  const rows = tokens.map(toTrainingRow);
  const run = trainRun(rows, 444, { folds: 5, resamples: 300, seed: 99 });

  it('has a realistic base rate and a modest, learnable signal', () => {
    const rate = run.nPositive / run.n;
    console.log('base rate', rate.toFixed(3), 'cv auc', run.auc.toFixed(4), '±', run.aucStd.toFixed(4), 'gap', run.timeSplitGap.toFixed(4), 'boot', run.bootLower.toFixed(4));
    console.log('importance', Object.entries(run.featureImportance).sort((a, b) => b[1] - a[1]).slice(0, 6));
    expect(rate).toBeGreaterThan(0.24);
    expect(rate).toBeLessThan(0.38);
    expect(run.auc).toBeGreaterThan(0.56);
    expect(run.auc).toBeLessThan(0.75);
    expect(run.bootLower).toBeLessThan(run.auc);
    expect(run.d).toBe(28);
  });

  it('never labels a token younger than 48h', () => {
    expect(tokens.every((t) => NOW - Date.parse(t.launchedAt) >= 48 * 3600_000)).toBe(true);
  });

  it('generates 100 reproducible, verifiable candidates', () => {
    const p = PERSONAS[0];
    const input = {
      cycleId: 1418,
      runId: 444,
      model: run.model,
      medianHolders: run.medianHolders,
      dow: 3,
      names: p.ideas.names,
      suffixes: p.ideas.suffixes,
      lores: p.ideas.lores,
      deployedNames: new Set(tokens.map((t) => t.name.toLowerCase())),
      stolenNames: new Set<string>(),
      auc: run.auc,
      floor: 0.5,
      now: new Date(NOW),
    };
    const a = generateCycle(input);
    const b = generateCycle(input);
    console.log('rejected', a.nRejected, a.ruleHits, 'leader', a.candidates[0].name, a.candidates[0].score.toFixed(4));
    expect(a.candidates).toHaveLength(100);
    expect(a.candidates.map((c) => c.commitment)).toEqual(b.candidates.map((c) => c.commitment));
    const c = a.candidates[0];
    expect(c.commitment).toBe(sha256Fields([c.name, c.lore, String(c.hour), '444']));
    expect(a.nRejected).toBeGreaterThan(0);
    expect(a.candidates.every((x) => !/guaranteed|100x|\beth\b/i.test(x.name))).toBe(true);
    // A stolen leader disappears from the replay and is counted as excluded.
    const stolen = generateCycle({ ...input, stolenNames: new Set([c.name.toLowerCase()]) });
    expect(stolen.candidates.some((x) => x.name === c.name)).toBe(false);
    expect(stolen.nExcluded).toBeGreaterThan(0);
  });
});

describe('lore safety', () => {
  it('strips urls and control characters, withholds blocked words', () => {
    expect(sanitizeLore('hi' + String.fromCharCode(0x200b) + ' there https://evil.example/x').display).toBe('hi there');
    expect(sanitizeLore('holy shit').withheld).toBe(true);
    expect(sanitizeLore('x'.repeat(400)).display).toHaveLength(280);
  });
});
