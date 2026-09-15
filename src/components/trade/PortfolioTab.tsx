'use client';

import { useEffect, useMemo, useState } from 'react';
import { positionValue, sell } from '@/client/tradeActions';
import { explorerTx } from '@/client/wallet';
import { QUICK_BUY } from '@/config/bot';
import { exitAlerts, positionsFrom, type ExitAlert, type Position } from '@/engine/portfolio';
import { cn } from '@/lib/cn';
import { useTrade } from '@/store/useTrade';
import { Badge, Button, Card, CardHeader, Stat } from '../ui/primitives';
import { TokenMark } from './SignalsCard';
import { WalletControl } from './WalletControl';

const REFRESH_MS = 60_000;

const ALERT: Record<ExitAlert, { label: string; tone: 'positive' | 'negative' | 'accent' }> = {
  take_profit: { label: `take profit reached (+${QUICK_BUY.takeProfitPct * 100}%)`, tone: 'positive' },
  stop_loss: { label: `stop loss reached (−${QUICK_BUY.stopLossPct * 100}%)`, tone: 'negative' },
  time_stop: { label: `held ${QUICK_BUY.timeStopHours}h`, tone: 'accent' },
};

const signed = (v: number | null) => (v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}$${Math.abs(v).toFixed(2)}`);
const pct = (v: number | null) => (v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${(v * 100).toFixed(1)}%`);
const price = (v: number | null) => (v == null || !Number.isFinite(v) || v <= 0 ? '—' : v >= 0.01 ? `$${v.toFixed(4)}` : `$${v.toPrecision(3)}`);
const whole = (raw: bigint, decimals: number) => Number(raw) / 10 ** decimals;
const ago = (ms: number) => {
  const h = (Date.now() - ms) / 3_600_000;
  return h < 1 ? `${Math.max(1, Math.round(h * 60))}m ago` : h < 48 ? `${h.toFixed(1)}h ago` : `${Math.round(h / 24)}d ago`;
};

interface Row {
  p: Position;
  value: number | null | undefined; // undefined: not priced yet · null: no market left
  pnlUsd: number | null;
  pnlPct: number | null;
  alerts: ExitAlert[];
}

function rowOf(p: Position, value: number | null | undefined, now: number): Row {
  let pnlUsd: number | null = p.realizedUsd;
  if (p.open) pnlUsd = value === undefined ? null : p.realizedUsd + (value ?? 0) - p.costUsd;
  return { p, value: p.open ? value : 0, pnlUsd, pnlPct: pnlUsd == null || p.investedUsd <= 0 ? null : pnlUsd / p.investedUsd, alerts: exitAlerts(p, value ?? (value === null ? 0 : null), now) };
}

