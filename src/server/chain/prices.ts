import { USDG, WETH } from './abi';
import type { GeckoClient } from './gecko';

const HOUR_S = 3600;
const NEAR_S = 6 * HOUR_S; // thin quote markets skip hours; a candle this close is used as is
const FAR_S = 48 * HOUR_S; // beyond this there is no honest price for that hour
const REFETCH_S = 15 * 60; // at most one fresh fetch per quote in this window, however many trades ask
const POOLS_PER_QUOTE = 3; // a stock token's deepest pool may be younger than the trade; its next pools fill the gap
// The deepest USDG/WETH pool on the chain prices WETH.
const REFERENCE_POOLS: Record<string, string> = { [WETH]: '0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca' };
const STABLES = new Set([USDG]);

/** No market data exists for that asset near that hour. Unlike a failed call, retrying will not change it. */
export class NoPriceError extends Error {}

/** Hourly USD prices of the quote assets tokens launch against: WETH, USDG and tokenized stocks. */
export class QuotePrices {
  private readonly closes = new Map<string, Map<number, number>>();
  private readonly covered = new Map<string, [number, number][]>();
  private readonly fetchedAt = new Map<string, number>();
  private readonly pools = new Map<string, Promise<string[]>>();

  constructor(
    private readonly gecko: Pick<GeckoClient, 'hourlyCloses' | 'topPools'>,
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
    const fetchedRecently = (this.fetchedAt.get(q) ?? -Infinity) > this.nowSeconds() - REFETCH_S;
    if (price == null && !fetchedRecently && !covered.some(([from, to]) => hour >= from && hour <= to)) {
      const pools = await this.poolsFor(q);
      if (!pools.length) throw new NoPriceError(`no USD market for quote ${q}`);
      const until = Math.min(this.nowSeconds(), hour + 500 * HOUR_S);
      for (const pool of pools) {
        for (const [t, close] of await this.gecko.hourlyCloses(pool, q, until, 1000)) if (close > 0 && !series.has(t)) series.set(t, close);
        if (nearest(series, hour, NEAR_S) != null) break;
      }
      this.fetchedAt.set(q, this.nowSeconds());
      covered.push([until - 999 * HOUR_S, until - HOUR_S]); // the newest hour is still open and fetched again later
      this.covered.set(q, covered);
      price = nearest(series, hour, NEAR_S);
    }
    price ??= nearest(series, hour, FAR_S);
    if (price == null) throw new NoPriceError(`no USD price for ${q} near ${new Date(hour * 1000).toISOString()}`);
    return price;
  }

  private poolsFor(quote: string) {
    let pools = this.pools.get(quote);
    if (!pools) {
      pools = REFERENCE_POOLS[quote] ? Promise.resolve([REFERENCE_POOLS[quote]]) : this.gecko.topPools(quote, POOLS_PER_QUOTE);
      pools.catch(() => this.pools.delete(quote));
      this.pools.set(quote, pools);
    }
    return pools;
  }
}

function nearest(series: Map<number, number>, hour: number, within: number): number | null {
  for (let d = 0; d <= within; d += HOUR_S) {
    const price = series.get(hour - d) ?? series.get(hour + d);
    if (price != null) return price;
  }
  return null;
}
