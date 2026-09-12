import { SITE } from './site';

/**
 * Draft rules for the trade bot. Coming soon: only the /bot preview reads these,
 * and no code path places an order or touches a wallet.
 */
export const BOT_DRAFT = {
  entryMc: SITE.entryMc,
  takeProfitMc: SITE.targetMc,
  stopLossPct: 0.4, // from the entry cap
  maxHoldHours: SITE.holderSampleHours,
  minScore: 0.6,
  minStakeUsd: 10,
  maxStakeUsd: 50,
  maxOpenPositions: 5,
  dailyLossCapUsd: 150,
} as const;
