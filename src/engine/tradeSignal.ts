import { BOT_DRAFT } from '@/config/bot';
import { SITE } from '@/config/site';
import { featurize } from './features';
import { predictProba } from './model';
import type { ScoringModel, Token } from './types';

export type SignalGate = 'watching' | 'age' | 'entry' | 'below_target' | 'holders' | 'score' | 'name' | 'copycat' | 'market' | 'jar';

/** In this order: the first gate that fails is the reason shown. */
export const SIGNAL_GATES: SignalGate[] = ['watching', 'age', 'entry', 'below_target', 'holders', 'score', 'name', 'copycat', 'market', 'jar'];

/** none: the token fails its own gates · disabled: it qualifies but the jar is not full · active: quick buy allowed. */
export type SignalState = 'none' | 'disabled' | 'active';

/** Whether a real swap exists right now: a small buy quote, and selling those tokens straight back. */
export interface MarketCheck {
  ok: boolean;
  reason: 'no_route' | 'no_sale' | 'round_trip' | null;
  roundTrip: number | null; // −0.05: selling straight back returns 5% less than the buy cost
  checkedAt: number; // ms
}

export interface SignalContext {
  copies?: number; // other watched tokens using the same symbol
  market?: MarketCheck | null;
}

export interface TradeSignal {
  score: number | null; // survival probability from the latest model, once the holder count is known
  gates: Record<SignalGate, boolean>;
  blockedBy: SignalGate | null;
  state: SignalState;
  ageHours: number;
  market: MarketCheck | null;
}

const HOUR = 3_600_000;

/** A buy sold straight back may lose at most this much to fees and price impact; past it the pool is too thin or a trap. */
export const MAX_ROUND_TRIP_LOSS = 0.15;

// Launches borrow famous tickers so a hurried buyer takes them for the real asset.
const COPIED_TICKER = /\b(btc|bitcoin|eth|ethereum|weth|sol|solana|usdc|usdt|usdg|doge|pepe)\b/i;

export const copiesTicker = (t: Pick<Token, 'name' | 'symbol'>) => COPIED_TICKER.test(`${t.symbol} ${t.name}`);

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
 * holder count; a score of at least the minimum; not a copy of a famous ticker; no other watched token with its symbol;
 * and a market that can really be bought and sold back. System gate: the jar is full.
 */
export function tradeSignal(t: Token, model: ScoringModel | null, jarUnlocked: boolean, now = Date.now(), context: SignalContext = {}): TradeSignal {
  const ageMs = now - Date.parse(t.launchedAt);
  const score = scoreToken(t, model);
  const market = context.market ?? null;
  const gates: Record<SignalGate, boolean> = {
    watching: t.status === 'pending',
    age: ageMs >= SITE.holderSampleHours * HOUR && ageMs < SITE.labelHours * HOUR,
    entry: t.peakMc >= BOT_DRAFT.entryMc,
    below_target: t.peakMc < BOT_DRAFT.takeProfitMc,
    holders: !t.holdersMissing,
    score: score != null && score >= BOT_DRAFT.minScore,
    name: !copiesTicker(t),
    copycat: (context.copies ?? 0) === 0,
    market: !!market?.ok,
    jar: jarUnlocked,
  };
  const blockedBy = SIGNAL_GATES.find((g) => !gates[g]) ?? null;
  const tokenQualifies = SIGNAL_GATES.every((g) => g === 'jar' || gates[g]);
  return { score, gates, blockedBy, market, state: !tokenQualifies ? 'none' : gates.jar ? 'active' : 'disabled', ageHours: Math.max(0, ageMs / HOUR) };
}

/** Every gate a router answer cannot change passes, so the token is worth a market check. */
export const needsMarketCheck = (s: TradeSignal) => SIGNAL_GATES.every((g) => g === 'market' || g === 'jar' || s.gates[g]);

export const GATE_LABELS: Record<SignalGate, string> = {
  watching: 'Still watched, no label yet',
  age: `${SITE.holderSampleHours}h to ${SITE.labelHours}h after launch`,
  entry: `Peak cap at least $${SITE.entryMc.toLocaleString('en-US')}`,
  below_target: `Peak cap still under $${SITE.targetMc.toLocaleString('en-US')}`,
  holders: `Holder count ${SITE.holderSampleHours}h after launch known`,
  score: `Score at least ${BOT_DRAFT.minScore.toFixed(2)}`,
  name: 'Not a copy of a famous ticker',
  copycat: 'No other watched token uses its symbol',
  market: `Can be bought and sold back right now, losing at most ${MAX_ROUND_TRIP_LOSS * 100}%`,
  jar: 'Jar at 100%',
};
