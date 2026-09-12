'use client';

import { useState } from 'react';
import { TokenRow } from '@/components/overview/FeedCard';
import { PipelineCard } from '@/components/overview/PipelineCard';
import { AppShell } from '@/components/shell/AppShell';
import { Badge, Card, CardHeader, Stat } from '@/components/ui/primitives';
import { SITE, fmtUsdK } from '@/config/site';
import type { TypingBlock } from '@/hooks/useTyping';
import { cn } from '@/lib/cn';
import { fmtInt, fmtUptime, pad2 } from '@/lib/format';
import { useStore } from '@/store/useStore';

export function ConsoleView({ blocks }: { blocks: TypingBlock[] }) {
  const feed = useStore((s) => s.feed);
  const tally = useStore((s) => s.tally);
  const countdown = useStore((s) => s.countdown);
  const cycle = useStore((s) => s.cycle);
  const startedAt = useStore((s) => s.startedAt);
  const hourAll = useStore((s) => s.hourAll);
  const hourWin = useStore((s) => s.hourWin);
  const lift = useStore((s) => s.lift);
  const baseline = useStore((s) => s.baseline);
  const loreCorr = useStore((s) => s.loreCorr);
  const [hoverHour, setHoverHour] = useState<number | null>(null);

  const rates = hourAll.map((n, h) => (n ? hourWin[h] / n : 0));
  const eligible = rates.map((r, h) => ({ r, h })).filter(({ h }) => hourAll[h] >= 30);
  const best = eligible.length ? eligible.reduce((a, b) => (b.r > a.r ? b : a)) : null;
  const maxRate = Math.max(0.001, ...rates);
  const maxLift = Math.max(1, ...lift.map((l) => l.lift));
  const strength = Math.abs(loreCorr) < 0.03 ? 'barely' : Math.abs(loreCorr) < 0.15 ? 'weakly' : 'moderately';
  const direction = loreCorr >= 0 ? 'positively' : 'negatively';
  const cycleStr = String(cycle).padStart(3, '0');

  return (
    <AppShell
      title="Survival console"
      description={`Watching every new ${SITE.chain} token and learning which ones make it past ${fmtUsdK(SITE.targetMc)}.`}
      meta={
        <>
          <Badge className="font-mono">running {startedAt ? fmtUptime((Date.now() - Date.parse(startedAt)) / 1000) : '—'}</Badge>
          <Badge className="font-mono">next conclusion {countdown}s</Badge>
          <Badge tone="accent" className="font-mono">
            cycle {cycleStr}
          </Badge>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Seen" value={fmtInt(tally.all)} />
          <Stat label={`Past ${fmtUsdK(SITE.targetMc)}`} value={fmtInt(tally.pass)} tone="positive" />
          <Stat label="Stalled" value={fmtInt(tally.stall)} tone="negative" />
          <Stat label="Survival rate" value={tally.all ? `${((tally.pass / tally.all) * 100).toFixed(1)}%` : '—'} tone="accent" />
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Card className="flex flex-col">
            <CardHeader title="Ingest feed" description={`${SITE.chain} · on-chain launches`} />
            <div className="scrollbar-thin h-[22.5rem] divide-y divide-border overflow-y-auto" aria-label="Token feed">
              {feed.length === 0 && <p className="p-5 text-sm text-muted">Waiting for the first token.</p>}
              {feed.map((t) => (
                <TokenRow key={t.mint} t={t} compact />
              ))}
            </div>
          </Card>
          <PipelineCard blocks={blocks} title="Learning pipeline" description="Ingest, features, training, evaluation and conclusions" collapsible={false} />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader title="Survival by launch hour" description="UTC; the strongest hour with at least 30 tokens is highlighted" />
            <div className="px-5 pt-3 pb-4">
              <div className="mb-2 h-4 font-mono text-xs text-fg tabular-nums" aria-live="polite">
                {hoverHour != null ? `${pad2(hoverHour)}:00 · ${(rates[hoverHour] * 100).toFixed(1)}% of ${fmtInt(hourAll[hoverHour])}` : ''}
              </div>
              <div className="flex h-28 items-end gap-0.5 border-b border-border" onMouseLeave={() => setHoverHour(null)}>
                {rates.map((r, h) => (
                  <div key={h} className="flex h-full flex-1 items-end" onMouseEnter={() => setHoverHour(h)} title={`${pad2(h)}:00 — ${(r * 100).toFixed(1)}%`}>
                    <div
                      className={cn('w-full rounded-t-sm', hoverHour === h ? 'bg-fg' : best?.h === h ? 'bg-accent' : 'bg-border-strong')}
                      style={{ height: `${Math.max(4, (r / maxRate) * 100)}%` }}
                    />
                  </div>
                ))}
              </div>
              <div className="mt-1.5 flex justify-between font-mono text-xs text-muted tabular-nums">
                <span>00</span>
                <span>06</span>
                <span>12</span>
                <span>18</span>
                <span>23</span>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Words in surviving lore" description="Survival lift vs the baseline, words seen at least 60 times" />
            <ul className="space-y-2.5 px-5 py-4">
              {lift.length === 0 && <li className="text-sm text-muted">Not enough labelled lore yet.</li>}
              {lift.map((l) => (
                <li key={l.word} className="grid grid-cols-[6rem_1fr_auto] items-center gap-3 text-sm">
                  <span className="truncate text-fg">{l.word}</span>
                  <span className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                    <span className="block h-full w-full origin-left rounded-full bg-accent" style={{ transform: `scaleX(${l.lift / maxLift})` }} />
                  </span>
                  <span className="font-mono text-xs text-muted tabular-nums">
                    {l.lift.toFixed(1)}× · {fmtInt(l.n)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardHeader title="Read-out" description={`Cycle ${cycleStr} · ${fmtInt(tally.all)} labelled tokens`} />
            <p className="px-5 py-4 text-sm leading-relaxed text-pretty text-muted">
              {best ? (
                <>
                  The strongest window so far is{' '}
                  <b className="font-mono font-medium text-fg tabular-nums">
                    {pad2(best.h)}:00–{pad2((best.h + 1) % 24)}:00 UTC
                  </b>
                  , at <b className="font-mono font-medium text-positive tabular-nums">{(best.r * 100).toFixed(1)}%</b> survival against a{' '}
                  <b className="font-mono font-medium text-fg tabular-nums">{(baseline * 100).toFixed(1)}%</b> baseline.{' '}
                </>
              ) : (
                'No launch hour has 30 labelled tokens yet. '
              )}
              Lore length correlates {strength} {direction} with survival (r = <span className="font-mono tabular-nums">{loreCorr.toFixed(3)}</span>). Of{' '}
              <b className="font-mono font-medium text-fg tabular-nums">{fmtInt(tally.all)}</b> tokens, <b className="font-mono font-medium text-positive tabular-nums">{fmtInt(tally.pass)}</b> lived.
            </p>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
