import { SITE } from '@/config/site';
import { confidenceLabel, jarFraction, type BoundDef } from '@/math/bounds';
import type { ModelRun } from './types';

export type GateKey = 'n_samples' | 'n_positive' | 'auc_std' | 'time_split';

type ModelStats = Pick<ModelRun, 'n' | 'nPositive' | 'auc' | 'aucStd' | 'd' | 'bootLower' | 'timeSplitGap' | 'gatesOverride'>;

// #region stage:jar
export function evaluateModel(m: ModelStats, bound: BoundDef) {
  const { epsilon, floor, pending } = bound.compute({
    n: m.n,
    nPos: m.nPositive,
    auc: m.auc,
    aucStd: m.aucStd,
    d: m.d,
    delta: SITE.delta,
    bootLower: m.bootLower,
  });

  // Every gate must pass before the jar may read 100%.
  const g = SITE.gates;
  const gates: Record<GateKey, boolean> = {
    n_samples: m.n >= g.nSamplesMin,
    n_positive: m.nPositive >= g.nPositiveMin,
    auc_std: m.aucStd < g.aucStdMax,
    time_split: m.timeSplitGap <= g.timeSplitGapMax,
    ...(m.gatesOverride as Partial<Record<GateKey, boolean>> | undefined),
  };
  const blockedBy = (Object.keys(gates) as GateKey[]).find((k) => !gates[k]) ?? null;

  const rawJar = jarFraction(floor, SITE.aucFloor, SITE.aucTarget);
  const jar = blockedBy ? Math.min(rawJar, g.jarCapWhenBlocked) : rawJar;
  const unlocked = jar >= 1; // floor ≥ 0.60 and nothing blocking: launch allowed

  return { epsilon, floor, pending: !!pending, gates, blockedBy, rawJar, jar, unlocked, confidence: confidenceLabel(floor) };
}
// #endregion

export type ProofView = ReturnType<typeof evaluateModel>;
