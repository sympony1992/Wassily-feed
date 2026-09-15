/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * KyberSwap's aggregator on Robinhood Chain. It routes through Pons curves and Uniswap pools and builds unsigned
 * swaps for the user's own wallet to sign. Nothing here holds a key or sends a transaction.
 */
export const NATIVE_ETH = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
// MetaAggregationRouterV2: KyberSwap uses this address on every chain it serves. No other target is ever returned.
export const KYBER_ROUTER = '0x6131b5fae19ea4f9d964eac0408e4408b66337b5';

const NO_ROUTE_CODES = new Set([4008, 4011]); // route not found, token not found

export interface RouteStep {
  pool: string;
  exchange: string;
  tokenIn: string;
  tokenOut: string;
}

/** Passed back to build unchanged: KyberSwap checks it with its own checksum. */
export interface RouteSummary {
  tokenIn: string;
  amountIn: string;
  amountInUsd: string;
  tokenOut: string;
  amountOut: string;
  amountOutUsd: string;
  gas: string;
  gasUsd: string;
  route: RouteStep[][];
  [key: string]: unknown;
}

export interface Quote {
  summary: RouteSummary;
  exchanges: string[];
}

export interface UnsignedSwap {
  to: string;
  data: string;
  value: string; // wei, decimal string
  amountOut: string;
}

export interface KyberOptions {
  api: string;
  chain: string;
  clientId: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
}

export class KyberError extends Error {
  readonly name = 'KyberError'; // recognised by name: callers may hold another bundle's copy of this class
}

export class KyberClient {
  constructor(private readonly o: KyberOptions) {}

  /** The best route, or null when KyberSwap knows no market for the token. A failed call throws: "no route" is never inferred from an outage. */
  async quote(tokenIn: string, tokenOut: string, amountIn: bigint): Promise<Quote | null> {
    if (amountIn <= 0n) return null;
    const q = new URLSearchParams({ tokenIn, tokenOut, amountIn: amountIn.toString() });
    const body = await this.call(`/api/v1/routes?${q}`);
    if (body?.code !== 0) {
      if (NO_ROUTE_CODES.has(body?.code)) return null;
      throw new KyberError(`kyberswap routes: ${body?.code} ${body?.message ?? ''}`.trim());
    }
    const summary = body.data?.routeSummary as RouteSummary | undefined;
    if (!summary?.amountOut || !Array.isArray(summary.route)) throw new KyberError('kyberswap routes: malformed response');
    if (String(body.data.routerAddress).toLowerCase() !== KYBER_ROUTER) throw new KyberError(`kyberswap routes: unexpected router ${body.data.routerAddress}`);
    return { summary, exchanges: [...new Set(summary.route.flat().map((s) => s.exchange))] };
  }

  /** Calldata for `sender` to sign and send from their own wallet, with tokens delivered back to the same address. */
  async build(summary: RouteSummary, sender: string, slippageBps: number): Promise<UnsignedSwap> {
    const now = Math.floor((this.o.now?.() ?? Date.now()) / 1000);
    const body = await this.call('/api/v1/route/build', {
      routeSummary: summary,
      sender,
      recipient: sender,
      slippageTolerance: slippageBps,
      deadline: now + 20 * 60,
      enableGasEstimation: false,
    });
    if (body?.code !== 0) throw new KyberError(`kyberswap build: ${body?.code} ${body?.message ?? ''}`.trim());
    const d = body.data ?? {};
    if (String(d.routerAddress).toLowerCase() !== KYBER_ROUTER) throw new KyberError(`kyberswap build: unexpected router ${d.routerAddress}`);
    if (!/^0x[0-9a-f]{8,}$/i.test(String(d.data))) throw new KyberError('kyberswap build: malformed calldata');
    const native = summary.tokenIn.toLowerCase() === NATIVE_ETH;
    const value = d.transactionValue != null && d.transactionValue !== '' ? String(d.transactionValue) : native ? String(summary.amountIn) : '0';
    if (!native && BigInt(value) !== 0n) throw new KyberError('kyberswap build: a token sale must not send ETH');
    if (native && BigInt(value) !== BigInt(summary.amountIn)) throw new KyberError('kyberswap build: value does not match the quote');
    return { to: KYBER_ROUTER, data: String(d.data), value, amountOut: String(d.amountOut ?? summary.amountOut) };
  }

  private async call(path: string, post?: unknown): Promise<any> {
    const url = `${this.o.api}/${this.o.chain}${path}`;
    let res: Response;
    try {
      res = await (this.o.fetchImpl ?? fetch)(url, {
        method: post ? 'POST' : 'GET',
        headers: { accept: 'application/json', 'x-client-id': this.o.clientId, ...(post ? { 'content-type': 'application/json' } : {}) },
        body: post ? JSON.stringify(post) : undefined,
        signal: AbortSignal.timeout(this.o.timeoutMs ?? 12_000),
      });
    } catch (err) {
      throw new KyberError(`kyberswap unavailable: ${(err as Error).message}`);
    }
    if (res.status === 429) throw new KyberError('kyberswap rate limited');
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new KyberError(`kyberswap HTTP ${res.status}`);
    }
  }
}
