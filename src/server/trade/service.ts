/* eslint-disable @typescript-eslint/no-explicit-any */
import { QUICK_BUY } from '@/config/bot';
import { evaluateModel } from '@/engine/proof';
import { tradeSignal, type TradeSignal } from '@/engine/tradeSignal';
import type { Token } from '@/engine/types';
import type { Agent } from '../agent';
import { WETH } from '../chain/abi';
import { NATIVE_ETH, type KyberClient, type Quote, type RouteSummary, type UnsignedSwap } from './kyber';

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const BUILDS_PER_MINUTE = 6; // per wallet: a double click or a stuck button cannot fire a burst of swaps
const ETH_USD_TTL_MS = 60_000;

/** A request the server will not serve, with the HTTP status to answer it with. */
export class TradeRefused extends Error {
  readonly name = 'TradeRefused';
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/**
 * Route handlers and the shared runtime can be built into different bundles, each with its own copy of this class, so a
 * refusal is recognised by its shape rather than with instanceof.
 */
export function isTradeRefused(err: unknown): err is TradeRefused {
  return !!err && typeof err === 'object' && (err as { name?: unknown }).name === 'TradeRefused' && typeof (err as { status?: unknown }).status === 'number';
}

export interface SignalRow {
  token: Token;
  signal: TradeSignal;
}

export interface TradeServiceOptions {
  live: boolean; // real tokens; simulated markets are never quoted
  enabled: boolean; // QUICK_BUY switch
  kyber: Pick<KyberClient, 'quote' | 'build'>;
  geckoApi: string;
  network: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/**
 * Signals, quotes and unsigned swaps for manual quick buy. The server decides what may be offered (the same gates the
 * page shows) and builds calldata; the user's wallet signs and sends it. No key is held here.
 */
export class TradeService {
  private ethUsdCache: { value: number; at: number } | null = null;
  private readonly recentBuilds = new Map<string, number[]>();

  constructor(
    private readonly agent: Agent,
    private readonly o: TradeServiceOptions,
  ) {}

  private now() {
    return this.o.now?.() ?? Date.now();
  }

  jarUnlocked(): boolean {
    const latest = this.agent.latest;
    return !!latest && latest.n >= 20 && evaluateModel(latest, this.agent.bound).unlocked;
  }

  /** Why quick buy is off on this server, or null when it is on. */
  disabledReason(): string | null {
    if (!this.o.live) return 'This server runs a simulated market: there is nothing real to buy.';
    if (!this.o.enabled) return 'Quick buy is switched off on this server.';
    return null;
  }

  /** Every watched token with its signal: active first, then disabled, then the rest; higher scores first. */
  signals(): SignalRow[] {
    const model = this.agent.latest?.model ?? null;
    const unlocked = this.jarUnlocked();
    const now = this.now();
    return [...this.agent.tokens.values()]
      .filter((t) => t.status === 'pending')
      .map((token) => ({ token, signal: tradeSignal(token, model, unlocked, now) }))
      .sort((a, b) => rank(b.signal) - rank(a.signal) || (b.signal.score ?? -1) - (a.signal.score ?? -1) || Date.parse(b.token.launchedAt) - Date.parse(a.token.launchedAt));
  }

  signalFor(mint: string): SignalRow | null {
    const token = this.agent.tokens.get(mint.toLowerCase());
    return token ? { token, signal: tradeSignal(token, this.agent.latest?.model ?? null, this.jarUnlocked(), this.now()) } : null;
  }

