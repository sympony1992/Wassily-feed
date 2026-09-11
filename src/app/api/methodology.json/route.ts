import { methodology } from '@/lib/download';
import { json } from '@/server/http';
import { getRuntime } from '@/server/runtime';

export const dynamic = 'force-dynamic';

export function GET() {
  const { agent, config } = getRuntime();
  return json({
    ...methodology(agent.personaDef, agent.bound),
    data_source:
      config.source === 'dexscreener'
        ? `DexScreener token profiles + boosts on chain "${config.chain}", peak market cap tracked from first sighting`
        : 'simulated market (not real tokens)',
    admission: config.source === 'dexscreener' ? `only tokens first seen within ${config.maxDiscoveryAgeHours}h of launch` : 'all simulated launches',
    holders_source: config.holdersApiUrl ? 'explorer API (configured)' : 'none — imputed with the median of known counts',
  });
}
