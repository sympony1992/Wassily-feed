import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { QUICK_BUY } from '@/config/bot';
import { NATIVE_ETH, type KyberClient } from './kyber';
import type { TradeService } from './service';

export type PaperExit = 'take_profit' | 'stop_loss' | 'time_stop' | 'no_route';

export interface PaperPosition {
  mint: string;
  name: string;
  symbol: string;
  logo?: string;
  score: number;
  openedAt: string;
  stakeUsd: number;
  amountInWei: string;
  tokens: string; // raw units the quote delivered
  exchanges: string[];
  valueUsd: number; // what selling every token would return, at the last quote
  checkedAt: string;
  missedQuotes: number;
  breaches?: number; // checks in a row past the take profit or the stop loss
  closedAt?: string;
  exit?: PaperExit;
}

interface PaperFile {
  version: 1;
  positions: PaperPosition[];
}

export interface PaperOptions {
  file: string | null;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
}

const HOUR = 3_600_000;
const TICK_MS = 2 * 60_000;
const QUOTE_GAP_MS = 400; // KyberSwap is shared with every visitor's quick buy
const MAX_OPEN = 60;
const MISSED_QUOTES_TO_CLOSE = 3; // no route three checks running: the market is gone
const EXIT_CONFIRMATIONS = 2; // one odd quote never closes a position

/**
 * Paper trading: every token the moment it becomes an active signal is bought on paper for a fixed stake at a real
 * KyberSwap quote, then valued with real sell quotes until an exit rule closes it. Nothing is signed or sent. It shows
 * whether the signals would have made money, before anyone trusts them with their own.
 */
