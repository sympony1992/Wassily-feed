import { useState } from 'react';
import { SITE, fmtUsdK } from '@/config/site';
import type { Token } from '@/engine/types';
import { useRatePerMinute } from '@/hooks/useProof';
import { cn } from '@/lib/cn';
import { fmtInt, fmtMC, fmtUtcTime } from '@/lib/format';
import { useStore } from '@/store/useStore';
import { IconPause, IconPlay } from '../ui/Icons';
import { Badge, Button, Card, CardHeader } from '../ui/primitives';

export function StatusBadge({ status }: { status: Token['status'] }) {
  if (status === 'passed') return <Badge tone="positive">{fmtUsdK(SITE.targetMc)}+</Badge>;
  if (status === 'pending') return <Badge title={`Labelled at ${SITE.holderSampleHours}h`}>watching</Badge>;
  return <Badge tone="negative">stalled</Badge>;
}

/** The logo the token's team published (DexScreener or GeckoTerminal). Without one the slot stays an empty circle, never an invented icon. */
function TokenLogo({ src }: { src?: string }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) {
    return <span className="size-7 rounded-full border border-dashed border-border bg-surface-2" title="No logo published for this token" aria-hidden />;
  }
  return (
    <img
      src={src}
      alt=""
      width={28}
      height={28}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
      className="size-7 rounded-full bg-surface-2 object-cover ring-1 ring-border"
    />
  );
}

export function TokenRow({ t, compact = false }: { t: Token; compact?: boolean }) {
  return (
    <div
      className={cn(
        'grid items-center gap-3 px-4 py-2.5',
        compact ? 'grid-cols-[28px_minmax(0,1fr)_auto]' : 'grid-cols-[28px_minmax(0,1fr)_auto] sm:grid-cols-[28px_minmax(0,1fr)_64px_84px_84px]',
      )}
    >
      <TokenLogo key={t.logo ?? 'none'} src={t.logo} />
      <div className="min-w-0">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate text-sm font-medium text-fg">{t.name}</span>
          <a
            href={`https://dexscreener.com/${SITE.dexscreenerChain}/${t.mint}`}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 font-mono text-xs text-accent hover:underline"
            aria-label={`View $${t.symbol} on DexScreener`}
          >
            ${t.symbol}
          </a>
        </div>
        <div className="truncate text-xs text-muted">{t.loreWithheld ? 'lore withheld' : t.lore || 'no lore'}</div>
      </div>
      {!compact && (
        <div className="hidden text-right font-mono text-xs text-muted tabular-nums sm:block" title={t.holdersMissing ? 'holder count unavailable' : 'holders at 48h'}>
          {t.holdersMissing || t.status === 'pending' ? '—' : fmtInt(t.holders)}
        </div>
      )}
      <div className="text-right">
        <div className="font-mono text-sm text-fg tabular-nums">{fmtMC(t.peakMc)}</div>
        <div className={cn('font-mono text-[11px] text-subtle tabular-nums', !compact && 'hidden sm:block')}>{fmtUtcTime(t.launchedAt, t.hour)}</div>
        {!compact && (
          <div className="mt-0.5 sm:hidden">
            <StatusBadge status={t.status} />
          </div>
        )}
      </div>
      {!compact && (
        <div className="hidden text-right sm:block">
          <StatusBadge status={t.status} />
        </div>
      )}
    </div>
  );
}

export function FeedCard() {
  const feed = useStore((s) => s.feed);
  const counters = useStore((s) => s.counters);
  const [frozen, setFrozen] = useState<Token[] | null>(null);
  const paused = frozen !== null;
  const rows = frozen ?? feed.slice(0, SITE.feedCap);
  const rate = useRatePerMinute(counters.chain);

  return (
    <Card className="flex flex-col">
      <CardHeader
        title="Live ingest"
        description={`${fmtInt(counters.chain)} pulled · ${fmtInt(counters.dex)} priced · ${fmtInt(counters.rpc)} holder counts · ${rate.toFixed(0)}/min`}
        action={
          <Button size="sm" onClick={() => setFrozen(paused ? null : feed.slice(0, SITE.feedCap))} aria-pressed={paused}>
            {paused ? <IconPlay className="size-3" /> : <IconPause className="size-3" />}
            {paused ? 'Resume' : 'Pause'}
          </Button>
        }
      />
      <div className="hidden grid-cols-[28px_minmax(0,1fr)_64px_84px_84px] gap-3 border-b border-border px-4 py-2 text-xs text-subtle sm:grid">
        <span />
        <span>Token</span>
        <span className="text-right">Holders</span>
        <span className="text-right">Peak cap</span>
        <span className="text-right">Status</span>
      </div>
      <div className="scrollbar-thin max-h-[26rem] min-h-64 flex-1 divide-y divide-border overflow-y-auto" aria-live="polite" aria-label="Token feed">
        {rows.length === 0 && <p className="p-5 text-sm text-muted">Waiting for the first labelled token.</p>}
        {rows.map((t) => (
          <TokenRow key={t.mint} t={t} />
        ))}
      </div>
    </Card>
  );
}
