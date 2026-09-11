import { normalInv, gaussian, percentileSorted, type Rng } from './stats';

/**
 * ROC-AUC as the Mann–Whitney U statistic: the probability that a random
 * positive scores above a random negative, ties counting one half.
 */
export function rocAuc(labels: ArrayLike<number>, scores: ArrayLike<number>): number {
  const order = sortedOrder(scores);
  return weightedAucFromOrder(order, labels, scores, null);
}

export function sortedOrder(scores: ArrayLike<number>): Uint32Array {
  const idx = new Uint32Array(scores.length);
  for (let i = 0; i < idx.length; i++) idx[i] = i;
  return idx.sort((a, b) => scores[a] - scores[b]);
}

/**
 * One linear pass over pre-sorted scores. `weights` are resample multiplicities
 * (null = every row once), which lets a bootstrap skip re-sorting.
 */
function weightedAucFromOrder(
  order: Uint32Array,
  labels: ArrayLike<number>,
  scores: ArrayLike<number>,
  weights: Uint32Array | null,
): number {
  let negBelow = 0;
  let pairsWon = 0;
  let totalPos = 0;
  let i = 0;
  while (i < order.length) {
    let j = i;
    let tiePos = 0;
    let tieNeg = 0;
    const s = scores[order[i]];
    while (j < order.length && scores[order[j]] === s) {
      const k = order[j];
      const w = weights ? weights[k] : 1;
      if (labels[k] === 1) tiePos += w;
      else tieNeg += w;
      j++;
    }
    pairsWon += tiePos * (negBelow + 0.5 * tieNeg);
    negBelow += tieNeg;
    totalPos += tiePos;
    i = j;
  }
  const pairs = totalPos * negBelow;
  return pairs > 0 ? pairsWon / pairs : NaN;
}

/**
 * Efron's percentile bootstrap: resample rows with replacement B times and
 * return the q-th percentile of the resampled AUCs.
 */
export function bootstrapAucPercentile(
  labels: ArrayLike<number>,
  scores: ArrayLike<number>,
  rng: Rng,
  B = 500,
  q = 2.5,
): number {
  const n = labels.length;
  if (n < 10) return 0.5;
  const order = sortedOrder(scores);
  const weights = new Uint32Array(n);
  const aucs: number[] = [];
  for (let b = 0; b < B; b++) {
    weights.fill(0);
    for (let i = 0; i < n; i++) weights[Math.floor(rng() * n)]++;
    const a = weightedAucFromOrder(order, labels, scores, weights);
    if (!Number.isNaN(a)) aucs.push(a);
  }
  if (aucs.length === 0) return 0.5;
  aucs.sort((a, b) => a - b);
  return percentileSorted(aucs, q);
}

/**
 * Binormal synthetic sample with a chosen true AUC:
 * negatives ~ N(0,1), positives ~ N(d′,1), AUC = Φ(d′/√2).
 */
export function binormalSample(nPos: number, nNeg: number, auc: number, rng: Rng) {
  const dPrime = Math.SQRT2 * normalInv(Math.min(0.9999, Math.max(0.0001, auc)));
  const n = nPos + nNeg;
  const labels = new Uint8Array(n);
  const scores = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const pos = i < nPos;
    labels[i] = pos ? 1 : 0;
    scores[i] = gaussian(rng) + (pos ? dPrime : 0);
  }
  return { labels, scores };
}
