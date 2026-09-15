'use client';

import { useEffect, useState } from 'react';
import { fetchSignals, type SignalJson, type SignalsResponse } from '@/client/trade';
import { BOT_DRAFT } from '@/config/bot';
import { SITE, fmtUsdK } from '@/config/site';
import { GATE_LABELS, MAX_ROUND_TRIP_LOSS, SIGNAL_GATES } from '@/engine/tradeSignal';
import { cn } from '@/lib/cn';
import { fmtInt, fmtMC } from '@/lib/format';
import { useTrade, type BusyKind } from '@/store/useTrade';
import { IconCheck, IconClose } from '../ui/Icons';
import { Badge, Button, Card, CardHeader } from '../ui/primitives';

const BUSY_LABEL: Record<BusyKind, string> = { quote: 'Pricing…', confirm: 'Confirm…', approve: 'Approving…', wallet: 'In wallet…', pending: 'Pending…' };

const roundTripText = (v: number | null | undefined) => (v == null ? '' : `${v > 0 ? '+' : ''}${(v * 100).toFixed(1)}%`);

/** The first failing gate, in a few words. */
function reason(s: SignalJson): string {
  switch (s.blocked_by) {
    case 'watching':
      return 'labelled';
    case 'age':
      return s.age_hours < 1 ? 'under 1h old' : 'past 48h';
    case 'entry':
      return `under ${fmtUsdK(SITE.entryMc)}`;
    case 'below_target':
      return `past ${fmtUsdK(SITE.targetMc)}`;
    case 'holders':
      return 'holders pending';
    case 'score':
      return 'score too low';
    case 'name':
      return 'copies a famous ticker';
    case 'copycat':
      return 'copycat symbol';
    case 'market':
      if (!s.market) return 'checking market';
      if (s.market.reason === 'no_route') return 'no market to buy';
      if (s.market.reason === 'no_sale') return 'cannot be sold back';
      return `round trip ${roundTripText(s.market.round_trip)}`;
    case 'jar':
      return 'jar not full';
    default:
      return '';
  }
}

export function TokenMark({ src, symbol }: { src: string | null | undefined; symbol: string }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) return <span aria-hidden className="size-8 shrink-0 rounded-full border border-border bg-surface-2" />;
  return <img src={src} alt={`${symbol} logo`} onError={() => setBroken(true)} className="size-8 shrink-0 rounded-full object-cover" />;
}

