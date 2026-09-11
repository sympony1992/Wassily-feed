export type TokenStatus = 'passed' | 'stalled' | 'pending';

export interface Token {
  mint: string;
  name: string;
  symbol: string;
  lore: string; // sanitized, safe to display
  loreRaw?: string; // what the trainer sees; never rendered
  loreWithheld: boolean;
  holders: number;
  peakMc: number;
  status: TokenStatus;
  hour: number; // UTC launch hour
  dow: number; // 0 = Monday
  launchedAt: string; // ISO
  deployer: string;
  hue: number;
  logo?: string;
  holdersMissing?: boolean; // no explorer configured: imputed with the median at training time
}

/** What the trainer needs from a token — nothing derived from price. */
export interface TrainingRow {
  name: string;
  lore: string;
  loreMissing: boolean;
  holders: number;
  hour: number;
  dow: number;
  launchedAt: number; // epoch ms, only used to order the time split
  passed: 0 | 1;
}

export interface ScoringModel {
  weights: number[];
  bias: number;
  mu: number[];
  sigma: number[];
}

export interface ModelRun {
  runId: number;
  ranAt: string;
  n: number;
  nPositive: number;
  d: number;
  auc: number;
  aucStd: number;
  foldAucs: number[];
  timeSplitGap: number;
  bootLower: number;
  featureImportance: Record<string, number>;
  hourRates: number[]; // survival rate by launch hour
  hourCounts: number[];
  medianHolders: number;
  model: ScoringModel;
  source: 'simulated' | 'api';
  gatesOverride?: Record<string, boolean>; // a backend may report gates it computed itself
}

export interface Candidate {
  rank: number;
  name: string;
  lore: string;
  hour: number;
  score: number;
  commitment: string;
  committedAt: string;
}

export interface IdeaCycle {
  cycleId: number;
  runId: number;
  startedAt: string;
  seed: string;
  medianHolders: number;
  dow: number;
  nGenerated: number;
  nRejected: number;
  nExcluded: number;
  ruleHits: Record<string, number>;
  model: { auc: number; floor: number };
  candidates: Candidate[];
}

export interface EliminatedItem {
  name: string;
  lore: string;
  ledCycle: number;
  peakScore: number;
  currentScore: number;
  currentRank: number | null;
  demotedCycle: number;
}

export interface ExclusionItem {
  name: string;
  firstCycle: number;
  firstSeenAt: string;
  deployedMint: string;
  deployer: string;
  deployedAt: string;
  blockNumber: number;
  timeGapSeconds: number;
}

export interface LiftWord {
  word: string;
  lift: number;
  n: number;
}
