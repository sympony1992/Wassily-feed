// NEXT_PUBLIC_* values are inlined at build time, so each must be read literally.
// A blank value (an empty Docker build arg or Railway variable) falls back to the default.
const clean = (v: string | undefined, fallback = '') => v?.trim() || fallback;

/** Everything a rebrand touches lives here or in personas.ts. */
export const SITE = {
  chain: 'Robinhood Chain',
  dexscreenerChain: 'robinhood',
  contractAddress: clean(process.env.NEXT_PUBLIC_CONTRACT_ADDRESS),
  githubUrl: clean(process.env.NEXT_PUBLIC_GITHUB_URL, 'https://github.com/sympony1992/Wassily-feed'),
  xUrl: clean(process.env.NEXT_PUBLIC_X_URL, 'https://x.com/WassilyAgent'),  defaultPersona: clean(process.env.NEXT_PUBLIC_DEFAULT_PERSONA, 'hoeffding'),
  defaultBound: clean(process.env.NEXT_PUBLIC_DEFAULT_BOUND),
  // Hero media panel: your own video in public/ (falls back to the illustration if missing).
  heroVideo: clean(process.env.NEXT_PUBLIC_HERO_VIDEO, '/videos/hero.mp4'),
  heroPoster: clean(process.env.NEXT_PUBLIC_HERO_POSTER, '/videos/hero-poster.jpg'),

  // Study definition
  entryMc: 10_000,
  targetMc: 30_000,
  labelHours: 48, // the outcome: peak market cap over a token's first 48 hours
  holderSampleHours: 1, // the holder feature: counted one hour after launch, long before the outcome is known

  // Jar math
  aucFloor: 0.5,
  aucTarget: 0.6,
  delta: 0.05,
  capacityD: 28,
  cvFolds: 5,
  bootstrapResamples: 500,

  gates: {
    nSamplesMin: 2000,
    nPositiveMin: 200,
    aucStdMax: 0.05,
    timeSplitGapMax: 0.04,
    jarCapWhenBlocked: 0.95,
  },

  // Proof-panel sliders and presets
  sliders: {
    n: { min: 120, max: 24_000, step: 20 },
    auc: { min: 0.5, max: 0.85, step: 0.001 },
    d: { min: 4, max: 80, step: 1 },
    posRate: { min: 0.02, max: 0.5, step: 0.001 },
  },
  presets: {
    fillToTarget: { n: 9600, auc: 0.645, d: 41 },
    resetDay1: { n: 340, auc: 0.548, d: 28 },
  },

  // Simulated market
  seedTokens: 2346,
  cycleSeconds: 90,
  arrivalMs: [3000, 9000] as [number, number],
  priorCycles: 6,
  firstCycleId: 1412,
  firstRunId: 438,

  // UI
  feedCap: 50,
  consoleFeedCap: 60,
  candidatesPerCycle: 100,
  typing: {
    crt: { chars: 2, tickMs: 18, holdMs: 1500 },
    console: { chars: 2, tickMs: 20, holdMs: 2000 },
    source: { chars: 3, tickMs: 25 },
  },
} as const;

export const fmtUsdK = (v: number) => `$${Math.round(v / 1000)}K`;
