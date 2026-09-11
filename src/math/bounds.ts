import { betaInv, clamp, normalInv } from './stats';

// #region stage:the-jar
/**
 * Every bound answers the same question: given a measured AUC, how far below
 * it could the true AUC sit, with confidence 1 − δ? The jar fills with the
 * floor (AUC − ε), never with the raw score.
 */
export interface BoundInput {
  n: number; // labelled tokens
  nPos: number; // tokens that reached the target
  auc: number; // measured (cross-validated) ROC-AUC
  aucStd: number; // std of AUC across CV folds
  d: number; // model capacity
  delta: number; // 1 − confidence
  bootLower?: number | null; // Efron percentile lower bound, when available
}

export interface BoundResult {
  epsilon: number; // ≥ 1 means "the penalty takes everything"
  floor: number; // AUC − ε, unclamped
  pending?: boolean; // needs a bootstrap that has not finished
}
// #endregion

export type BoundId =
  | 'vc'
  | 'vc-bootstrap'
  | 'bootstrap'
  | 'hoeffding'
  | 'bernstein'
  | 'dkw'
  | 'wilcoxon'
  | 'cantelli'
  | 'bayes';

export type BoundInputKey = 'n' | 'nPos' | 'auc' | 'aucStd' | 'd' | 'bootstrap';

export interface BoundDef {
  id: BoundId;
  name: string;
  short: string;
  credit: string;
  year: string;
  latex: string;
  uses: BoundInputKey[];
  summary: string;
  compute: (x: BoundInput) => BoundResult;
}

const nNeg = (x: BoundInput) => Math.max(0, x.n - x.nPos);

/** Hanley & McNeil (1982) standard error of an AUC. */
export function hanleyMcNeilSE(auc: number, nPos: number, nNegatives: number): number {
  if (nPos < 1 || nNegatives < 1) return Infinity;
  const a = clamp(auc, 1e-6, 1 - 1e-6);
  const q1 = a / (2 - a);
  const q2 = (2 * a * a) / (1 + a);
  const v = (a * (1 - a) + (nPos - 1) * (q1 - a * a) + (nNegatives - 1) * (q2 - a * a)) / (nPos * nNegatives);
  return Math.sqrt(Math.max(v, 1e-12));
}

// #region stage:bounds
export function vcEpsilon(n: number, d: number, delta: number): number {
  if (n <= d || n <= 0) return 1;
  const v = (d * (Math.log((2 * n) / d) + 1) + Math.log(4 / delta)) / n;
  return v > 0 ? Math.sqrt(v) : 0;
}

export function hoeffdingEpsilon(nPos: number, nNegatives: number, delta: number): number {
  const m = Math.min(nPos, nNegatives);
  if (m < 1) return 1;
  return Math.sqrt(Math.log(1 / delta) / (2 * m));
}

export function bernsteinEpsilon(auc: number, nPos: number, nNegatives: number, delta: number): number {
  const m = Math.min(nPos, nNegatives);
  if (m < 1) return 1;
  const variance = clamp(auc, 0, 1) * (1 - clamp(auc, 0, 1));
  const L = Math.log(1 / delta);
  return Math.sqrt((2 * variance * L) / m) + (2 * L) / (3 * m);
}

export function dkwEpsilon(nPos: number, nNegatives: number, delta: number): number {
  if (nPos < 1 || nNegatives < 1) return 1;
  const L = Math.log(4 / delta);
  return Math.sqrt(L / (2 * nPos)) + Math.sqrt(L / (2 * nNegatives));
}
// #endregion

