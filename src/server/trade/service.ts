/* eslint-disable @typescript-eslint/no-explicit-any */
import { QUICK_BUY } from '@/config/bot';
import { evaluateModel } from '@/engine/proof';
import { MAX_ROUND_TRIP_LOSS, needsMarketCheck, tradeSignal, type MarketCheck, type TradeSignal } from '@/engine/tradeSignal';
import type { ScoringModel, Token } from '@/engine/types';
import type { Agent } from '../agent';
import { WETH } from '../chain/abi';
import { NATIVE_ETH, type KyberClient, type Quote, type RouteSummary, type UnsignedSwap } from './kyber';

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const BUILDS_PER_MINUTE = 6; // per wallet: a double click or a stuck button cannot fire a burst of swaps
const ETH_USD_TTL_MS = 60_000;
const MARKET_PROBE_USD = 10; // the test buy a market check prices, then sells straight back
const MARKET_OK_TTL_MS = 10 * 60_000; // a working market is asked again after this long
const NO_MARKET_TTL_MS = 5 * 60_000; // a missing one sooner: new pools get indexed
const MARKET_MAX_AGE_MS = 30 * 60_000; // an answer older than this no longer counts either way
const MARKET_CHECKS_PER_RUN = 25;
const MARKET_RUN_MS = 60_000;
const MARKET_GAP_MS = 400; // KyberSwap is shared with every visitor's quick buy
// Names no signal should ever show, whatever they score.
const OFFENSIVE = /n[i1!]gg(?:er|a|uh)|f[a@4]gg[o0]t|\bk[i1]ke\b/i;

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
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Signals, market checks, quotes and unsigned swaps for manual quick buy. The server decides what may be offered (the
 * same gates the page shows, including a market that can really be bought and sold back) and builds calldata; the
 * user's wallet signs and sends it. No key is held here.
 */
