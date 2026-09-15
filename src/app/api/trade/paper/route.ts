import { json } from '@/server/http';
import { getRuntime } from '@/server/runtime';
import { dexImageUrl } from '@/server/sources/dexImage';

export const dynamic = 'force-dynamic';

/** The paper trading record: every active signal bought on paper at a real quote and valued with real sell quotes. */
export function GET() {
  const { paper } = getRuntime();
  if (!paper) return json({ enabled: false, summary: null, positions: [] });
  return json({
    enabled: true,
    summary: paper.summary(),
    positions: paper.list(100).map((p) => ({
      mint: p.mint,
      name: p.name,
      symbol: p.symbol,
      logo: dexImageUrl(p.logo) ?? null,
      score: Math.round(p.score * 1e4) / 1e4,
      opened_at: p.openedAt,
      stake_usd: p.stakeUsd,
      value_usd: Math.round(p.valueUsd * 100) / 100,
      pnl_pct: Math.round((p.valueUsd / p.stakeUsd - 1) * 1e4) / 1e4,
      exchanges: p.exchanges,
      checked_at: p.checkedAt,
      closed_at: p.closedAt ?? null,
      exit: p.exit ?? null,
    })),
  });
}
