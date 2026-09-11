import { describe, expect, it } from 'vitest';
import { BOUND_BY_ID } from '@/math/bounds';
import { evaluateModel } from './proof';
import { Market, toTrainingRow } from './simulator';
import { trainRun } from './trainer';

describe('simulation calibration', () => {
  it('opens the default Hoeffding jar part-way, leaving room to fill', () => {
    const now = Date.UTC(2026, 8, 12, 12);
    // Same seed the live app uses.
    const rows = new Market().history(2346, now).map(toTrainingRow);
    const run = trainRun(rows, 445, { folds: 5, resamples: 300, seed: 20_260_911 });
    const proof = evaluateModel(run, BOUND_BY_ID.hoeffding);
    console.log(`auc ${run.auc.toFixed(4)} floor ${proof.floor.toFixed(4)} jar ${(proof.jar * 100).toFixed(1)}% base ${(run.nPositive / run.n).toFixed(3)}`);
    expect(proof.jar).toBeGreaterThan(0.3);
    expect(proof.jar).toBeLessThan(0.75);
    expect(evaluateModel(run, BOUND_BY_ID.vc).jar).toBe(0); // the original's bound stays empty at this n
  });
});
