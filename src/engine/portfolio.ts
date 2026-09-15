import { QUICK_BUY } from '@/config/bot';

/** One confirmed trade from the user's wallet, as this browser recorded it. */
export interface TradeRecord {
  id: string; // the transaction hash
  kind: 'buy' | 'sell';
  mint: string;
  symbol: string;
  name: string;
  logo?: string;
  at: number; // ms
  usd: number; // spent on a buy, received on a sell (ETH at that moment's price)
  ethWei: string; // ETH sent (buy) or received (sell)
  gasWei: string;
  tokens: string; // raw token units bought or sold
  decimals: number;
  ethUsd: number;
  score?: number | null; // Wassily's score at the time of a buy
}

export interface Position {
  mint: string;
  symbol: string;
  name: string;
  logo?: string;
  decimals: number;
  tokens: bigint; // raw units still held, by the recorded trades
  costUsd: number; // cost basis of the tokens still held (average cost)
  investedUsd: number; // everything spent on buys
  realizedUsd: number; // profit or loss already booked by sales
  entryPriceUsd: number; // average USD per whole token paid
  openedAt: number;
  lastTradeAt: number;
  score: number | null;
  buyHash: string;
  open: boolean;
}

export type ExitAlert = 'take_profit' | 'stop_loss' | 'time_stop';

const units = (raw: bigint, decimals: number) => Number(raw) / 10 ** decimals;

/** Positions by average cost, from the trades in time order. */
export function positionsFrom(trades: readonly TradeRecord[]): Position[] {
  const byMint = new Map<string, Position>();
  for (const t of [...trades].sort((a, b) => a.at - b.at)) {
    const tokens = BigInt(t.tokens);
    let p = byMint.get(t.mint);
    if (!p) {
      p = { mint: t.mint, symbol: t.symbol, name: t.name, logo: t.logo, decimals: t.decimals, tokens: 0n, costUsd: 0, investedUsd: 0, realizedUsd: 0, entryPriceUsd: 0, openedAt: t.at, lastTradeAt: t.at, score: t.score ?? null, buyHash: t.id, open: true };
      byMint.set(t.mint, p);
    }
    p.lastTradeAt = t.at;
    if (t.kind === 'buy') {
      if (p.tokens === 0n) p.openedAt = t.at;
      p.tokens += tokens;
      p.costUsd += t.usd;
      p.investedUsd += t.usd;
    } else {
      const sold = tokens > p.tokens ? p.tokens : tokens;
      const share = p.tokens > 0n ? Number(sold) / Number(p.tokens) : 0;
      const costOut = p.costUsd * share;
      p.realizedUsd += t.usd - costOut;
      p.costUsd -= costOut;
      p.tokens -= sold;
    }
    const held = units(p.tokens, p.decimals);
    p.entryPriceUsd = held > 0 ? p.costUsd / held : p.entryPriceUsd;
    p.open = p.tokens > 0n;
  }
  return [...byMint.values()].sort((a, b) => b.lastTradeAt - a.lastTradeAt);
}

/** Exit rules the user set, checked against a live value. They alert; they never sell. */
export function exitAlerts(p: Position, valueUsd: number | null, now: number): ExitAlert[] {
  if (!p.open) return [];
  const out: ExitAlert[] = [];
  if (valueUsd != null && p.costUsd > 0) {
    const ret = valueUsd / p.costUsd - 1;
    if (ret >= QUICK_BUY.takeProfitPct) out.push('take_profit');
    if (ret <= -QUICK_BUY.stopLossPct) out.push('stop_loss');
  }
  if (now - p.openedAt >= QUICK_BUY.timeStopHours * 3_600_000) out.push('time_stop');
  return out;
}

export interface DayPnl {
  date: string; // YYYY-MM-DD, UTC
  pnlUsd: number; // realized on this day
  trades: number;
  wins: number; // sales that booked a profit
  losses: number;
  entries: { trade: TradeRecord; pnlUsd: number | null }[];
}

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Realized profit and loss by UTC day: a sale books its gain or loss on the day it happened. */
export function dailyPnl(trades: readonly TradeRecord[]): Map<string, DayPnl> {
  const days = new Map<string, DayPnl>();
  const held = new Map<string, { tokens: bigint; cost: number }>();
  for (const t of [...trades].sort((a, b) => a.at - b.at)) {
    const date = dayOf(t.at);
    const day = days.get(date) ?? { date, pnlUsd: 0, trades: 0, wins: 0, losses: 0, entries: [] };
    days.set(date, day);
    day.trades++;
    const h = held.get(t.mint) ?? { tokens: 0n, cost: 0 };
    held.set(t.mint, h);
    const tokens = BigInt(t.tokens);
    if (t.kind === 'buy') {
      h.tokens += tokens;
      h.cost += t.usd;
      day.entries.push({ trade: t, pnlUsd: null });
      continue;
    }
    const sold = tokens > h.tokens ? h.tokens : tokens;
    const share = h.tokens > 0n ? Number(sold) / Number(h.tokens) : 0;
    const costOut = h.cost * share;
    const pnl = t.usd - costOut;
    h.cost -= costOut;
    h.tokens -= sold;
    day.pnlUsd += pnl;
    if (pnl > 0) day.wins++;
    else if (pnl < 0) day.losses++;
    day.entries.push({ trade: t, pnlUsd: pnl });
  }
  return days;
}

/** Winning or losing days in a row (days with a realized result only). */
export function streaks(days: readonly DayPnl[]) {
  const results = [...days].filter((d) => d.wins + d.losses > 0).sort((a, b) => a.date.localeCompare(b.date));
  let best = 0;
  let run = 0;
  for (const d of results) {
    run = d.pnlUsd > 0 ? run + 1 : 0;
    best = Math.max(best, run);
  }
  let current = 0;
  for (let i = results.length - 1; i >= 0; i--) {
    const sign = Math.sign(results[i].pnlUsd);
    if (sign === 0) break;
    if (current === 0) current = sign;
    else if (Math.sign(current) === sign) current += sign;
    else break;
  }
  return { current, best };
}

export function tradesCsv(trades: readonly TradeRecord[]): string {
  const header = ['time_utc', 'kind', 'symbol', 'name', 'token', 'tokens', 'usd', 'eth', 'gas_eth', 'eth_usd', 'score', 'tx'];
  const cell = (v: string | number) => (/[",\r\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const rows = [...trades]
    .sort((a, b) => a.at - b.at)
    .map((t) =>
      [
        new Date(t.at).toISOString(),
        t.kind,
        t.symbol,
        t.name,
        t.mint,
        units(BigInt(t.tokens), t.decimals),
        t.usd.toFixed(2),
        units(BigInt(t.ethWei), 18),
        units(BigInt(t.gasWei), 18),
        t.ethUsd.toFixed(2),
        t.score == null ? '' : t.score.toFixed(4),
        t.id,
      ]
        .map(cell)
        .join(','),
    );
  return String.fromCharCode(0xfeff) + [header.join(','), ...rows].join('\r\n');
}
