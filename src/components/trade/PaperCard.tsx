'use client';

import { useEffect, useState } from 'react';
import { fetchPaper, type PaperPositionJson, type PaperResponse } from '@/client/trade';
import { cn } from '@/lib/cn';
import { fmtInt } from '@/lib/format';
import { Badge, Card, CardHeader } from '../ui/primitives';
import { TokenMark } from './SignalsCard';

const EXIT: Record<NonNullable<PaperPositionJson['exit']>, { label: string; tone: 'positive' | 'negative' | 'neutral' }> = {
  take_profit: { label: 'take profit', tone: 'positive' },
  stop_loss: { label: 'stop loss', tone: 'negative' },
  time_stop: { label: 'time stop', tone: 'neutral' },
  no_route: { label: 'no market', tone: 'negative' },
};

const pct = (v: number | null | undefined) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`);
const usd = (v: number) => `${v < 0 ? '−' : ''}$${Math.abs(v).toFixed(2)}`;

/** Phase 1 in public: what the signals would have made, bought on paper at real quotes. */
export function PaperCard() {
  const [data, setData] = useState<PaperResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetchPaper()
        .then((d) => {
          if (!alive) return;
          setData(d);
          setError(null);
        })
        .catch((e: Error) => alive && setError(e.message));
    void load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const s = data?.summary;
  const stats: [string, string, string?][] = s
    ? [
        ['Paper trades', fmtInt(s.positions), `${s.open} open · ${s.closed} closed`],
        ['PnL', usd(s.pnl_usd), pct(s.pnl_pct)],
        ['Win rate', s.win_rate == null ? '—' : `${Math.round(s.win_rate * 100)}%`, 'closed trades'],
        ['Best · worst', `${pct(s.best_pct)} · ${pct(s.worst_pct)}`, 'closed trades'],
      ]
    : [];

  return (
    <Card>
      <CardHeader
        title="Paper trading record"
        description={
          s
            ? `Every token that turns into a buy signal is bought on paper for $${s.stake_usd} at a real KyberSwap quote and valued with real sell quotes every 2 minutes. Network fees are not included.`
            : 'Signals bought on paper at real quotes, before anyone trusts them with money.'
        }
        action={<Badge>{data?.enabled === false ? 'off' : 'dry run'}</Badge>}
      />
      {error && <p className="p-5 text-sm text-negative">Could not load the paper record: {error}</p>}
      {data && !data.enabled && <p className="p-5 text-sm text-muted">Paper trading runs on the live server only.</p>}
      {s && (
        <>
          <dl className="grid grid-cols-2 gap-px border-b border-border bg-border lg:grid-cols-4">
            {stats.map(([term, value, hint]) => (
              <div key={term} className="bg-surface px-4 py-3">
                <dt className="text-xs text-muted">{term}</dt>
                <dd className={cn('mt-0.5 font-mono text-base font-semibold tabular-nums', term === 'PnL' ? (s.pnl_usd >= 0 ? 'text-positive' : 'text-negative') : 'text-fg')}>{value}</dd>
                {hint && <dd className="text-[11px] text-subtle">{hint}</dd>}
              </div>
            ))}
          </dl>
          <ul className="scrollbar-thin max-h-80 divide-y divide-border overflow-y-auto">
            {data.positions.length === 0 && <li className="p-5 text-sm text-muted">No buy signal yet. The first one is recorded the moment a token qualifies while the jar is full.</li>}
            {data.positions.map((p) => (
              <li key={p.mint} className="flex items-center gap-3 px-4 py-2.5">
                <TokenMark src={p.logo} symbol={p.symbol} />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-baseline gap-1.5">
                    <span className="truncate text-sm font-medium text-fg">{p.name}</span>
                    <span className="shrink-0 font-mono text-xs text-accent">${p.symbol}</span>
                  </div>
                  <div className="truncate text-[11px] text-subtle">
                    {new Date(p.opened_at).toISOString().slice(5, 16).replace('T', ' ')} UTC · score {p.score.toFixed(3)} · {p.exchanges.join(' → ')}
                  </div>
                </div>
                <div className="text-right">
                  <div className={cn('font-mono text-sm tabular-nums', p.pnl_pct >= 0 ? 'text-positive' : 'text-negative')}>{pct(p.pnl_pct)}</div>
                  <div className="font-mono text-[11px] text-subtle tabular-nums">${p.value_usd.toFixed(2)}</div>
                </div>
                <span className="w-20 text-right">{p.exit ? <Badge tone={EXIT[p.exit].tone}>{EXIT[p.exit].label}</Badge> : <Badge tone="accent">open</Badge>}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
