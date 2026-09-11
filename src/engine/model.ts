import type { ScoringModel } from './types';
import type { Rng } from '@/math/stats';

// #region stage:training
/**
 * Class-balanced, L2-regularised logistic regression fitted by Newton's method
 * (IRLS). Survivors are the minority, so each class carries equal total weight.
 */
export function fitLogistic(X: Float64Array, y: Uint8Array, d: number, rows: ArrayLike<number>, l2 = 1, iterations = 12): ScoringModel {
  const { mu, sigma } = standardizer(X, d, rows);
  const D = d + 1; // bias first
  const theta = new Float64Array(D);
  let nPos = 0;
  for (let r = 0; r < rows.length; r++) nPos += y[rows[r]];
  const nNeg = rows.length - nPos;
  const wPos = nPos ? rows.length / (2 * nPos) : 0;
  const wNeg = nNeg ? rows.length / (2 * nNeg) : 0;

  const z = new Float64Array(D);
  const grad = new Float64Array(D);
  const H = new Float64Array(D * D);

  for (let it = 0; it < iterations; it++) {
    grad.fill(0);
    H.fill(0);
    for (let r = 0; r < rows.length; r++) {
      const i = rows[r];
      z[0] = 1;
      for (let j = 0; j < d; j++) z[j + 1] = (X[i * d + j] - mu[j]) / sigma[j];
      let s = 0;
      for (let j = 0; j < D; j++) s += theta[j] * z[j];
      const p = 1 / (1 + Math.exp(-s));
      const c = y[i] ? wPos : wNeg;
      const g = c * (p - y[i]);
      const h = c * p * (1 - p);
      for (let a = 0; a < D; a++) {
        grad[a] += g * z[a];
        const hz = h * z[a];
        for (let b = a; b < D; b++) H[a * D + b] += hz * z[b];
      }
    }
    for (let a = 0; a < D; a++) for (let b = 0; b < a; b++) H[a * D + b] = H[b * D + a];
    for (let j = 1; j < D; j++) {
      grad[j] += l2 * theta[j];
      H[j * D + j] += l2;
    }
    H[0] += 1e-6;
    const step = choleskySolve(H, grad, D);
    let moved = 0;
    for (let j = 0; j < D; j++) {
      theta[j] -= step[j];
      moved = Math.max(moved, Math.abs(step[j]));
    }
    if (moved < 1e-7) break;
  }

  return { bias: theta[0], weights: Array.from(theta.subarray(1)), mu: Array.from(mu), sigma: Array.from(sigma) };
}
// #endregion

export function predictProba(m: ScoringModel, x: ArrayLike<number>, offset = 0): number {
  let s = m.bias;
  for (let j = 0; j < m.weights.length; j++) s += (m.weights[j] * (x[offset + j] - m.mu[j])) / m.sigma[j];
  return 1 / (1 + Math.exp(-s));
}

function standardizer(X: Float64Array, d: number, rows: ArrayLike<number>) {
  const mu = new Float64Array(d);
  const sigma = new Float64Array(d);
  for (let r = 0; r < rows.length; r++) for (let j = 0; j < d; j++) mu[j] += X[rows[r] * d + j];
  for (let j = 0; j < d; j++) mu[j] /= Math.max(1, rows.length);
  for (let r = 0; r < rows.length; r++) for (let j = 0; j < d; j++) sigma[j] += (X[rows[r] * d + j] - mu[j]) ** 2;
  for (let j = 0; j < d; j++) {
    const s = Math.sqrt(sigma[j] / Math.max(1, rows.length));
    sigma[j] = s > 1e-9 ? s : 1;
  }
  return { mu, sigma };
}

function choleskySolve(A: Float64Array, b: Float64Array, n: number): Float64Array {
  const L = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i * n + j];
      for (let k = 0; k < j; k++) s -= L[i * n + k] * L[j * n + k];
      L[i * n + j] = i === j ? Math.sqrt(Math.max(s, 1e-12)) : s / L[j * n + j];
    }
  }
  const yv = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= L[i * n + k] * yv[k];
    yv[i] = s / L[i * n + i];
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = yv[i];
    for (let k = i + 1; k < n; k++) s -= L[k * n + i] * x[k];
    x[i] = s / L[i * n + i];
  }
  return x;
}

/** Shuffle each class separately and deal rows round-robin into k folds. */
export function stratifiedFolds(y: Uint8Array, k: number, rng: Rng): Uint8Array {
  const fold = new Uint8Array(y.length);
  for (const cls of [0, 1]) {
    const idx: number[] = [];
    for (let i = 0; i < y.length; i++) if (y[i] === cls) idx.push(i);
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    idx.forEach((row, pos) => (fold[row] = pos % k));
  }
  return fold;
}
