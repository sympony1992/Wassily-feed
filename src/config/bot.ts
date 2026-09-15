import { SITE } from './site';

/**
 * Draft rules for the trade bot. Coming soon: only the /bot preview reads these,
 * and no code path places an order or touches a wallet.
 */
export const BOT_DRAFT = {
  entryMc: SITE.entryMc,
  takeProfitMc: SITE.targetMc,
  stopLossPct: 0.4, // from the entry cap
  maxHoldHours: SITE.labelHours,
  minScore: 0.6,
  minStakeUsd: 10,
  maxStakeUsd: 50,
  maxOpenPositions: 5,
  dailyLossCapUsd: 150,
} as const;

/**
 * Manual quick buy: the user picks a token and signs every trade in their own wallet. The server only prices routes
 * and builds unsigned swaps; it holds no keys and never trades on its own.
 */
export const QUICK_BUY = {
  presetsUsd: [10, 25, 50],
  defaultUsd: 25,
  minUsd: BOT_DRAFT.minStakeUsd,
  maxUsd: BOT_DRAFT.maxStakeUsd,
  defaultSlippageBps: 500,
  minSlippageBps: 50,
  maxSlippageBps: 1500,
  maxOpenPositions: BOT_DRAFT.maxOpenPositions,
  dailyLossCapUsd: BOT_DRAFT.dailyLossCapUsd,
  // Exit alerts: shown to the user, never executed for them
  takeProfitPct: 2, // +200%
  stopLossPct: BOT_DRAFT.stopLossPct, // −40%
  timeStopHours: 48, // after the buy
  // Paper trading: every active signal is bought on paper at this stake and tracked with real quotes
  paperStakeUsd: 25,
} as const;