export class PaperTrader {
  readonly stats = { ticks: 0, opened: 0, closed: 0, errors: 0, reopened: 0, lastError: '', lastTickAt: '' };
  private positions: PaperPosition[] = [];
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    private readonly trade: Pick<TradeService, 'signals' | 'ethUsd'>,
    private readonly kyber: Pick<KyberClient, 'quote'>,
    private readonly o: PaperOptions,
  ) {
    this.positions = this.repair(this.load());
  }

  private now() {
    return this.o.now?.() ?? Date.now();
  }

  start() {
    const run = async () => {
      try {
        await this.tick();
      } catch (err) {
        this.fail(err);
      }
      if (!this.stopped) {
        this.timer = setTimeout(run, TICK_MS);
        this.timer.unref?.();
      }
    };
    this.timer = setTimeout(run, 30_000); // let the ingest restore its watch list first
    this.timer.unref?.();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.save();
  }

  /** Open positions for new active signals, then value every open position and apply the exit rules. Public for tests. */
  async tick() {
    const now = this.now();
    const open = this.positions.filter((p) => !p.closedAt);
    const seen = new Set(this.positions.map((p) => p.mint));

    for (const { token, signal } of this.trade.signals()) {
      if (signal.state !== 'active' || seen.has(token.mint.toLowerCase())) continue;
      if (open.length >= MAX_OPEN) break;
      try {
        const ethUsd = await this.trade.ethUsd();
        const wei = BigInt(Math.floor((QUICK_BUY.paperStakeUsd / ethUsd) * 1e18));
        const quote = await this.kyber.quote(NATIVE_ETH, token.mint.toLowerCase(), wei);
        await this.gap();
        if (!quote || BigInt(quote.summary.amountOut) <= 0n) continue; // no market to buy into: nothing to record
        const position: PaperPosition = {
          mint: token.mint.toLowerCase(),
          name: token.name,
          symbol: token.symbol,
          logo: token.logo,
          score: signal.score ?? 0,
          openedAt: new Date(now).toISOString(),
          stakeUsd: QUICK_BUY.paperStakeUsd,
          amountInWei: wei.toString(),
          tokens: quote.summary.amountOut,
          exchanges: quote.exchanges,
          valueUsd: QUICK_BUY.paperStakeUsd,
          checkedAt: new Date(now).toISOString(),
          missedQuotes: 0,
          breaches: 0,
        };
        this.positions.push(position);
        open.push(position);
        seen.add(position.mint);
        this.stats.opened++;
      } catch (err) {
        this.fail(err);
      }
    }

    let ethUsd = 0;
    if (open.length) {
      try {
        ethUsd = await this.trade.ethUsd();
      } catch (err) {
        this.fail(err); // without an ETH price nothing is valued this tick, and nothing is closed for it
      }
    }
    for (const p of ethUsd > 0 ? open : []) {
      try {
        const quote = await this.kyber.quote(p.mint, NATIVE_ETH, BigInt(p.tokens));
        await this.gap();
        p.checkedAt = new Date(now).toISOString();
        // Valued by the ETH the sale returns at our own ETH price: KyberSwap's USD field can be missing or zero, and a
        // zero output is a broken quote, not a worthless token.
        const ethOut = quote ? Number(BigInt(quote.summary.amountOut)) / 1e18 : 0;
        if (!(ethOut > 0)) {
          if (++p.missedQuotes >= MISSED_QUOTES_TO_CLOSE) this.close(p, 'no_route', 0, now);
          continue;
        }
        p.missedQuotes = 0;
        p.valueUsd = ethOut * ethUsd;
        const ret = p.valueUsd / p.stakeUsd - 1;
        const breach: PaperExit | null = ret >= QUICK_BUY.takeProfitPct ? 'take_profit' : ret <= -QUICK_BUY.stopLossPct ? 'stop_loss' : null;
        p.breaches = breach ? (p.breaches ?? 0) + 1 : 0;
        if (breach && p.breaches >= EXIT_CONFIRMATIONS) this.close(p, breach, p.valueUsd, now);
        else if (now - Date.parse(p.openedAt) >= QUICK_BUY.timeStopHours * HOUR) this.close(p, 'time_stop', p.valueUsd, now);
      } catch (err) {
        this.fail(err); // an outage is not a missing market: the position waits for the next check
      }
    }

    this.stats.ticks++;
    this.stats.lastTickAt = new Date(now).toISOString();
    this.save();
  }

  summary() {
    const closed = this.positions.filter((p) => p.closedAt);
    const open = this.positions.filter((p) => !p.closedAt);
    const invested = this.positions.reduce((s, p) => s + p.stakeUsd, 0);
    const value = this.positions.reduce((s, p) => s + p.valueUsd, 0);
    const returns = closed.map((p) => p.valueUsd / p.stakeUsd - 1);
    return {
      positions: this.positions.length,
      open: open.length,
      closed: closed.length,
      invested_usd: round2(invested),
      value_usd: round2(value),
      pnl_usd: round2(value - invested),
      pnl_pct: invested ? round4((value - invested) / invested) : 0,
      win_rate: closed.length ? round4(returns.filter((r) => r > 0).length / closed.length) : null,
      best_pct: returns.length ? round4(Math.max(...returns)) : null,
      worst_pct: returns.length ? round4(Math.min(...returns)) : null,
      stake_usd: QUICK_BUY.paperStakeUsd,
      last_tick_at: this.stats.lastTickAt || null,
    };
  }

  list(limit = 200): PaperPosition[] {
    return [...this.positions].sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt)).slice(0, limit);
  }

  private close(p: PaperPosition, exit: PaperExit, valueUsd: number, now: number) {
    p.valueUsd = valueUsd;
    p.exit = exit;
    p.closedAt = new Date(now).toISOString();
    this.stats.closed++;
  }

  /**
   * A stop loss at exactly $0 could only come from a quote that priced a still-trading sale at nothing (an early version
   * trusted KyberSwap's USD field). Those positions are reopened and valued again on the next tick; real zeros close as
   * "no route", and near-zero trap sales keep their result.
   */
  private repair(list: PaperPosition[]): PaperPosition[] {
    for (const p of list) {
      if (p.exit !== 'stop_loss' || p.valueUsd !== 0) continue;
      delete p.exit;
      delete p.closedAt;
      p.valueUsd = p.stakeUsd;
      p.missedQuotes = 0;
      p.breaches = 0;
      this.stats.reopened++;
    }
    if (this.stats.reopened) this.o.log?.(`paper: reopened ${this.stats.reopened} positions a zero-value quote had closed`);
    return list;
  }

  private gap() {
    return (this.o.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))))(QUOTE_GAP_MS);
  }

  private fail(err: unknown) {
    this.stats.errors++;
    this.stats.lastError = `${new Date(this.now()).toISOString()} ${String((err as Error)?.message ?? err).slice(0, 200)}`;
    this.o.log?.(`paper: ${this.stats.lastError}`);
  }

  private load(): PaperPosition[] {
    if (!this.o.file || !existsSync(this.o.file)) return [];
    try {
      const f = JSON.parse(readFileSync(this.o.file, 'utf8')) as PaperFile;
      return f.version === 1 && Array.isArray(f.positions) ? f.positions : [];
    } catch {
      return [];
    }
  }

  private save() {
    if (!this.o.file) return;
    const tmp = `${this.o.file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 1, positions: this.positions } satisfies PaperFile));
    renameSync(tmp, this.o.file);
  }
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const round4 = (v: number) => Math.round(v * 1e4) / 1e4;
