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
      ? `Robinhood Chain RPC (${config.rpcUrl}): every pool launch (Uniswap v2/v3/v4 and the Pons launchpad); GeckoTerminal hourly OHLCV for each token's peak market cap in its first 48 hours`
      : 'simulated market (not real tokens)',
    admission: live ? `tokens launched in the last ${config.backfillDays} days plus every new launch; a token enters the study once its 48h peak market cap is known` : 'all simulated launches',
    peak_market_cap: live ? 'highest hourly USD price in the first 48h × total supply (fully diluted)' : 'simulated',
    holders_source: live ? 'replayed from ERC-20 Transfer events up to 48h after launch' : 'simulated',
    lore_source: live ? 'not observable for historical launches, so lore columns are zero for every token' : 'simulated',
  });
}
