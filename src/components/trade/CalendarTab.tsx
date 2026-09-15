'use client';

import { useMemo, useState } from 'react';
import { dailyPnl, positionsFrom, streaks, tradesCsv, type DayPnl } from '@/engine/portfolio';
import { cn } from '@/lib/cn';
import { saveFile } from '@/lib/download';
import { useTrade } from '@/store/useTrade';
import { IconArrowRight, IconDownload } from '../ui/Icons';
import { Badge, Button, Card, CardHeader, Stat } from '../ui/primitives';
import { WalletControl } from './WalletControl';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// Literal class names so the stylesheet includes them: stronger colour for a bigger share of the month's largest day.
const GREEN = ['bg-positive/10', 'bg-positive/20', 'bg-positive/35', 'bg-positive/50'];
const RED = ['bg-negative/10', 'bg-negative/20', 'bg-negative/35', 'bg-negative/50'];

const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}$${Math.abs(v).toFixed(2)}`;
const iso = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

function weeksOf(y: number, m: number): (string | null)[][] {
  const lead = (new Date(Date.UTC(y, m, 1)).getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => iso(y, m, i + 1))];
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
}

function tint(day: DayPnl | undefined, maxAbs: number) {
  if (!day || day.pnlUsd === 0 || maxAbs <= 0) return '';
  const step = Math.min(3, Math.floor((Math.abs(day.pnlUsd) / maxAbs) * 4));
  return (day.pnlUsd > 0 ? GREEN : RED)[step];
}

/** Realized PnL by UTC day for the connected wallet's quick buy trades. */
export function CalendarTab() {
  const wallet = useTrade((s) => s.wallet);
  const trades = useTrade((s) => s.trades);
  const days = useMemo(() => dailyPnl(trades), [trades]);
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
  });
  const [selected, setSelected] = useState<string | null>(null);

  if (!wallet) {
    return (
      <Card>
        <CardHeader title="PnL calendar" description="Daily realized profit and loss" />
        <div className="space-y-3 p-5">
          <p className="text-sm text-pretty text-muted">Connect the wallet you trade with to see its days.</p>
          <WalletControl />
        </div>
      </Card>
    );
  }

  const prefix = iso(cursor.y, cursor.m, 1).slice(0, 7);
  const monthDays = [...days.values()].filter((d) => d.date.startsWith(prefix));
  const results = monthDays.filter((d) => d.wins + d.losses > 0);
  const maxAbs = Math.max(0, ...monthDays.map((d) => Math.abs(d.pnlUsd)));
  const monthPnl = monthDays.reduce((s, d) => s + d.pnlUsd, 0);
  const monthTrades = monthDays.reduce((s, d) => s + d.trades, 0);
  const wins = monthDays.reduce((s, d) => s + d.wins, 0);
  const losses = monthDays.reduce((s, d) => s + d.losses, 0);
  const best = results.length ? results.reduce((a, b) => (b.pnlUsd > a.pnlUsd ? b : a)) : null;
  const worst = results.length ? results.reduce((a, b) => (b.pnlUsd < a.pnlUsd ? b : a)) : null;

  const allResults = [...days.values()].filter((d) => d.wins + d.losses > 0);
  const streak = streaks(allResults);
  const mean = allResults.length ? allResults.reduce((s, d) => s + d.pnlUsd, 0) / allResults.length : 0;
  const sd = allResults.length > 1 ? Math.sqrt(allResults.reduce((s, d) => s + (d.pnlUsd - mean) ** 2, 0) / (allResults.length - 1)) : 0;
  const buys = trades.filter((t) => t.kind === 'buy');
  const closed = positionsFrom(trades).filter((p) => !p.open);
  const avgHoldH = closed.length ? closed.reduce((s, p) => s + (p.lastTradeAt - p.openedAt), 0) / closed.length / 3_600_000 : null;

  const shift = (delta: number) => {
    setSelected(null);
    setCursor(({ y, m }) => {
      const d = new Date(Date.UTC(y, m + delta, 1));
      return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
    });
  };
  const detail = selected ? days.get(selected) : undefined;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="PnL calendar"
          description="Realized profit and loss by UTC day: a sale books its result on the day it happened."
          action={
            <Button size="sm" onClick={() => saveFile('wassily-trades.csv', tradesCsv(trades), 'text/csv;charset=utf-8')} disabled={!trades.length}>
              <IconDownload className="size-3.5" /> Export CSV
            </Button>
          }
        />
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
          <Button size="sm" variant="ghost" onClick={() => shift(-1)} aria-label="Previous month">
            <IconArrowRight className="size-3.5 rotate-180" />
          </Button>
          <span className="text-sm font-medium text-fg">
            {MONTHS[cursor.m]} {cursor.y}
          </span>
          <Button size="sm" variant="ghost" onClick={() => shift(1)} aria-label="Next month">
            <IconArrowRight className="size-3.5" />
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] table-fixed border-collapse text-xs">
            <thead>
              <tr>
                {[...WEEKDAYS, 'Week'].map((d) => (
                  <th key={d} className="border-b border-border px-1 py-2 text-center font-medium text-subtle">
                    {d}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeksOf(cursor.y, cursor.m).map((week, w) => {
                const weekPnl = week.reduce((s, date) => s + (date ? (days.get(date)?.pnlUsd ?? 0) : 0), 0);
                const weekTrades = week.reduce((s, date) => s + (date ? (days.get(date)?.trades ?? 0) : 0), 0);
                return (
                  <tr key={w}>
                    {week.map((date, i) => {
                      const day = date ? days.get(date) : undefined;
                      return (
                        <td key={date ?? `empty-${w}-${i}`} className="h-20 border border-border p-0 align-top">
                          {date && (
                            <button
                              type="button"
                              onClick={() => setSelected(date === selected ? null : date)}
                              aria-pressed={date === selected}
                              aria-label={`${date}${day ? `: ${signed(day.pnlUsd)}, ${day.trades} trades` : ''}`}
                              className={cn(
                                'flex size-full cursor-pointer flex-col items-start gap-0.5 p-1.5 text-left transition-colors duration-150 hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
                                tint(day, maxAbs),
                                date === selected && 'ring-2 ring-accent ring-inset',
                              )}
                            >
                              <span className="font-mono text-[11px] text-subtle tabular-nums">{Number(date.slice(8))}</span>
                              {day && (
                                <>
                                  <span className={cn('font-mono text-xs font-semibold tabular-nums', day.pnlUsd > 0 ? 'text-positive' : day.pnlUsd < 0 ? 'text-negative' : 'text-muted')}>
                                    {day.wins + day.losses ? signed(day.pnlUsd) : '—'}
                                  </span>
                                  <span className="text-[11px] text-muted">
                                    {day.trades} {day.trades === 1 ? 'trade' : 'trades'}
                                  </span>
                                </>
                              )}
                            </button>
                          )}
                        </td>
                      );
                    })}
                    <td className="h-20 border border-border bg-surface-2 p-1.5 align-top">
                      {weekTrades > 0 && (
                        <>
                          <span className={cn('block font-mono text-xs font-semibold tabular-nums', weekPnl > 0 ? 'text-positive' : weekPnl < 0 ? 'text-negative' : 'text-muted')}>{signed(weekPnl)}</span>
                          <span className="text-[11px] text-muted">{weekTrades} trades</span>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="border-t border-border px-4 py-2.5 font-mono text-xs text-pretty text-muted tabular-nums">
          {MONTHS[cursor.m]}: PnL {signed(monthPnl)} · {monthTrades} trades · win rate {wins + losses ? `${Math.round((wins / (wins + losses)) * 100)}%` : '—'} · best {best ? signed(best.pnlUsd) : '—'} · worst{' '}
          {worst ? signed(worst.pnlUsd) : '—'}
        </p>
      </Card>

      {detail && (
        <Card>
          <CardHeader title={`Trades on ${detail.date}`} description={`${detail.trades} trades · realized ${signed(detail.pnlUsd)}`} />
          <ul className="divide-y divide-border">
            {detail.entries.map(({ trade, pnlUsd }) => (
              <li key={trade.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                <Badge tone={trade.kind === 'buy' ? 'accent' : 'neutral'}>{trade.kind}</Badge>
                <span className="font-mono text-xs text-subtle tabular-nums">{new Date(trade.at).toISOString().slice(11, 16)} UTC</span>
                <span className="min-w-0 flex-1 truncate text-fg">
                  {trade.name} <span className="font-mono text-xs text-accent">${trade.symbol}</span>
                </span>
                <span className="font-mono text-xs text-fg tabular-nums">${trade.usd.toFixed(2)}</span>
                <span className={cn('w-20 text-right font-mono text-xs tabular-nums', pnlUsd == null ? 'text-subtle' : pnlUsd >= 0 ? 'text-positive' : 'text-negative')}>{pnlUsd == null ? 'entry' : signed(pnlUsd)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Current streak" value={streak.current === 0 ? '—' : `${streak.current > 0 ? '+' : '−'}${Math.abs(streak.current)} days`} hint={streak.current >= 0 ? 'winning days' : 'losing days'} />
        <Stat label="Best streak" value={streak.best ? `+${streak.best} days` : '—'} hint="green days in a row" />
        <Stat label="Average daily PnL" value={allResults.length ? signed(mean) : '—'} hint={`${allResults.length} days with results`} />
        <Stat label="Average trade size" value={buys.length ? `$${(buys.reduce((s, t) => s + t.usd, 0) / buys.length).toFixed(2)}` : '—'} hint={`${buys.length} buys`} />
        <Stat label="Average hold time" value={avgHoldH == null ? '—' : avgHoldH < 48 ? `${avgHoldH.toFixed(1)}h` : `${(avgHoldH / 24).toFixed(1)}d`} hint={`${closed.length} closed positions`} />
        <Stat label="Sharpe-like ratio" value={sd > 0 ? (mean / sd).toFixed(2) : '—'} hint="mean ÷ std of daily PnL" />
      </div>
    </div>
  );
}