function Row({ s, enabled, onQuickBuy, amountUsd, busy }: { s: SignalJson; enabled: { ok: boolean; reason: string | null }; onQuickBuy: (s: SignalJson) => void; amountUsd: number; busy?: BusyKind }) {
  const [open, setOpen] = useState(false);
  const label = busy ? BUSY_LABEL[busy] : `Quick Buy $${amountUsd}`;
  return (
    <li>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 sm:grid-cols-[minmax(0,1fr)_4.5rem_5.5rem_4rem_9rem]">
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex min-w-0 cursor-pointer items-center gap-2.5 rounded-md text-left focus-visible:outline-2 focus-visible:outline-accent">
          <TokenMark src={s.logo} symbol={s.symbol} />
          <span className="min-w-0">
            <span className="flex min-w-0 items-baseline gap-1.5">
              <span className="truncate text-sm font-medium text-fg">{s.name}</span>
              <span className="shrink-0 font-mono text-xs text-accent">${s.symbol}</span>
            </span>
            <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-subtle">
              {s.state === 'active' && <Badge tone="positive">Wassily would buy</Badge>}
              {s.state === 'disabled' && <Badge tone="accent">would buy · jar locked</Badge>}
              {s.state === 'none' && <span>{reason(s)}</span>}
              <span className="font-mono tabular-nums sm:hidden">
                {fmtMC(s.peak_mc)} · {s.score == null ? '—' : s.score.toFixed(3)}
              </span>
            </span>
          </span>
        </button>
        <span className="hidden text-right font-mono text-xs text-muted tabular-nums sm:block" title={`Holders ${SITE.holderSampleHours}h after launch`}>
          {s.holders == null ? '—' : fmtInt(s.holders)}
        </span>
        <span className="hidden text-right font-mono text-xs text-muted tabular-nums sm:block">
          {fmtMC(s.peak_mc)}
          <span className="block text-[11px] text-subtle">{s.age_hours.toFixed(1)}h old</span>
        </span>
        <span className={cn('hidden text-right font-mono text-xs tabular-nums sm:block', s.state === 'none' ? 'text-muted' : 'text-fg')}>{s.score == null ? '—' : s.score.toFixed(3)}</span>
        <span className="text-right">
          {s.state === 'active' && enabled.ok && (
            <Button size="sm" variant="primary" onClick={() => onQuickBuy(s)} disabled={!!busy}>
              {label}
            </Button>
          )}
          {(s.state === 'disabled' || (s.state === 'active' && !enabled.ok)) && (
            <Button size="sm" disabled title={s.state === 'disabled' ? 'Jar not full' : (enabled.reason ?? 'Quick buy is off')}>
              Quick Buy ${amountUsd}
            </Button>
          )}
        </span>
      </div>
      {open && (
        <div className="border-t border-dashed border-border bg-surface-2 px-4 py-3">
          <ul className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {SIGNAL_GATES.map((g) => (
              <li key={g} className="flex items-center gap-2 text-xs text-fg">
                {s.gates[g] ? <IconCheck className="size-3.5 text-positive" /> : <IconClose className="size-3.5 text-negative" />}
                {GATE_LABELS[g]}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-pretty text-subtle">
            Score {s.score == null ? 'not available until the holder count is in' : s.score.toFixed(4)}: the latest model&apos;s survival probability, computed on the server with this token&apos;s own
            holder count.{' '}
            {s.market
              ? s.market.ok
                ? `Market checked ${new Date(s.market.checked_at).toISOString().slice(11, 16)} UTC: a $10 test buy sold straight back returns ${roundTripText(s.market.round_trip)}.`
                : s.market.reason === 'no_route'
                  ? 'Market checked: the router has no way to buy this token.'
                  : s.market.reason === 'no_sale'
                    ? 'Market checked: a buy could not be sold back.'
                    : `Market checked: a $10 test buy sold straight back returns ${roundTripText(s.market.round_trip)}, beyond the ${MAX_ROUND_TRIP_LOSS * 100}% limit.`
              : ''}
          </p>
        </div>
      )}
    </li>
  );
}

/** Watched tokens with the server's score and quick buy state, refreshed every 30 seconds. */
export function SignalsCard({ onQuickBuy }: { onQuickBuy: (s: SignalJson) => void }) {
  const [data, setData] = useState<SignalsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useTrade((s) => s.busy);
  const amountUsd = useTrade((s) => s.settings.amountUsd);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetchSignals()
        .then((d) => {
          if (!alive) return;
          setData(d);
          setError(null);
        })
        .catch((e: Error) => alive && setError(e.message));
    void load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const enabled = { ok: !!data?.quick_buy.enabled, reason: data?.quick_buy.reason ?? null };
  const counts = data?.counts;

  return (
    <Card className="flex flex-col">
      <CardHeader
        title="Tokens Wassily would buy"
        description={
          counts
            ? `${fmtInt(counts.watching)} watched · ${counts.active} would buy · ${counts.locked} held by the jar · ${fmtInt(counts.scored)} scored · click a token for its gates`
            : 'Loading the watch list…'
        }
        action={
          data ? (
            <Badge tone={data.quick_buy.jar_unlocked ? 'positive' : 'accent'}>{data.quick_buy.jar_unlocked ? 'Jar full · trading open' : 'Jar not full · locked'}</Badge>
          ) : undefined
        }
      />
      {data && !data.quick_buy.enabled && data.quick_buy.reason && <p className="border-b border-border bg-surface-2 px-4 py-2 text-xs text-pretty text-muted">{data.quick_buy.reason}</p>}
      <div className="hidden grid-cols-[minmax(0,1fr)_4.5rem_5.5rem_4rem_9rem] gap-3 border-b border-border px-4 py-2 text-xs text-subtle sm:grid">
        <span>Token</span>
        <span className="text-right">Holders 1h</span>
        <span className="text-right">Peak cap</span>
        <span className="text-right">Score</span>
        <span className="text-right">Quick buy</span>
      </div>
      <ul className="scrollbar-thin max-h-[36rem] min-h-48 divide-y divide-border overflow-y-auto" aria-label="Watched tokens and quick buy">
        {error && <li className="p-5 text-sm text-negative">Could not load the watch list: {error}</li>}
        {data && data.signals.length === 0 && <li className="p-5 text-sm text-muted">No watched token has a score yet. Tokens are scored once their 1h holder count is in.</li>}
        {data?.signals.map((s) => (
          <Row key={s.mint} s={s} enabled={enabled} onQuickBuy={onQuickBuy} amountUsd={amountUsd} busy={busy[s.mint.toLowerCase()]} />
        ))}
      </ul>
      <p className="border-t border-border px-4 py-2.5 text-xs text-pretty text-subtle">
        A button appears only when every gate passes: watched and not yet labelled, {SITE.holderSampleHours}–{SITE.labelHours}h old, a peak between {fmtUsdK(SITE.entryMc)} and{' '}
        {fmtUsdK(SITE.targetMc)}, the holder count known, a score of at least {BOT_DRAFT.minScore.toFixed(2)}, not a copied ticker or a symbol another watched token uses, a market that can be
        bought and sold back within {MAX_ROUND_TRIP_LOSS * 100}% right now, and the jar at 100%.
      </p>
    </Card>
  );
}