export const BOUNDS: BoundDef[] = [
  {
    id: 'vc',
    name: 'Vapnik–Chervonenkis capacity bound',
    short: 'VC bound',
    credit: 'Vladimir Vapnik & Alexey Chervonenkis',
    year: '1971',
    latex: String.raw`\varepsilon=\sqrt{\dfrac{d\left(\ln\frac{2n}{d}+1\right)+\ln\frac{4}{\delta}}{n}}`,
    uses: ['n', 'd', 'auc'],
    summary:
      'Uniform convergence for a model class of capacity d. Distribution-free and very conservative: it punishes model size, not just sample size.',
    compute: (x) => {
      const e = vcEpsilon(x.n, x.d, x.delta);
      return { epsilon: e, floor: x.auc - e };
    },
  },
  {
    id: 'vc-bootstrap',
    name: 'min(VC floor, bootstrap floor)',
    short: 'VC ∧ bootstrap',
    credit: 'Vapnik–Chervonenkis + Bradley Efron',
    year: '1971 / 1979',
    latex: String.raw`\text{floor}=\min\!\big(\text{AUC}-\varepsilon_{VC},\;Q_{2.5\%}(\text{AUC}^{*}_{b})\big)`,
    uses: ['n', 'd', 'auc', 'bootstrap'],
    summary:
      'The stricter of two floors: the VC capacity penalty and the 2.5th percentile of bootstrap-resampled AUCs.',
    compute: (x) => {
      const vcFloor = x.auc - vcEpsilon(x.n, x.d, x.delta);
      if (x.bootLower == null) return { epsilon: x.auc - vcFloor, floor: vcFloor, pending: true };
      const floor = Math.min(vcFloor, x.bootLower);
      return { epsilon: x.auc - floor, floor };
    },
  },
  {
    id: 'bootstrap',
    name: 'Percentile bootstrap',
    short: 'Bootstrap',
    credit: 'Bradley Efron',
    year: '1979',
    latex: String.raw`\text{floor}=Q_{\delta/2}\big(\text{AUC}^{*}_{1},\dots,\text{AUC}^{*}_{B}\big)`,
    uses: ['n', 'nPos', 'auc', 'bootstrap'],
    summary:
      'Resample the tokens with replacement hundreds of times, re-measure AUC each time, and take a low percentile. Empirical, no capacity term.',
    compute: (x) => {
      if (x.bootLower == null) return { epsilon: 1, floor: x.auc - 1, pending: true };
      return { epsilon: x.auc - x.bootLower, floor: x.bootLower };
    },
  },
  {
    id: 'hoeffding',
    name: 'Hoeffding bound for U-statistics',
    short: 'Hoeffding',
    credit: 'Wassily Hoeffding',
    year: '1963',
    latex: String.raw`\varepsilon=\sqrt{\dfrac{\ln\frac{1}{\delta}}{2\,\min(n_{+},\,n_{-})}}`,
    uses: ['nPos', 'auc'],
    summary:
      'AUC is a two-sample U-statistic, so Hoeffding’s inequality applies with the smaller class as the effective sample size.',
    compute: (x) => {
      const e = hoeffdingEpsilon(x.nPos, nNeg(x), x.delta);
      return { epsilon: e, floor: x.auc - e };
    },
  },
  {
    id: 'bernstein',
    name: 'Bernstein inequality',
    short: 'Bernstein',
    credit: 'Sergei Bernstein',
    year: '1924',
    latex: String.raw`\varepsilon=\sqrt{\dfrac{2\sigma^{2}\ln\frac{1}{\delta}}{m}}+\dfrac{2\ln\frac{1}{\delta}}{3m},\quad \sigma^{2}=\text{AUC}(1-\text{AUC})`,
    uses: ['nPos', 'auc'],
    summary:
      'Like Hoeffding but variance-aware: as AUC moves toward 0 or 1 the kernel variance shrinks and so does the penalty.',
    compute: (x) => {
      const e = bernsteinEpsilon(x.auc, x.nPos, nNeg(x), x.delta);
      return { epsilon: e, floor: x.auc - e };
    },
  },
  {
    id: 'dkw',
    name: 'Kolmogorov–Smirnov / DKW band',
    short: 'Kolmogorov (DKW)',
    credit: 'Andrey Kolmogorov; Dvoretzky–Kiefer–Wolfowitz; Massart',
    year: '1933 / 1956 / 1990',
    latex: String.raw`\varepsilon=\sqrt{\dfrac{\ln\frac{4}{\delta}}{2n_{+}}}+\sqrt{\dfrac{\ln\frac{4}{\delta}}{2n_{-}}}`,
    uses: ['nPos', 'auc'],
    summary:
      'Bound each class’s empirical CDF uniformly; AUC = ∫F₋ dF₊ can move by at most the sum of the two sup-norm errors.',
    compute: (x) => {
      const e = dkwEpsilon(x.nPos, nNeg(x), x.delta);
      return { epsilon: e, floor: x.auc - e };
    },
  },
  {
    id: 'wilcoxon',
    name: 'Wilcoxon–Mann–Whitney normal interval',
    short: 'Wilcoxon',
    credit: 'Frank Wilcoxon; Mann & Whitney; Hanley & McNeil',
    year: '1945 / 1947 / 1982',
    latex: String.raw`\varepsilon=z_{1-\delta}\sqrt{\dfrac{A(1-A)+(n_{+}-1)(Q_1-A^2)+(n_{-}-1)(Q_2-A^2)}{n_{+}n_{-}}}`,
    uses: ['nPos', 'auc'],
    summary:
      'AUC is the rank-sum statistic rescaled. Use its large-sample standard error and a one-sided normal quantile. Tight, but assumes normality.',
    compute: (x) => {
      const e = normalInv(1 - x.delta) * hanleyMcNeilSE(x.auc, x.nPos, nNeg(x));
      return { epsilon: Math.min(1, e), floor: x.auc - e };
    },
  },
  {
    id: 'cantelli',
    name: 'Chebyshev–Cantelli inequality',
    short: 'Chebyshev',
    credit: 'Pafnuty Chebyshev; Francesco Cantelli',
    year: '1867 / 1928',
    latex: String.raw`\varepsilon=\mathrm{SE}_{\text{AUC}}\sqrt{\dfrac{1-\delta}{\delta}}`,
    uses: ['nPos', 'auc'],
    summary:
      'Only assumes a finite variance. The one-sided Chebyshev inequality converts the standard error into a floor that holds for any distribution.',
    compute: (x) => {
      const e = hanleyMcNeilSE(x.auc, x.nPos, nNeg(x)) * Math.sqrt((1 - x.delta) / x.delta);
      return { epsilon: Math.min(1, e), floor: x.auc - e };
    },
  },
  {
    id: 'bayes',
    name: 'Bayes–Laplace posterior credible floor',
    short: 'Bayes',
    credit: 'Thomas Bayes; Pierre-Simon Laplace',
    year: '1763 / 1774',
    latex: String.raw`\text{floor}=F^{-1}_{\mathrm{Beta}(kA+1,\;k(1-A)+1)}(\delta),\quad k=\dfrac{A(1-A)}{\mathrm{SE}^2}-1`,
    uses: ['nPos', 'auc'],
    summary:
      'Treat AUC as an unknown probability with a uniform prior (Laplace’s rule of succession) and k effective comparisons; report the δ-quantile of the posterior.',
    compute: (x) => {
      const a = clamp(x.auc, 1e-6, 1 - 1e-6);
      const se = hanleyMcNeilSE(a, x.nPos, nNeg(x));
      if (!Number.isFinite(se)) return { epsilon: 1, floor: x.auc - 1 };
      const k = Math.max(0, (a * (1 - a)) / (se * se) - 1);
      const floor = betaInv(x.delta, k * a + 1, k * (1 - a) + 1);
      return { epsilon: x.auc - floor, floor };
    },
  },
];

export const BOUND_BY_ID = Object.fromEntries(BOUNDS.map((b) => [b.id, b])) as Record<BoundId, BoundDef>;

export const isBoundId = (v: unknown): v is BoundId => typeof v === 'string' && v in BOUND_BY_ID;

export const needsBootstrap = (id: BoundId) => BOUND_BY_ID[id].uses.includes('bootstrap');

/** Map a floor onto the jar: 0% at the coin-flip floor, 100% at the target. */
export function jarFraction(floor: number, aucFloor: number, aucTarget: number): number {
  return clamp((floor - aucFloor) / (aucTarget - aucFloor), 0, 1);
}

export type ConfidenceLabel = 'none' | 'weak' | 'provisional' | 'qualified';

export function confidenceLabel(provenFloor: number): ConfidenceLabel {
  if (provenFloor < 0) return 'none';
  if (provenFloor < 0.55) return 'weak';
  if (provenFloor < 0.65) return 'provisional';
  return 'qualified';
}
