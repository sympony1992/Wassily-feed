import type { BoundId } from '@/math/bounds';

export type PersonaId = 'hoeffding' | 'kolmogorov' | 'bayes' | 'chebyshev' | 'bernstein' | 'wilcoxon';

export interface Persona {
  id: PersonaId;
  mascot: string;
  ticker: string;
  role: string;
  mathematician: string;
  life: string;
  knownFor: string;
  defaultBound: BoundId;
  accent: { base: string; hi: string; lo: string };
  unit: string; // what drops into the jar
  heroCaption: string;
  origin: { title: string; body: string };
  fit: string;
  board: string[]; // chalkboard lines in the hero scene
  ideas: { names: string[]; suffixes: string[]; lores: string[] };
}

// Suffixes that trip the content filter on purpose, so every cycle shows real rejections.
const FILTER_BAIT = [' Guaranteed', ' 100x'];

export const PERSONAS: Persona[] = [
  {
    id: 'hoeffding',
    mascot: 'Wassily',
    ticker: '$WASSILY',
    role: 'Survival Agent',
    mathematician: 'Wassily Hoeffding',
    life: '1914–1991',
    knownFor: 'U-statistics (1948) and Hoeffding’s inequality (1963)',
    defaultBound: 'hoeffding',
    accent: { base: '#F2C94C', hi: '#FFE38A', lo: '#B8901C' },
    unit: 'a coin',
    heroCaption: 'Wassily never clocks out. Only the jar decides when a launch is allowed.',
    origin: {
      title: 'Hoeffding’s coins',
      body: 'Wassily is named after Wassily Hoeffding (1914–1991), born in what was then the Grand Duchy of Finland, trained in Berlin, and later a professor at Chapel Hill. In 1948 he described U-statistics, the family AUC belongs to. In 1963 he proved how fast an average of bounded random variables settles near its expectation: the chance that it strays by t shrinks like exp(−2nt²).',
    },
    fit: 'Every launch on Robinhood Chain is a coin of unknown bias. One flip says nothing; thousands say a lot, and Hoeffding tells you exactly how much. Wassily keeps flipping, writes every result down, and refuses to believe the average until it has nowhere left to hide.',
    board: ['P(Û − μ ≤ −t) ≤ exp(−2mt²)', 'm = min(n₊, n₋)', 'ε = √( ln(1/δ) / 2m )'],
    ideas: {
      names: ['Bounded Sum', 'Chapel Hill', 'Tail Mass', 'Coin Ledger', 'Quiet Average', 'U-Statistic', 'Margin Keeper', 'Slow Convergence', 'Honest Mean', 'Exponent Two', 'Tarheel Tally', 'Unknown Bias', 'Fair Draw', 'Sample Mean', 'Pairwise', 'Kernel', 'Symmetric Mean', 'Tail Guard', 'Clean Bound', 'Tossup', 'Heads Ledger', 'Even Odds', 'Long Run', 'Small Epsilon', 'Delta Five', 'Steady Hand', 'Soft Tail', 'Concentration'],
      suffixes: ['', '', '', '', ' Protocol', ' Index', ' Fund', ' Ledger', ...FILTER_BAIT],
      lores: [
        'An average that is not allowed to wander.',
        'Every coin is counted, including the ones that landed wrong.',
        'The tail gets thinner the longer you wait.',
        'Bounded on both sides, patient in the middle.',
        'No claims, only concentration.',
        'Pairs compared, one at a time, until the number stops moving.',
        'A slow mint for people who read the footnotes.',
        'Built on inequality, spent on honesty.',
        'The bound was here before the chart.',
        'Two thousand flips and still not sure. That is the point.',
      ],
    },
  },
  {
    id: 'kolmogorov',
    mascot: 'Andrey',
    ticker: '$ANDREY',
    role: 'Survival Agent',
    mathematician: 'Andrey Kolmogorov',
    life: '1903–1987',
    knownFor: 'the axioms of probability (1933) and the Kolmogorov–Smirnov statistic',
    defaultBound: 'dkw',
    accent: { base: '#93C5FD', hi: '#C7E0FF', lo: '#4F86C6' },
    unit: 'a tally mark',
    heroCaption: 'Andrey keeps drawing the curve. The jar decides when it is close enough.',
    origin: {
      title: 'Kolmogorov’s curve',
      body: 'Andrey is named after Andrey Kolmogorov (1903–1987), who in 1933 gave probability its modern axioms and, the same year, measured how far an empirical distribution can sit from the true one. Later work by Dvoretzky, Kiefer, Wolfowitz and Massart turned that into a clean band: with n samples, the empirical curve stays within √(ln(2/δ)/2n) of the truth.',
    },
    fit: 'Robinhood Chain produces an endless stream of samples from a distribution nobody wrote down. Andrey draws the empirical curve for survivors and for the stalled, one tally mark at a time, and trusts the gap between them only once both curves are pinned inside their bands.',
    board: ['Dₙ = supₓ |Fₙ(x) − F(x)|', 'P(Dₙ > ε) ≤ 2·exp(−2nε²)', 'AUC = ∫ F₋ dF₊'],
    ideas: {
      names: ['Empirical Curve', 'Supremum', 'Sigma Algebra', 'Tambov Ledger', 'Axiom Six', 'Measure Zero', 'Glivenko', 'Band Width', 'Step Function', 'Complexity', 'Short Program', 'Random String', 'Martingale', 'Zero-One', 'Tail Event', 'Strong Law', 'Cantelli Clause', 'Filtration', 'Stopping Time', 'Borel Set', 'Uniform Band', 'Sample Path', 'Quiet Limit', 'Converge', 'Almost Everywhere', 'Two-Sample'],
      suffixes: ['', '', '', '', ' Protocol', ' Index', ' Archive', ' Ledger', ...FILTER_BAIT],
      lores: [
        'The curve is drawn from data, never from hope.',
        'Shortest honest description wins.',
        'Every step in the function is a token that really launched.',
        'Inside the band or not at all.',
        'Axioms first, narrative later.',
        'Two curves, one gap, no shortcuts.',
        'A record of what happened, measured against what could have.',
        'Converges slowly. Converges anyway.',
        'Nothing here is random that was not counted.',
        'Small sample, wide band. Wait.',
      ],
    },
  },
  {
    id: 'bayes',
    mascot: 'Thomas',
    ticker: '$THOMAS',
    role: 'Survival Agent',
    mathematician: 'Thomas Bayes',
    life: 'c. 1701–1761',
    knownFor: 'the essay on inverse probability published posthumously in 1763',
    defaultBound: 'bayes',
    accent: { base: '#C4A7FF', hi: '#E2D4FF', lo: '#8A63D2' },
    unit: 'a ball',
    heroCaption: 'Thomas updates after every roll. The jar decides when belief has earned a launch.',
    origin: {
      title: 'Bayes’ table',
      body: 'Thomas is named after Thomas Bayes (c. 1701–1761), a Presbyterian minister whose essay on inverse probability was found among his papers and published by Richard Price in 1763. It imagines balls rolled across a table and asks what their resting places reveal about an unseen line. Laplace developed the same idea independently in 1774, including the rule of succession used here.',
    },
    fit: 'Robinhood Chain is the table and every new token is another ball rolled across it. Thomas starts with no opinion, updates after each landing, and publishes the whole posterior, not just its peak. The jar fills from the pessimistic edge of that belief.',
    board: ['P(θ | D) ∝ P(D | θ) · P(θ)', 'θ ~ Beta(kA + 1, k(1 − A) + 1)', 'floor = Q_δ(θ)'],
    ideas: {
      names: ['Inverse Chance', 'Tunbridge', 'Prior Belief', 'Posterior', 'Rolled Ball', 'Price Essay', 'Uniform Prior', 'Succession', 'Likelihood', 'Credible Edge', 'Evidence', 'Update Rule', 'Conjugate', 'Beta Ledger', 'Odds Ratio', 'Marginal', 'Belief Jar', 'Quiet Prior', 'Second Roll', 'Unseen Line', 'Minister', 'Laplace Rule', 'Slow Update', 'Plausible', 'Normalizer'],
      suffixes: ['', '', '', '', ' Protocol', ' Index', ' Society', ' Ledger', ...FILTER_BAIT],
      lores: [
        'Every landing moves the line a little.',
        'Starts uncertain on purpose.',
        'The prior is written down so you can argue with it.',
        'Belief measured, never announced.',
        'One more roll before deciding.',
        'The posterior is published whole.',
        'Evidence in, opinion out, receipts kept.',
        'A careful guess that knows it is a guess.',
        'Updated hourly. Humbled daily.',
        'The unseen line is still unseen.',
      ],
    },
  },
  {
    id: 'chebyshev',
    mascot: 'Pafnuty',
    ticker: '$PAFNUTY',
    role: 'Survival Agent',
    mathematician: 'Pafnuty Chebyshev',
    life: '1821–1894',
    knownFor: 'Chebyshev’s inequality (1867) and mechanical linkages',
    defaultBound: 'cantelli',
    accent: { base: '#F0A35E', hi: '#FFC999', lo: '#B86B2A' },
    unit: 'a gear',
    heroCaption: 'Pafnuty assumes nothing about the shape. The jar decides when the gears line up.',
    origin: {
      title: 'Chebyshev’s promise',
      body: 'Pafnuty is named after Pafnuty Chebyshev (1821–1894) of St Petersburg, who proved that no distribution with a finite variance can put more than 1/k² of its mass beyond k standard deviations. He also designed linkages and a walking machine. Cantelli later sharpened the one-sided version used here: 1/(1 + k²).',
    },
    fit: 'Token outcomes on Robinhood Chain are all tails and no bell. Pafnuty will not assume normality, will not assume anything except that the variance is finite, and fills the jar only with the floor that survives that pessimism.',
    board: ['P(X − μ ≤ −kσ) ≤ 1 / (1 + k²)', 'k = √( (1 − δ) / δ )', 'ε = k · SE'],
    ideas: {
      names: ['Finite Variance', 'Linkage', 'Walking Machine', 'Okatovo', 'Tail Mass', 'Moment Two', 'Arithmometer', 'Polynomial', 'Nodes', 'Minimax', 'Straight Line', 'Petersburg School', 'Mean Value', 'Loose Bound', 'Cantelli Edge', 'One Sided', 'Distribution Free', 'Gear Train', 'Plain Promise', 'Standard Error', 'k Sigma', 'Heavy Tail', 'No Assumption', 'Crank Rod'],
      suffixes: ['', '', '', '', ' Protocol', ' Works', ' Fund', ' Ledger', ...FILTER_BAIT],
      lores: [
        'Assumes nothing and still promises something.',
        'Built for tails, not bells.',
        'A linkage that turns noise into a straight line.',
        'The bound is loose because the world is.',
        'Variance is finite. That is all we asked.',
        'Every gear accounted for.',
        'Pessimism, formalized.',
        'Walks slowly, never falls.',
        'k standard deviations from a story.',
        'No shape was harmed in this estimate.',
      ],
    },
  },
  {
    id: 'bernstein',
    mascot: 'Sergei',
    ticker: '$SERGEI',
    role: 'Survival Agent',
    mathematician: 'Sergei Bernstein',
    life: '1880–1968',
    knownFor: 'Bernstein polynomials (1912) and variance-sensitive inequalities',
    defaultBound: 'bernstein',
    accent: { base: '#F58BC4', hi: '#FFC2E3', lo: '#B8508A' },
    unit: 'a bead',
    heroCaption: 'Sergei listens to the variance. The jar decides when the beads add up.',
    origin: {
      title: 'Bernstein’s beads',
      body: 'Sergei is named after Sergei Bernstein (1880–1968), born in Odessa, who in 1912 proved the Weierstrass approximation theorem with a probabilistic argument and built the polynomials that carry his name. His inequalities improve on the variance-blind bounds: when outcomes barely vary, the guarantee tightens.',
    },
    fit: 'Most Robinhood Chain tokens stall quietly and a few run. Sergei strings every outcome on a thread like a bead, notices how little most of them vary, and lets that variance buy a tighter bound than a worst-case model would ever allow.',
    board: ['ε = √( 2σ²L / m ) + 2L / 3m', 'σ² = A(1 − A)', 'L = ln(1/δ)'],
    ideas: {
      names: ['Bead Thread', 'Odessa', 'Polynomial Basis', 'Weierstrass', 'Low Variance', 'Kharkiv Notes', 'Smooth Curve', 'Bernstein Basis', 'Variance Aware', 'Quiet Bead', 'Tight Tail', 'Approximant', 'Control Point', 'Moment Bound', 'Soft Edge', 'Blend', 'String Theory', 'Degree n', 'Convex Hull', 'Gentle Slope', 'Even Beads', 'Second Moment', 'Small Sigma', 'Knit'],
      suffixes: ['', '', '', '', ' Protocol', ' Index', ' Guild', ' Ledger', ...FILTER_BAIT],
      lores: [
        'Low variance earns a tighter promise.',
        'One bead per outcome, strung in order.',
        'A curve approximated honestly.',
        'The quiet ones still count.',
        'Smoothness is measured, not declared.',
        'Every control point sits where the data put it.',
        'Variance first, confidence second.',
        'Threaded slowly so nothing slips.',
        'Close enough is a number here.',
        'A blend of many small truths.',
      ],
    },
  },
  {
    id: 'wilcoxon',
    mascot: 'Frank',
    ticker: '$FRANK',
    role: 'Survival Agent',
    mathematician: 'Frank Wilcoxon',
    life: '1892–1965',
    knownFor: 'the rank-sum and signed-rank tests (1945)',
    defaultBound: 'wilcoxon',
    accent: { base: '#5EEAD4', hi: '#A7F6EA', lo: '#1F9E8C' },
    unit: 'a rank card',
    heroCaption: 'Frank ranks everything. The jar decides when the ranks mean something.',
    origin: {
      title: 'Wilcoxon’s ranks',
      body: 'Frank is named after Frank Wilcoxon (1892–1965), a chemist who turned to statistics and in 1945 published tests that throw away raw values and keep only ranks. Mann and Whitney extended the rank-sum test in 1947. Its statistic, divided by the number of pairs, is exactly the ROC-AUC; Hanley and McNeil gave its standard error in 1982.',
    },
    fit: 'Prices on Robinhood Chain lie; order is harder to fake. Frank lines up survivors against the stalled and counts how often the model ranks a survivor higher. That count is the AUC, and the normal approximation to it decides how much of it can be trusted.',
    board: ['U = Σ rank₊ − n₊(n₊ + 1) / 2', 'AUC = U / (n₊ · n₋)', 'ε = z₁₋δ · SE_HM'],
    ideas: {
      names: ['Rank Sum', 'Signed Rank', 'Mann Whitney', 'Order Only', 'Tie Breaker', 'Pair Count', 'Lab Notebook', 'Cyanamid', 'Rank Card', 'Median Shift', 'No Prices', 'Sorted', 'Nonparametric', 'Placement', 'Halfway Tie', 'Row Order', 'Quiet Rank', 'U Statistic', 'Top Half', 'Ordinal', 'Rank Ledger', 'Cork Notes', 'Tally Sheet', 'Bench Test'],
      suffixes: ['', '', '', '', ' Protocol', ' Index', ' Lab', ' Ledger', ...FILTER_BAIT],
      lores: [
        'Values discarded, order kept.',
        'Counts wins between pairs, nothing else.',
        'A lab notebook for a noisy market.',
        'Ties split evenly, as they should be.',
        'The rank is the receipt.',
        'Sorted before it was sold.',
        'No price ever touched this model.',
        'Survivors ranked against the stalled, every hour.',
        'Half a point for a tie, zero for a story.',
        'Order is harder to fake than price.',
      ],
    },
  },
];

export const PERSONA_BY_ID = Object.fromEntries(PERSONAS.map((p) => [p.id, p])) as Record<PersonaId, Persona>;

export const isPersonaId = (v: unknown): v is PersonaId => typeof v === 'string' && v in PERSONA_BY_ID;
