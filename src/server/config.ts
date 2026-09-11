import { isPersonaId, type PersonaId } from '@/config/personas';
import { SITE } from '@/config/site';
import { isBoundId, type BoundId } from '@/math/bounds';

export interface ServerConfig {
  source: 'simulated' | 'dexscreener';
  chain: string;
  persona: PersonaId; // the default persona for idea endpoints without ?persona=
  bound: BoundId | null;
  cycleSeconds: number;
  pollSeconds: number;
  maxDiscoveryAgeHours: number;
  holdersApiUrl: string; // "{address}" is replaced; blank = holders imputed with the median
  dexscreenerApi: string;
  dataDir: string;
  persist: boolean;
  seedTokens: number;
  arrivalMs: [number, number];
  priorCycles: number;
}

type Env = Record<string, string | undefined>;

export function loadConfig(env: Env = process.env): ServerConfig {
  const live = env.DATA_SOURCE === 'dexscreener';
  const arrival = (env.ARRIVAL_MS ?? '').split(',').map(Number);

  return {
    source: live ? 'dexscreener' : 'simulated',
    chain: env.CHAIN ?? 'robinhood',
    persona: isPersonaId(env.PERSONA) ? env.PERSONA : 'hoeffding',
    bound: isBoundId(env.BOUND) ? env.BOUND : null,
    cycleSeconds: Number(env.CYCLE_SECONDS ?? (live ? 3600 : SITE.cycleSeconds)),
    pollSeconds: Number(env.POLL_SECONDS ?? 60),
    maxDiscoveryAgeHours: Number(env.MAX_DISCOVERY_AGE_HOURS ?? 6),
    // The public Blockscout explorer is behind a Cloudflare bot check, so there is no keyless default.
    holdersApiUrl: env.HOLDERS_API_URL ?? '',
    dexscreenerApi: env.DEXSCREENER_API ?? 'https://api.dexscreener.com',
    dataDir: env.DATA_DIR ?? 'data',
    persist: (env.PERSIST ?? String(live)) === 'true',
    seedTokens: Number(env.SEED_TOKENS ?? SITE.seedTokens),
    arrivalMs: arrival.length === 2 && arrival.every(Number.isFinite) ? [arrival[0], arrival[1]] : SITE.arrivalMs,
    priorCycles: SITE.priorCycles,
  };
}