export class TradeService {
  readonly marketStats = { runs: 0, checks: 0, errors: 0, lastRunAt: '' };
  private ethUsdCache: { value: number; at: number } | null = null;
  private readonly recentBuilds = new Map<string, number[]>();
  private readonly markets = new Map<string, MarketCheck>();
  private marketTimer: NodeJS.Timeout | null = null;
  private stopped = false;

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
    const watched = [...this.agent.tokens.values()].filter((t) => t.status === 'pending' && !OFFENSIVE.test(`${t.symbol} ${t.name}`));
    const symbols = new Map<string, number>();
    for (const t of watched) symbols.set(symbolKey(t), (symbols.get(symbolKey(t)) ?? 0) + 1);
    return watched
      .map((token) => ({ token, signal: this.judge(token, model, unlocked, now, symbols) }))
      .sort((a, b) => rank(b.signal) - rank(a.signal) || (b.signal.score ?? -1) - (a.signal.score ?? -1) || Date.parse(b.token.launchedAt) - Date.parse(a.token.launchedAt));
  }

  signalFor(mint: string): SignalRow | null {
    const key = mint.toLowerCase();
    return this.signals().find((r) => r.token.mint.toLowerCase() === key) ?? null;
  }

  private judge(token: Token, model: ScoringModel | null, unlocked: boolean, now: number, symbols: Map<string, number>): TradeSignal {
    const market = this.markets.get(token.mint.toLowerCase());
    return tradeSignal(token, model, unlocked, now, {
      copies: (symbols.get(symbolKey(token)) ?? 1) - 1,
      market: market && now - market.checkedAt < MARKET_MAX_AGE_MS ? market : null,
    });
  }

  /**
   * Ask the router about tokens that pass every other gate and have no recent answer: price a $10 buy, then sell those
   * tokens straight back. No route either way, or a round trip that loses more than the limit, means no button.
   * Public for tests.
   */
  async refreshMarkets() {
    if (!this.o.live) return;
    const now = this.now();
    const due = this.signals()
      .filter((r) => needsMarketCheck(r.signal))
      .filter((r) => {
        const m = this.markets.get(r.token.mint.toLowerCase());
        return !m || now - m.checkedAt >= (m.ok ? MARKET_OK_TTL_MS : NO_MARKET_TTL_MS);
      })
      .slice(0, MARKET_CHECKS_PER_RUN);

    for (const key of [...this.markets.keys()]) if (this.agent.tokens.get(key)?.status !== 'pending') this.markets.delete(key);
    if (!due.length) return;

    let ethUsd: number;
    try {
      ethUsd = await this.ethUsd();
    } catch {
      this.marketStats.errors++;
      return;
    }
    const wei = BigInt(Math.floor((MARKET_PROBE_USD / ethUsd) * 1e18));
    for (const { token } of due) {
      if (this.stopped) return;
      const key = token.mint.toLowerCase();
      try {
        const buy = await this.o.kyber.quote(NATIVE_ETH, key, wei);
        await this.gap();
        let check: MarketCheck;
        if (!buy) {
          check = { ok: false, reason: 'no_route', roundTrip: null, checkedAt: this.now() };
        } else {
          const sale = await this.o.kyber.quote(key, NATIVE_ETH, BigInt(buy.summary.amountOut));
          await this.gap();
          const spent = Number(buy.summary.amountInUsd) || MARKET_PROBE_USD;
          const roundTrip = sale ? Number(sale.summary.amountOutUsd) / spent - 1 : null;
          if (roundTrip == null) check = { ok: false, reason: 'no_sale', roundTrip: null, checkedAt: this.now() };
          else check = { ok: roundTrip >= -MAX_ROUND_TRIP_LOSS, reason: roundTrip >= -MAX_ROUND_TRIP_LOSS ? null : 'round_trip', roundTrip, checkedAt: this.now() };
        }
        this.markets.set(key, check);
        this.marketStats.checks++;
      } catch {
        this.marketStats.errors++; // an outage is not a missing market: the token is asked again on the next run
      }
    }
    this.marketStats.runs++;
    this.marketStats.lastRunAt = new Date(this.now()).toISOString();
  }

  startMarketChecks() {
    if (!this.o.live || this.marketTimer) return;
    const run = async () => {
      try {
        await this.refreshMarkets();
      } catch {
        this.marketStats.errors++;
      }
      if (!this.stopped) {
        this.marketTimer = setTimeout(run, MARKET_RUN_MS);
        this.marketTimer.unref?.();
      }
    };
    this.marketTimer = setTimeout(run, 5_000);
    this.marketTimer.unref?.();
  }

  stopMarketChecks() {
    this.stopped = true;
    if (this.marketTimer) clearTimeout(this.marketTimer);
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
    if (!quote) {
      this.markets.set(mint.toLowerCase(), { ok: false, reason: 'no_route', roundTrip: null, checkedAt: this.now() }); // the button goes away at once
      throw new TradeRefused('There is no market for this token right now.', 404);
    }
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
    const { signal } = row;
    if (signal.state === 'disabled') throw new TradeRefused('The jar is not full, so quick buy is locked.', 403);
    if (signal.blockedBy === 'market') {
      throw new TradeRefused(
        !signal.market ? 'This token’s market is still being checked. Try again in a minute.' : 'This token has no market that can be bought and sold back right now.',
        403,
      );
    }
    if (signal.state !== 'active') throw new TradeRefused(`This token does not qualify right now (${signal.blockedBy}).`, 403);
  }

  private limit(sender: string) {
    const now = this.now();
    const recent = (this.recentBuilds.get(sender) ?? []).filter((at) => now - at < 60_000);
    if (recent.length >= BUILDS_PER_MINUTE) throw new TradeRefused('Too many trades in a minute. Wait a moment.', 429);
    recent.push(now);
    this.recentBuilds.set(sender, recent);
  }

  private gap() {
    return (this.o.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))))(MARKET_GAP_MS);
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

const symbolKey = (t: Pick<Token, 'symbol'>) => t.symbol.trim().toLowerCase();
const rank = (s: TradeSignal) => (s.state === 'active' ? 2 : s.state === 'disabled' ? 1 : 0);