function PositionCard({ row }: { row: Row }) {
  const { p, value, pnlUsd, pnlPct, alerts } = row;
  const busy = useTrade((s) => s.busy[p.mint]);
  const [custom, setCustom] = useState('');
  const held = whole(p.tokens, p.decimals);
  const status = !p.open ? 'Sold' : value === null ? 'No market' : 'Holding';
  const facts: [string, string][] = [
    ['Entry price', price(p.entryPriceUsd)],
    ['Current price', p.open ? price(value && held > 0 ? value / held : null) : '—'],
    ['Amount held', held.toLocaleString('en-US', { maximumFractionDigits: 2 })],
    ['Cost basis', `$${p.costUsd.toFixed(2)}`],
    ['Current value', value === undefined ? 'pricing…' : value === null ? '$0.00' : `$${value.toFixed(2)}`],
    ['Invested', `$${p.investedUsd.toFixed(2)}`],
    ['Realized', signed(p.realizedUsd)],
    ['Wassily score', p.score == null ? '—' : p.score.toFixed(3)],
  ];

  return (
    <li className="px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-3">
        <TokenMark src={p.logo} symbol={p.symbol} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-1.5">
            <span className="truncate text-sm font-medium text-fg">{p.name}</span>
            <span className="shrink-0 font-mono text-xs text-accent">${p.symbol}</span>
          </div>
          <div className="text-[11px] text-subtle">
            Bought {ago(p.openedAt)} ·{' '}
            <a href={explorerTx(p.buyHash)} target="_blank" rel="noopener noreferrer" className="hover:underline">
              buy tx
            </a>
          </div>
        </div>
        <div className="text-right">
          <div className={cn('font-mono text-sm font-semibold tabular-nums', pnlUsd == null ? 'text-muted' : pnlUsd >= 0 ? 'text-positive' : 'text-negative')}>
            {signed(pnlUsd)} <span className="text-xs">({pct(pnlPct)})</span>
          </div>
          <Badge tone={status === 'Holding' ? 'accent' : status === 'Sold' ? 'neutral' : 'negative'}>{status}</Badge>
        </div>
      </div>

      {alerts.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5" role="status">
          {alerts.map((a) => (
            <Badge key={a} tone={ALERT[a].tone}>
              {ALERT[a].label}
            </Badge>
          ))}
          <span className="text-[11px] text-subtle">Alerts only: nothing is sold for you.</span>
        </div>
      )}

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4">
        {facts.map(([term, v]) => (
          <div key={term} className="min-w-0">
            <dt className="text-[11px] text-muted">{term}</dt>
            <dd className="truncate font-mono text-xs text-fg tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>

      {p.open && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {[25, 50].map((v) => (
            <Button key={v} size="sm" onClick={() => void sell(p, v)} disabled={!!busy}>
              Sell {v}%
            </Button>
          ))}
          <Button size="sm" variant="primary" onClick={() => void sell(p, 100)} disabled={!!busy}>
            {busy ? 'Working…' : 'Sell all'}
          </Button>
          <label className="flex h-8 items-center gap-1 rounded-lg border border-border bg-surface px-2 text-xs text-muted focus-within:outline-2 focus-within:outline-accent">
            <input
              inputMode="decimal"
              value={custom}
              onChange={(e) => setCustom(e.target.value.replace(/[^0-9.]/g, ''))}
              placeholder="%"
              aria-label="Percent to sell"
              className="w-10 bg-transparent font-mono text-fg tabular-nums outline-none"
            />
            %
          </label>
          <Button size="sm" variant="ghost" disabled={!!busy || !(Number(custom) > 0 && Number(custom) <= 100)} onClick={() => void sell(p, Number(custom))}>
            Sell
          </Button>
        </div>
      )}
    </li>
  );
}

type Filter = 'open' | 'closed' | 'all';
type Sort = 'pnl' | 'date' | 'cost' | 'value';

/** Positions from the trades this browser recorded for the connected wallet, valued with live sell quotes. */
export function PortfolioTab() {
  const wallet = useTrade((s) => s.wallet);
  const trades = useTrade((s) => s.trades);
  const positions = useMemo(() => positionsFrom(trades), [trades]);
  const [values, setValues] = useState<Record<string, number | null>>({});
  const [now, setNow] = useState(() => Date.now());
  const [filter, setFilter] = useState<Filter>('open');
  const [sort, setSort] = useState<Sort>('date');
  const [query, setQuery] = useState('');

  useEffect(() => {
    let alive = true;
    const open = positions.filter((p) => p.open);
    const load = async () => {
      setNow(Date.now());
      for (const p of open) {
        try {
          const v = await positionValue(p);
          if (alive) setValues((prev) => ({ ...prev, [p.mint]: v }));
        } catch {
          // keeps the last value; the next refresh tries again
        }
      }
    };
    void load();
    const t = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [positions]);

  const rows = useMemo(() => positions.map((p) => rowOf(p, p.mint in values ? values[p.mint] : undefined, now)), [positions, values, now]);

  if (!wallet) {
    return (
      <Card>
        <CardHeader title="Portfolio" description="Your quick buy positions, valued live" />
        <div className="space-y-3 p-5">
          <p className="text-sm text-pretty text-muted">Connect the wallet you trade with. Quick buy records its trades in this browser, per wallet, and values them with live sell quotes.</p>
          <WalletControl />
        </div>
      </Card>
    );
  }

  const invested = rows.reduce((s, r) => s + r.p.investedUsd, 0);
  const openRows = rows.filter((r) => r.p.open);
  const currentValue = openRows.reduce((s, r) => s + (r.value ?? 0), 0);
  const priced = rows.filter((r) => r.pnlUsd != null);
  const totalPnl = priced.reduce((s, r) => s + (r.pnlUsd ?? 0), 0);
  const wins = priced.filter((r) => (r.pnlUsd ?? 0) > 0).length;
  const pcts = priced.map((r) => r.pnlPct).filter((v): v is number => v != null);

  const q = query.trim().toLowerCase();
  const shown = rows
    .filter((r) => (filter === 'all' ? true : filter === 'open' ? r.p.open : !r.p.open))
    .filter((r) => !q || r.p.symbol.toLowerCase().includes(q) || r.p.name.toLowerCase().includes(q))
    .sort((a, b) => {
      if (sort === 'pnl') return (b.pnlPct ?? -Infinity) - (a.pnlPct ?? -Infinity);
      if (sort === 'cost') return b.p.costUsd - a.p.costUsd;
      if (sort === 'value') return (b.value ?? -1) - (a.value ?? -1);
      return b.p.lastTradeAt - a.p.lastTradeAt;
    });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Total invested" value={`$${invested.toFixed(2)}`} hint={`${rows.length} ${rows.length === 1 ? 'token' : 'tokens'} traded`} />
        <Stat label="Current value" value={`$${currentValue.toFixed(2)}`} hint={`${openRows.length} open of ${QUICK_BUY.maxOpenPositions}`} />
        <Stat label="Total PnL" tone={totalPnl >= 0 ? 'positive' : 'negative'} value={signed(totalPnl)} hint={pct(invested ? totalPnl / invested : null)} />
        <Stat label="Win rate" value={priced.length ? `${Math.round((wins / priced.length) * 100)}%` : '—'} hint={pcts.length ? `best ${pct(Math.max(...pcts))} · worst ${pct(Math.min(...pcts))}` : 'no priced trades yet'} />
      </div>

      <Card>
        <CardHeader
          title="Positions"
          description="Values are live KyberSwap sell quotes, refreshed every minute. Exit rules alert you; they never sell for you."
          action={<WalletControl />}
        />
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
          {(['open', 'closed', 'all'] as Filter[]).map((f) => (
            <Button key={f} size="sm" variant={filter === f ? 'secondary' : 'ghost'} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f === 'open' ? 'Open' : f === 'closed' ? 'Closed' : 'All'}
            </Button>
          ))}
          <label className="ml-auto flex items-center gap-1.5 text-xs text-muted">
            Sort
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="h-8 rounded-lg border border-border bg-surface px-2 text-xs text-fg">
              <option value="date">Date</option>
              <option value="pnl">PnL %</option>
              <option value="cost">Cost basis</option>
              <option value="value">Current value</option>
            </select>
          </label>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search token"
            aria-label="Search by token name or ticker"
            className="h-8 w-full rounded-lg border border-border bg-surface px-2.5 text-sm text-fg sm:w-44"
          />
        </div>
        <ul className="divide-y divide-border">
          {shown.length === 0 && (
            <li className="p-5 text-sm text-muted">{trades.length === 0 ? 'No quick buy trades yet for this wallet in this browser.' : 'No position matches this filter.'}</li>
          )}
          {shown.map((r) => (
            <PositionCard key={r.p.mint} row={r} />
          ))}
        </ul>
      </Card>
    </div>
  );
}
