/**
 * GeckoTerminal's public API (no key). The free tier allows about 30 calls a
 * minute, but a shared cloud IP often gets less, so the pace adapts: it slows
 * down on every 429 and creeps back up while calls succeed.
 */
export interface GeckoPool {
  address: string; // as GeckoTerminal lists it: pair/pool address, or the v4 pool id
  dex: string;
  createdAt: string;
  baseToken: string;
  quoteToken: string;
  name: string;
  fdvUsd: number; // current fully diluted value of the base token
}

export interface GeckoToken {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  supply: number; // normalized total supply
  imageUrl?: string;
}

export interface GeckoOptions {
  network: string;
  api?: string;
  perMinute?: number; // the ceiling; the actual pace adapts below it
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: (msg: string) => void;
}

interface Resource<A> {
  attributes: A;
  relationships?: Record<string, { data?: { id?: string } }>;
}

const BATCH = 30; // the multi endpoints accept up to 30 addresses
const MIN_PER_MINUTE = 4;
const stripNetwork = (id = '') => id.slice(id.indexOf('_') + 1).toLowerCase();

export class GeckoClient {
  readonly stats = { calls: 0, throttled: 0, failed: 0, perMinute: 0 };
  private nextAt = 0;
  private readonly ceiling: number;
  private pace: number;

  constructor(private readonly o: GeckoOptions) {
    this.ceiling = o.perMinute ?? 28;
    this.pace = this.ceiling;
    this.stats.perMinute = this.pace;
  }

  private now() {
    return this.o.now?.() ?? Date.now();
  }

  private wait(ms: number) {
    return ms > 0 ? (this.o.sleep ?? ((t) => new Promise((resolve) => setTimeout(resolve, t))))(ms) : Promise.resolve();
  }

  /** How long a call made now would wait for its turn. */
  backlogMs() {
    return Math.max(0, this.nextAt - this.now());
  }

  private async get<T>(path: string): Promise<T | null> {
    for (let attempt = 0; attempt < 6; attempt++) {
      const at = Math.max(this.now(), this.nextAt);
      this.nextAt = at + 60_000 / this.pace;
      await this.wait(at - this.now());
      this.stats.calls++;
      try {
        const res = await (this.o.fetchImpl ?? fetch)(`${this.o.api ?? 'https://api.geckoterminal.com/api/v2'}/networks/${this.o.network}${path}`, {
          headers: { accept: 'application/json' },
        });
        if (res.status === 429) {
          this.stats.throttled++;
          this.pace = Math.max(MIN_PER_MINUTE, this.pace * 0.7);
          this.nextAt = Math.max(this.nextAt, this.now() + 10_000);
          this.stats.perMinute = Math.round(this.pace * 10) / 10;
          continue;
        }
        this.pace = Math.min(this.ceiling, this.pace + 0.2);
        this.stats.perMinute = Math.round(this.pace * 10) / 10;
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as T;
      } catch (err) {
        this.stats.failed++;
        this.o.log?.(`geckoterminal ${path.slice(0, 60)}: ${(err as Error).message}`);
        this.nextAt = Math.max(this.nextAt, this.now() + 5_000 * (attempt + 1));
      }
    }
    // Unanswered is not the same as "no data": callers must retry later instead of drawing conclusions.
    throw new Error(`geckoterminal unavailable for ${path.slice(0, 60)}`);
  }

  /** The pools GeckoTerminal indexes among `addresses`; pools it never saw are simply absent. */
  async pools(addresses: string[]): Promise<GeckoPool[]> {
    const out: GeckoPool[] = [];
    for (let i = 0; i < addresses.length; i += BATCH) {
      const body = await this.get<{ data?: Resource<{ address: string; name: string; pool_created_at: string; fdv_usd?: string | null }>[] }>(
        `/pools/multi/${addresses.slice(i, i + BATCH).join(',')}`,
      );
      for (const p of body?.data ?? []) {
        out.push({
          address: p.attributes.address.toLowerCase(),
          dex: p.relationships?.dex?.data?.id ?? '',
          createdAt: p.attributes.pool_created_at,
          baseToken: stripNetwork(p.relationships?.base_token?.data?.id),
          quoteToken: stripNetwork(p.relationships?.quote_token?.data?.id),
          name: p.attributes.name,
          fdvUsd: Number(p.attributes.fdv_usd) || 0,
        });
      }
    }
    return out;
  }

  async tokens(addresses: string[]): Promise<GeckoToken[]> {
    const out: GeckoToken[] = [];
    for (let i = 0; i < addresses.length; i += BATCH) {
      const body = await this.get<{
        data?: Resource<{ address: string; name: string; symbol: string; decimals: number; normalized_total_supply: string | number; image_url?: string | null }>[];
      }>(`/tokens/multi/${addresses.slice(i, i + BATCH).join(',')}`);
      for (const t of body?.data ?? []) {
        const a = t.attributes;
        const image = a.image_url && /^https:\/\//.test(a.image_url) && !a.image_url.includes('missing') ? a.image_url : undefined;
        out.push({ address: a.address.toLowerCase(), name: a.name, symbol: a.symbol, decimals: Number(a.decimals), supply: Number(a.normalized_total_supply), imageUrl: image });
      }
    }
    return out;
  }

  /** Hourly USD closes of `token` in `pool` before `beforeSec`, as [unix seconds, close], newest first. */
  async hourlyCloses(pool: string, token: string, beforeSec: number, limit = 1000): Promise<[number, number][]> {
    const body = await this.get<{ data?: { attributes?: { ohlcv_list?: [number, number, number, number, number, number][] } } }>(
      `/pools/${pool}/ohlcv/hour?before_timestamp=${beforeSec}&limit=${limit}&currency=usd&token=${token}`,
    );
    return (body?.data?.attributes?.ohlcv_list ?? []).map(([t, , , , close]) => [t, close]);
  }

  /** The pool GeckoTerminal lists first for a token (its deepest market), or null. */
  async topPool(token: string): Promise<string | null> {
    const body = await this.get<{ data?: Resource<{ address: string }>[] }>(`/tokens/${token}/pools?page=1`);
    return body?.data?.[0]?.attributes.address.toLowerCase() ?? null;
  }

  /** Highest hourly USD price of `token` in `pool` between two unix times (seconds), or null without trades. */
  async peakPrice(pool: string, token: string, fromSec: number, toSec: number): Promise<number | null> {
    const hours = Math.min(1000, Math.ceil((toSec - fromSec) / 3600) + 2);
    const body = await this.get<{ data?: { attributes?: { ohlcv_list?: [number, number, number, number, number, number][] } } }>(
      `/pools/${pool}/ohlcv/hour?before_timestamp=${toSec}&limit=${hours}&currency=usd&token=${token}`,
    );
    const candles = (body?.data?.attributes?.ohlcv_list ?? []).filter(([t]) => t >= fromSec - 3600 && t <= toSec);
    if (!candles.length) return null;
    return candles.reduce((max, [, , high]) => Math.max(max, high), 0);
  }
}
