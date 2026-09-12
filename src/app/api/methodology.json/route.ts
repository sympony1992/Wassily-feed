import { methodology } from '@/lib/download';
import { json } from '@/server/http';
import { getRuntime } from '@/server/runtime';

export const dynamic = 'force-dynamic';

export function GET() {
  const { agent, config } = getRuntime();
  const live = config.source === 'chain';
  return json({
    ...methodology(agent.personaDef, agent.bound),
    data_source: live
      ? `Robinhood Chain RPC (${config.rpcUrl}): every pool launch (Uniswap v2/v3/v4 and the Pons launchpad), Pons curve trades and ERC-20 transfers; GeckoTerminal hourly OHLCV for other venues and for quote-asset USD prices`
      : 'simulated market (not real tokens)',
    admission: live ? `tokens launched in the last ${config.backfillDays} days plus every new launch; a token enters the study once its 48h peak market cap is known` : 'all simulated launches',
    peak_market_cap: live
      ? 'highest USD price in the first 48h × total supply (fully diluted): Pons tokens from every curve trade (quote paid ÷ tokens, in USD at the trade hour); other venues from hourly candle highs'
      : 'simulated',
    backfill: live ? `last ${config.backfillDays} days, uniform ${Math.round(config.backfillSample * 100)}% sample of launches by address hash` : 'none',
    holders_source: live ? 'replayed from ERC-20 Transfer events up to 48h after launch' : 'simulated',
    lore_source: live ? 'not observable for historical launches, so lore columns are zero for every token' : 'simulated',
  });
}
