import { BOT_DRAFT } from '@/config/bot';
import { SITE } from '@/config/site';
import { featurize } from './features';
import { predictProba } from './model';
import type { ScoringModel, Token } from './types';

export type SignalGate = 'watching' | 'age' | 'entry' | 'below_target' | 'holders' | 'score' | 'jar';

/** In this order: the first gate that fails is the reason shown. */
export const SIGNAL_GATES: SignalGate[] = ['watching', 'age', 'entry', 'below_target', 'holders', 'score', 'jar'];

/** none: the token fails its own gates · disabled: it qualifies but the jar is not full · active: quick buy allowed. */
export type SignalState = 'none' | 'disabled' | 'active';

export interface TradeSignal {
  score: number | null; // survival probability from the latest model, once the holder count is known
  gates: Record<SignalGate, boolean>;
  blockedBy: SignalGate | null;
  state: SignalState;
  ageHours: number;
}

const HOUR = 3_600_000;

/** The score the trainer's model gives this token: the same features and lore handling, with the token's own holder count. */
export function scoreToken(t: Token, model: ScoringModel | null): number | null {
  if (!model?.weights.length || t.holdersMissing) return null;
  const lore = t.loreRaw ?? t.lore;
  return predictProba(model, featurize({ name: t.name, lore, loreMissing: !lore.trim(), hour: t.hour, dow: t.dow, holders: t.holders }));
}

/**
 * Whether a token may carry a quick buy button.
 * Token gates: still watched (no label yet); old enough for its holder count and still inside the label window; a peak
 * between the entry line and the target (past the target the question the model answers is already settled); a known
 * holder count; a score of at least the minimum. System gate: the jar is full.
 */
export function tradeSignal(t: Token, model: ScoringModel | null, jarUnlocked: boolean, now = Date.now()): TradeSignal {
  const ageMs = now - Date.parse(t.launchedAt);
  const score = scoreToken(t, model);
  const gates: Record<SignalGate, boolean> = {
    watching: t.status === 'pending',
    age: ageMs >= SITE.holderSampleHours * HOUR && ageMs < SITE.labelHours * HOUR,
    entry: t.peakMc >= BOT_DRAFT.entryMc,
    below_target: t.peakMc < BOT_DRAFT.takeProfitMc,
    holders: !t.holdersMissing,
    score: score != null && score >= BOT_DRAFT.minScore,
    jar: jarUnlocked,
  };
  const blockedBy = SIGNAL_GATES.find((g) => !gates[g]) ?? null;
  const tokenQualifies = SIGNAL_GATES.every((g) => g === 'jar' || gates[g]);
  return { score, gates, blockedBy, state: !tokenQualifies ? 'none' : gates.jar ? 'active' : 'disabled', ageHours: Math.max(0, ageMs / HOUR) };
}

export const GATE_LABELS: Record<SignalGate, string> = {
  watching: 'Still watched, no label yet',
  age: `${SITE.holderSampleHours}h to ${SITE.labelHours}h after launch`,
  entry: `Peak cap at least $${SITE.entryMc.toLocaleString('en-US')}`,
  below_target: `Peak cap still under $${SITE.targetMc.toLocaleString('en-US')}`,
  holders: `Holder count ${SITE.holderSampleHours}h after launch known`,
  score: `Score at least ${BOT_DRAFT.minScore.toFixed(2)}`,
  jar: 'Jar at 100%',
};
