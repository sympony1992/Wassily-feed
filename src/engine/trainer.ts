import { bootstrapAucPercentile, rocAuc } from '@/math/auc';
import { mean, median, rngFromSeed, std } from '@/math/stats';
import { FEATURE_NAMES, featurize } from './features';
import { fitLogistic, predictProba, stratifiedFolds } from './model';
import type { ModelRun, TrainingRow } from './types';

export interface TrainOptions {
  folds: number;
  resamples: number;
  seed: number;
  quick?: boolean; // fit only — used to replay older cycles at boot
}

export type TrainResult = Omit<ModelRun, 'ranAt' | 'source'>;

export function trainRun(rows: TrainingRow[], runId: number, opt: TrainOptions): TrainResult {
  const n = rows.length;
  const d = FEATURE_NAMES.length;
  const X = new Float64Array(n * d);
  const y = new Uint8Array(n);
  rows.forEach((r, i) => {
    featurize(r, X, i * d);
    y[i] = r.passed;
  });
  const nPositive = y.reduce((s, v) => s + v, 0);
  const hourCounts = new Array(24).fill(0);
  const hourWins = new Array(24).fill(0);
  rows.forEach((r) => {
    hourCounts[r.hour]++;
    hourWins[r.hour] += r.passed;
  });
  const all = Uint32Array.from({ length: n }, (_, i) => i);
  const base = {
    runId,
    n,
    nPositive,
    d,
    hourCounts,
    hourRates: hourCounts.map((c, h) => (c ? hourWins[h] / c : 0)),
    medianHolders: median(rows.map((r) => r.holders)),
  };

  if (n < 20 || nPositive === 0 || nPositive === n) {
    return { ...base, auc: 0.5, aucStd: 0, foldAucs: [], timeSplitGap: 0, bootLower: 0.5, featureImportance: {}, model: fitLogistic(X, y, d, all, 1, 1) };
  }

  const model = fitLogistic(X, y, d, all);
  const featureImportance = importance(model.weights);
  if (opt.quick) {
    return { ...base, auc: 0.5, aucStd: 0, foldAucs: [], timeSplitGap: 0, bootLower: 0.5, featureImportance, model };
  }

  // #region stage:evaluating
  // k-fold stratified CV: every token is scored by a model that never saw it.
  const rng = rngFromSeed(opt.seed ^ runId);
  const k = Math.min(opt.folds, Math.max(2, Math.floor(n / 10)));
  const fold = stratifiedFolds(y, k, rng);
  const oof = new Float64Array(n);
  const foldAucs: number[] = [];
  for (let f = 0; f < k; f++) {
    const train = all.filter((i) => fold[i] !== f);
    const test = all.filter((i) => fold[i] === f);
    const m = fitLogistic(X, y, d, train);
    const labels = new Uint8Array(test.length);
    const scores = new Float64Array(test.length);
    test.forEach((row, j) => {
      oof[row] = scores[j] = predictProba(m, X, row * d);
      labels[j] = y[row];
    });
    foldAucs.push(rocAuc(labels, scores));
  }
  const auc = mean(foldAucs);

  // Leakage sanity check: train on the oldest 70%, test on the newest 30%.
  const byTime = [...all].sort((a, b) => rows[a].launchedAt - rows[b].launchedAt);
  const cut = Math.floor(n * 0.7);
  const tm = fitLogistic(X, y, d, byTime.slice(0, cut));
  const future = byTime.slice(cut);
  const timeAuc = rocAuc(future.map((i) => y[i]), future.map((i) => predictProba(tm, X, i * d)));
  const timeSplitGap = Number.isNaN(timeAuc) ? 0 : Math.abs(auc - timeAuc);

  // Efron: resample out-of-fold predictions, keep the 2.5th percentile.
  const bootLower = bootstrapAucPercentile(y, oof, rng, opt.resamples, 2.5);
  // #endregion

  return { ...base, auc, aucStd: std(foldAucs), foldAucs, timeSplitGap, bootLower, featureImportance, model };
}

function importance(weights: number[]): Record<string, number> {
  const abs = weights.map(Math.abs);
  const total = abs.reduce((a, b) => a + b, 0) || 1;
  return Object.fromEntries(FEATURE_NAMES.map((name, j) => [name, abs[j] / total]));
}
