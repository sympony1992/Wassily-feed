import { TOPICS, WETH } from './abi';
import { NoPriceError, type QuotePrices } from './prices';
import type { RpcClient } from './rpc';
import type { TokenInfoCache } from './tokens';

export interface PonsCurve {
  token: string;
  curve: string;
  quote: string;
  firstBlock: number;
}

export interface CurvePeak {
  trades: number;
  peakPrice: number; // USD per whole token
  unpriced?: boolean; // some trade had no USD price for its quote asset, so the peak is unknown
}

const BATCH = 250; // curves per log query; 250 curves over 48h came back in about 4 s (4,217 trades)

/** Price of one whole token in quote units, from one curve trade's data (quoteAmount, tokenAmount, ...). */
export function tradePrice(data: string, quoteDecimals: number, tokenDecimals: number): number | null {
  if (data.length < 130) return null;
  const tokenAmount = BigInt(`0x${data.slice(66, 130)}`);
  if (tokenAmount === 0n) return null;
  const quoteAmount = BigInt(data.slice(0, 66));
  return Number(quoteAmount) / 10 ** quoteDecimals / (Number(tokenAmount) / 10 ** tokenDecimals);
}

/**
 * Peak USD price of each Pons token over its first `windowBlocks`, read from
 * the curve's own trade events and priced in USD at each trade's hour.
 * Checked against GeckoTerminal's candles for the same curves to within half a percent.
 */
export async function ponsPeaks(
  rpc: Pick<RpcClient, 'getLogs'>,
  prices: Pick<QuotePrices, 'usdAt'>,
  tokens: Pick<TokenInfoCache, 'get'>,
  curves: PonsCurve[],
  o: { windowBlocks: number; head: number; secondsAt: (block: number) => number },
): Promise<Map<string, CurvePeak>> {
  const out = new Map<string, CurvePeak>();
  for (let i = 0; i < curves.length; i += BATCH) {
    const batch = curves.slice(i, i + BATCH);
    const byCurve = new Map(batch.map((c) => [c.curve, c]));
    batch.forEach((c) => out.set(c.token, { trades: 0, peakPrice: 0 }));
    const from = Math.min(...batch.map((c) => c.firstBlock));
    const to = Math.min(o.head, Math.max(...batch.map((c) => c.firstBlock + o.windowBlocks)));
    if (to < from) continue;

    const logs = await rpc.getLogs({ fromBlock: from, toBlock: to, address: batch.map((c) => c.curve), topics: [TOPICS.ponsTrade] });

    // Read every traded token's decimals up front, in parallel: one call per trade in sequence took minutes per batch.
    const traded = new Set<string>();
    for (const log of logs) {
      const c = byCurve.get(log.address.toLowerCase());
      if (!c) continue;
      traded.add(c.token);
      if (c.quote !== WETH) traded.add(c.quote);
    }
    const infos = new Map(await Promise.all([...traded].map(async (token) => [token, await tokens.get(token)] as const)));

    for (const log of logs) {
      const c = byCurve.get(log.address.toLowerCase());
      const block = Number(log.blockNumber);
      if (!c || block < c.firstBlock || block > c.firstBlock + o.windowBlocks) continue;
      const quoteDecimals = c.quote === WETH ? 18 : (infos.get(c.quote)?.decimals ?? 18);
      const price = tradePrice(log.data, quoteDecimals, infos.get(c.token)?.decimals ?? 18);
      if (price == null) continue;
      const peak = out.get(c.token)!;
      peak.trades++;
      try {
        peak.peakPrice = Math.max(peak.peakPrice, price * (await prices.usdAt(c.quote, o.secondsAt(block))));
      } catch (err) {
        if (!(err instanceof NoPriceError)) throw err; // a failed call: the whole step is retried later
        peak.unpriced = true; // no market data for that quote and hour: this token cannot be priced honestly
      }
    }
  }
  return out;
}
