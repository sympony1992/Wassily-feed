import { USDG, WETH } from './abi';
import type { GeckoClient } from './gecko';

const HOUR_S = 3600;
const NEAR_S = 6 * HOUR_S; // thin quote markets skip hours; a candle this close is used as is
const FAR_S = 48 * HOUR_S; // beyond this there is no honest price for that hour
// The deepest USDG/WETH pool on the chain prices WETH.
const REFERENCE_POOLS: Record<string, string> = { [WETH]: '0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca' };
const STABLES = new Set([USDG]);

/** Hourly USD prices of the quote assets tokens launch against: WETH, USDG and tokenized stocks. */
export class QuotePrices {
  private readonly closes = new Map<string, Map<number, number>>();
  private readonly covered = new Map<string, [number, number][]>();
  private readonly pools = new Map<string, Promise<string | null>>();

  constructor(
    private readonly gecko: Pick<GeckoClient, 'hourlyCloses' | 'topPool'>,
    private readonly nowSeconds: () => number,
  ) {}

  async usdAt(quote: string, seconds: number): Promise<number> {
    const q = quote.toLowerCase();
    if (STABLES.has(q)) return 1;
    const hour = Math.floor(seconds / HOUR_S) * HOUR_S;
    const series = this.closes.get(q) ?? new Map<number, number>();
    this.closes.set(q, series);

    let price = nearest(series, hour, NEAR_S);
    const covered = this.covered.get(q) ?? [];
    if (price == null && !covered.some(([from, to]) => hour >= from && hour <= to)) {
      const pool = await this.poolFor(q);
      if (!pool) throw new Error(`no USD market for quote ${q}`);
      const until = Math.min(this.nowSeconds(), hour + 500 * HOUR_S);
      for (const [t, close] of await this.gecko.hourlyCloses(pool, q, until, 1000)) if (close > 0) series.set(t, close);
      covered.push([until - 999 * HOUR_S, until - HOUR_S]); // the newest hour is still open and fetched again later
      this.covered.set(q, covered);
      price = nearest(series, hour, NEAR_S);
    }
    price ??= nearest(series, hour, FAR_S);
    if (price == null) throw new Error(`no USD price for ${q} near ${new Date(hour * 1000).toISOString()}`);
    return price;
  }

  private poolFor(quote: string) {
    let pool = this.pools.get(quote);
    if (!pool) {
      pool = REFERENCE_POOLS[quote] ? Promise.resolve(REFERENCE_POOLS[quote]) : this.gecko.topPool(quote);
      pool.catch(() => this.pools.delete(quote));
      this.pools.set(quote, pool);
    }
    return pool;
  }
}

function nearest(series: Map<number, number>, hour: number, within: number): number | null {
  for (let d = 0; d <= within; d += HOUR_S) {
    const price = series.get(hour - d) ?? series.get(hour + d);
    if (price != null) return price;
  }
  return null;
}