  /** ETH in USD from GeckoTerminal, cached for a minute; the last known price covers a brief outage. */
  async ethUsd(): Promise<number> {
    if (this.ethUsdCache && this.now() - this.ethUsdCache.at < ETH_USD_TTL_MS) return this.ethUsdCache.value;
    let value = NaN;
    try {
      const res = await (this.o.fetchImpl ?? fetch)(`${this.o.geckoApi}/simple/networks/${this.o.network}/token_price/${WETH}`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      const body: any = await res.json();
      value = Number(Object.values(body?.data?.attributes?.token_prices ?? {})[0]);
    } catch {
      // handled below
    }
    if (!(value > 0)) {
      if (this.ethUsdCache) return this.ethUsdCache.value;
      throw new TradeRefused('The ETH price is unavailable right now. Try again in a moment.', 503);
    }
    this.ethUsdCache = { value, at: this.now() };
    return value;
  }

  /** A buy of `usd` worth of ETH into a token that is an active signal right now. */
  async quoteBuy(mint: string, usd: number): Promise<{ quote: Quote; ethUsd: number }> {
    this.assertBuyable(mint);
    if (!(usd >= QUICK_BUY.minUsd && usd <= QUICK_BUY.maxUsd)) throw new TradeRefused(`A quick buy is between $${QUICK_BUY.minUsd} and $${QUICK_BUY.maxUsd}.`);
    const ethUsd = await this.ethUsd();
    const wei = BigInt(Math.floor((usd / ethUsd) * 1e18));
    const quote = await this.kyberCall(() => this.o.kyber.quote(NATIVE_ETH, mint.toLowerCase(), wei));
    if (!quote) throw new TradeRefused('There is no market for this token right now.', 404);
    return { quote, ethUsd };
  }

  /** A sale of `amount` raw token units back to ETH, or null when no market is left. Selling is never gated: a user must always be able to leave. */
  async quoteSell(mint: string, amount: bigint): Promise<Quote | null> {
    if (!ADDRESS.test(mint)) throw new TradeRefused('That is not a token address.');
    if (amount <= 0n) throw new TradeRefused('There is nothing to sell.');
    return this.kyberCall(() => this.o.kyber.quote(mint.toLowerCase(), NATIVE_ETH, amount));
  }

  /** Unsigned swap calldata for `sender`, checked against the trade it claims to be. */
  async build(side: 'buy' | 'sell', mint: string, summary: RouteSummary, sender: string, slippageBps: number): Promise<UnsignedSwap> {
    if (!ADDRESS.test(sender)) throw new TradeRefused('That is not a wallet address.');
    if (!ADDRESS.test(mint)) throw new TradeRefused('That is not a token address.');
    if (!Number.isInteger(slippageBps) || slippageBps < QUICK_BUY.minSlippageBps || slippageBps > QUICK_BUY.maxSlippageBps) {
      throw new TradeRefused(`Slippage must be between ${QUICK_BUY.minSlippageBps / 100}% and ${QUICK_BUY.maxSlippageBps / 100}%.`);
    }
    const token = mint.toLowerCase();
    const tokenIn = String(summary?.tokenIn ?? '').toLowerCase();
    const tokenOut = String(summary?.tokenOut ?? '').toLowerCase();
    if (side === 'buy') {
      this.assertBuyable(token);
      if (tokenIn !== NATIVE_ETH || tokenOut !== token) throw new TradeRefused('The quote does not match this buy.');
      const usd = Number(summary.amountInUsd);
      if (!(usd > 0) || usd > QUICK_BUY.maxUsd * 1.05) throw new TradeRefused(`A quick buy may not exceed $${QUICK_BUY.maxUsd}.`);
    } else {
      if (!this.o.live) throw new TradeRefused(this.disabledReason()!, 403); // switched off or not, a live server always lets a user sell
      if (tokenIn !== token || tokenOut !== NATIVE_ETH) throw new TradeRefused('The quote does not match this sale.');
    }
    this.limit(sender.toLowerCase());
    return this.kyberCall(() => this.o.kyber.build(summary, sender, slippageBps));
  }

  private assertBuyable(mint: string) {
    const reason = this.disabledReason();
    if (reason) throw new TradeRefused(reason, 403);
    if (!ADDRESS.test(mint)) throw new TradeRefused('That is not a token address.');
    const row = this.signalFor(mint);
    if (!row) throw new TradeRefused('Wassily is not watching this token.', 404);
    if (row.signal.state === 'disabled') throw new TradeRefused('The jar is not full, so quick buy is locked.', 403);
    if (row.signal.state !== 'active') throw new TradeRefused(`This token does not qualify right now (${row.signal.blockedBy}).`, 403);
  }

  private limit(sender: string) {
    const now = this.now();
    const recent = (this.recentBuilds.get(sender) ?? []).filter((at) => now - at < 60_000);
    if (recent.length >= BUILDS_PER_MINUTE) throw new TradeRefused('Too many trades in a minute. Wait a moment.', 429);
    recent.push(now);
    this.recentBuilds.set(sender, recent);
  }

  private async kyberCall<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if ((err as Error)?.name === 'KyberError') throw new TradeRefused(/rate limited/.test((err as Error).message) ? 'The router is busy. Try again in a moment.' : 'The router is unavailable right now. Try again.', 503);
      throw err;
    }
  }
}

const rank = (s: TradeSignal) => (s.state === 'active' ? 2 : s.state === 'disabled' ? 1 : 0);
