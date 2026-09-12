import { BOT_DRAFT } from '@/config/bot';
import { featurize } from './features';
import { predictProba } from './model';
import type { ProofView } from './proof';
import type { ModelRun, Token } from './types';

export type BotDecision = 'enter' | 'blocked' | 'skip' | 'warming';
export type BotCheckKey = 'entry' | 'window' | 'score' | 'lock';

export interface BotPlan {
  decision: BotDecision;
  score: number | null;
  holdersUsed: number | null;
  checks: Record<BotCheckKey, boolean | null>; // null: cannot be judged yet
  stakeUsd: number | null;
  takeProfitMc: number;
  stopLossMc: number;
  timeStopAt: string | null;
}

/**
 * Dry run of the draft trade rules on one token. Coming soon: this only feeds the
 * /bot preview, and nothing here can place an order.
 */
export function planTrade(t: Token, model: Pick<ModelRun, 'n' | 'medianHolders' | 'model'> | null, proof: Pick<ProofView, 'unlocked'> | null): BotPlan {
  const scoring = model && model.n >= 20 ? model : null;
  // A bot buying at entry may not have the holder count yet, so score with the median as the Brain does.
  const score = scoring
    ? predictProba(scoring.model, featurize({ name: t.name, lore: t.lore, loreMissing: t.loreWithheld || !t.lore, hour: t.hour, dow: t.dow, holders: scoring.medianHolders }))
    : null;

  const checks: BotPlan['checks'] = {
    entry: t.peakMc >= BOT_DRAFT.entryMc,
    window: t.status === 'pending', // labelled tokens are already decided
    score: score == null ? null : score >= BOT_DRAFT.minScore,
    lock: proof ? proof.unlocked : null,
  };

  const decision = decide(checks);
  const edge = score != null && checks.score ? Math.min(1, (score - BOT_DRAFT.minScore) / (1 - BOT_DRAFT.minScore)) : null;
  const launched = Date.parse(t.launchedAt);

  return {
    decision,
    score,
    holdersUsed: scoring ? scoring.medianHolders : null,
    checks,
    stakeUsd: edge == null || decision === 'skip' ? null : Math.round(BOT_DRAFT.minStakeUsd + (BOT_DRAFT.maxStakeUsd - BOT_DRAFT.minStakeUsd) * edge),
    takeProfitMc: BOT_DRAFT.takeProfitMc,
    stopLossMc: BOT_DRAFT.entryMc * (1 - BOT_DRAFT.stopLossPct),
    timeStopAt: Number.isNaN(launched) ? null : new Date(launched + BOT_DRAFT.maxHoldHours * 3_600_000).toISOString(),
  };
}

function decide(c: BotPlan['checks']): BotDecision {
  if (!c.entry || !c.window) return 'skip';
  if (c.score === null) return 'warming';
  if (!c.score) return 'skip';
  return c.lock ? 'enter' : 'blocked';
}
