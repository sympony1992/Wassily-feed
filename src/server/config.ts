import { isPersonaId, type PersonaId } from '@/config/personas';
import { SITE } from '@/config/site';
import { isBoundId, type BoundId } from '@/math/bounds';

export interface ServerConfig {
  source: 'simulated' | 'chain';
  chain: string;
  persona: PersonaId; // the default persona for idea endpoints without ?persona=
  bound: BoundId | null;
  cycleSeconds: number;
  pollSeconds: number;
  maxDiscoveryAgeHours: number; // DexScreener source only
  holdersApiUrl: string; // DexScreener source only: "{address}" is replaced
  dexscreenerApi: string;
  rpcUrl: string;
  geckoApi: string;
  geckoPerMinute: number;
  backfillDays: number; // history the chain source labels on first start
  backfillSample: number; // share of past launches the backfill looks up, chosen uniformly at random
  dataDir: string;
  persist: boolean;
  seedTokens: number;
  arrivalMs: [number, number];
  priorCycles: number;
}

type Env = Record<string, string | undefined>;

export function loadConfig(env: Env = process.env): ServerConfig {
  // "dexscreener" named the live source before discovery moved on-chain; it still selects live data.
  const live = env.DATA_SOURCE === 'chain' || env.DATA_SOURCE === 'dexscreener';
  const arrival = (env.ARRIVAL_MS ?? '').split(',').map(Number);
  // Each past launch costs one GeckoTerminal call; 10% of 14 days fits the free tier in about a day and a half.
  const sample = Number(env.BACKFILL_SAMPLE ?? 0.1);

  return {
    source: live ? 'chain' : 'simulated',
    chain: env.CHAIN ?? 'robinhood',
    persona: isPersonaId(env.PERSONA) ? env.PERSONA : 'hoeffding',
    bound: isBoundId(env.BOUND) ? env.BOUND : null,
    cycleSeconds: Number(env.CYCLE_SECONDS ?? (live ? 3600 : SITE.cycleSeconds)),
    pollSeconds: Number(env.POLL_SECONDS ?? 60),
    maxDiscoveryAgeHours: Number(env.MAX_DISCOVERY_AGE_HOURS ?? 6),
    // The public Blockscout explorer is behind a Cloudflare bot check, so there is no keyless default.
    holdersApiUrl: env.HOLDERS_API_URL ?? '',
    dexscreenerApi: env.DEXSCREENER_API ?? 'https://api.dexscreener.com',
    rpcUrl: env.RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com',
    geckoApi: env.GECKO_API ?? 'https://api.geckoterminal.com/api/v2',
    geckoPerMinute: Number(env.GECKO_PER_MINUTE ?? 28),
    backfillDays: Number(env.BACKFILL_DAYS ?? 14),
    backfillSample: Number.isFinite(sample) ? Math.max(0, Math.min(1, sample)) : 1,
    dataDir: env.DATA_DIR ?? 'data',
    persist: (env.PERSIST ?? String(live)) === 'true',
    seedTokens: Number(env.SEED_TOKENS ?? SITE.seedTokens),
    arrivalMs: arrival.length === 2 && arrival.every(Number.isFinite) ? [arrival[0], arrival[1]] : SITE.arrivalMs,
    priorCycles: SITE.priorCycles,
  };
}
