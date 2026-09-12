'use client';

import { useMemo, useState } from 'react';
import { StatusBadge } from '@/components/overview/FeedCard';
import { AppShell } from '@/components/shell/AppShell';
import { IconBot, IconCheck, IconClose } from '@/components/ui/Icons';
import { Badge, Button, Card, CardHeader, SectionLabel, StatusDot } from '@/components/ui/primitives';
import { BOT_DRAFT } from '@/config/bot';
import { SITE, fmtUsdK } from '@/config/site';
import { planTrade, type BotCheckKey, type BotDecision, type BotPlan } from '@/engine/botPlan';
import type { GateKey, ProofView } from '@/engine/proof';
import type { Token } from '@/engine/types';
import { useLiveProof } from '@/hooks/useProof';
import { cn } from '@/lib/cn';
import { fmtInt, fmtMC, fmtUtcTime } from '@/lib/format';
import { usePersona, useStore } from '@/store/useStore';

type Row = { t: Token; plan: BotPlan };

const LIST_CAP = 100;
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const pct = (v: number) => `${Math.round(v * 100)}%`;

const STEPS = [
  { title: 'Watch', body: `Pick up a token from the live ingest once its cap clears ${fmtUsdK(BOT_DRAFT.entryMc)}.` },
  { title: 'Score', body: `Run the latest model on it for the chance it reaches ${fmtUsdK(BOT_DRAFT.takeProfitMc)}.` },
  { title: 'Safety lock', body: `Trade only while the jar reads 100%: all four validation gates pass and the proven floor is at least ${SITE.aucTarget.toFixed(2)}.` },
  {
    title: 'Size',
    body: `Stake $${BOT_DRAFT.minStakeUsd}–$${BOT_DRAFT.maxStakeUsd}, more the further the score clears ${BOT_DRAFT.minScore.toFixed(2)}, with at most ${BOT_DRAFT.maxOpenPositions} positions open.`,
  },
  {
    title: 'Exit',
    body: `Sell at a ${fmtUsdK(BOT_DRAFT.takeProfitMc)} cap, a ${pct(BOT_DRAFT.stopLossPct)} drop from entry, or ${BOT_DRAFT.maxHoldHours}h after launch, whichever comes first.`,
  },
];

const RULES: [string, string][] = [
  ['Entry', `cap ≥ ${fmtUsdK(BOT_DRAFT.entryMc)}`],
  ['Minimum score', BOT_DRAFT.minScore.toFixed(2)],
  ['Stake per trade', `$${BOT_DRAFT.minStakeUsd}–$${BOT_DRAFT.maxStakeUsd}`],
  ['Open positions', `≤ ${BOT_DRAFT.maxOpenPositions}`],
  ['Daily loss cap', `$${BOT_DRAFT.dailyLossCapUsd}`],
  ['Take profit', `cap ${fmtUsdK(BOT_DRAFT.takeProfitMc)}`],
  ['Stop loss', `−${pct(BOT_DRAFT.stopLossPct)} · cap ${fmtUsdK(BOT_DRAFT.entryMc * (1 - BOT_DRAFT.stopLossPct))}`],
  ['Time stop', `${BOT_DRAFT.maxHoldHours}h after launch`],
];

const GATE_NAMES: Record<GateKey, string> = {
  n_samples: 'sample size',
  n_positive: 'survivors',
  auc_std: 'fold σ',
  time_split: 'time-split gap',
};

const DECISION: Record<BotDecision, { label: string; tone: 'positive' | 'accent' | 'neutral'; note: string }> = {
  enter: { label: 'would enter', tone: 'positive', note: 'Every rule passes. In the finished bot this is where an order would go out.' },
  blocked: { label: 'locked', tone: 'accent', note: 'The token qualifies, but the safety lock stays closed until the jar reads 100%.' },
  skip: { label: 'skip', tone: 'neutral', note: 'At least one token rule fails, so the bot would leave this one alone.' },
  warming: { label: 'no model yet', tone: 'neutral', note: 'The model has not learned from enough labelled tokens to score anything.' },
};

const QUESTIONS = [
  {
    title: 'Holders at entry',
    body: `The model learns from the holder count ${SITE.holderSampleHours}h after launch. A bot buying at ${fmtUsdK(BOT_DRAFT.entryMc)} before then cannot see it yet, so it needs a model trained only on what is known at entry.`,
  },
  { title: 'Where orders go', body: `Which ${SITE.chain} router executes, and how slippage and thin liquidity are checked before a buy.` },
  { title: 'Wallet and custody', body: 'A dedicated wallet with a hard balance cap, keys kept off the web server, and a kill switch.' },
  { title: 'Paper trading first', body: 'Log would-be fills against real prices for several weeks and publish the results before any real money is used.' },
];

function hoursLeft(iso: string | null) {
  if (!iso) return null;
  return Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 3_600_000));
}

function Fact({ term, value }: { term: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{term}</dt>
      <dd className="truncate font-mono text-sm text-fg tabular-nums">{value}</dd>
    </div>
  );
}

function AnalysisCard({ row, proof }: { row: Row | null; proof: ProofView | null }) {
  if (!row) {
    return (
      <Card>
        <CardHeader title="Analysis" description="How the draft rules judge one token" />
        <p className="p-5 text-sm text-muted">Pick a token to see how the bot would judge it.</p>
      </Card>
    );
  }

  const { t, plan } = row;
  const d = DECISION[plan.decision];
  const left = hoursLeft(plan.timeStopAt);
  const words = t.lore.toLowerCase().match(/[a-z0-9']+/g)?.length ?? 0;
  const checks: { key: BotCheckKey; label: string; value: string }[] = [
    { key: 'entry', label: `Peak cap cleared ${fmtUsdK(BOT_DRAFT.entryMc)}`, value: fmtMC(t.peakMc) },
    { key: 'window', label: `Inside the ${BOT_DRAFT.maxHoldHours}h window`, value: t.status !== 'pending' ? 'already labelled' : left == null ? 'open' : `${left}h left` },
    { key: 'score', label: `Score ≥ ${BOT_DRAFT.minScore.toFixed(2)}`, value: plan.score == null ? '—' : plan.score.toFixed(4) },
    { key: 'lock', label: 'Safety lock open', value: proof ? `jar ${pct(proof.jar)}` : '—' },
  ];

  return (
    <Card>
      <CardHeader
        title={`Analysis · ${t.name}`}
        description={
          <>
            <span className="font-mono">${t.symbol}</span> · launched {DOW[t.dow] ?? ''} {fmtUtcTime(t.launchedAt, t.hour)}
          </>
        }
        action={<StatusBadge status={t.status} />}
      />
      <div className="space-y-4 px-5 py-4">
        <div className="rounded-lg border border-border bg-surface-2 px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={d.tone}>{d.label}</Badge>
            <span className="text-xs text-subtle">dry run · no order</span>
          </div>
          <p className="mt-1 text-sm text-pretty text-muted">{d.note}</p>
        </div>

        <div>
          <SectionLabel>Rules</SectionLabel>
          <ul className="mt-1.5 divide-y divide-border rounded-lg border border-border">
            {checks.map((c) => {
              const ok = plan.checks[c.key];
              return (
                <li key={c.key} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="flex min-w-0 items-center gap-2 text-sm text-fg">
                    {ok === null ? (
                      <span className="w-3.5 shrink-0 text-center text-subtle" aria-label="not judged yet">
                        –
                      </span>
                    ) : ok ? (
                      <IconCheck className="size-3.5 text-positive" />
                    ) : (
                      <IconClose className="size-3.5 text-negative" />
                    )}
                    <span className="truncate">{c.label}</span>
                  </span>
                  <span className="shrink-0 font-mono text-xs text-muted tabular-nums">{c.value}</span>
                </li>
              );
            })}
          </ul>
        </div>

        <div>
          <SectionLabel>What the score saw</SectionLabel>
          <dl className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-2">
            <Fact term="Launch hour" value={fmtUtcTime(t.launchedAt, t.hour)} />
            <Fact term="Weekday" value={DOW[t.dow] ?? '—'} />
            <Fact term="Lore" value={t.loreWithheld ? 'withheld' : t.lore ? `${words} words` : 'none'} />
            <Fact term="Holders used" value={plan.holdersUsed == null ? '—' : `${fmtInt(plan.holdersUsed)} (median)`} />
          </dl>
          <p className="mt-2 text-xs text-pretty text-subtle">
            Scored in your browser from the published model, with the median holder count standing in for the {SITE.holderSampleHours}h reading a bot may not have yet. The
            server can see lore this page cannot, so its own score may differ slightly.
          </p>
        </div>

        <div>
          <SectionLabel>Trade plan</SectionLabel>
          {plan.stakeUsd == null ? (
            <p className="mt-1.5 text-sm text-pretty text-muted">No position. The plan appears once the token passes its own rules.</p>
          ) : (
            <dl className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-2">
              <Fact term="Stake" value={`$${plan.stakeUsd}`} />
              <Fact term="Take profit" value={`cap ${fmtUsdK(plan.takeProfitMc)}`} />
              <Fact term="Stop loss" value={`cap ${fmtUsdK(plan.stopLossMc)}`} />
              <Fact term="Time stop" value={left == null ? `${BOT_DRAFT.maxHoldHours}h` : `in ${left}h`} />
            </dl>
          )}
        </div>

        <a
          href={`https://dexscreener.com/${SITE.dexscreenerChain}/${t.mint}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block text-sm font-medium text-accent hover:underline"
        >
          View ${t.symbol} on DexScreener
        </a>
      </div>
    </Card>
  );
}

export function BotView() {
  const persona = usePersona();
  const feed = useStore((s) => s.feed);
  const model = useStore((s) => s.model);
  const proof = useLiveProof();
  const [filter, setFilter] = useState<'watching' | 'all'>('watching');
  const [selected, setSelected] = useState<string | null>(null);

  const all = useMemo<Row[]>(() => feed.map((t) => ({ t, plan: planTrade(t, model, proof) })), [feed, model, proof]);
  const watching = useMemo(() => all.filter((r) => r.t.status === 'pending'), [all]);
  const rows = (filter === 'watching' ? watching : all).slice(0, LIST_CAP);
  const active = rows.find((r) => r.t.mint === selected) ?? rows[0] ?? null;
  const wouldEnter = watching.filter((r) => r.plan.decision === 'enter').length;
  const locked = watching.filter((r) => r.plan.decision === 'blocked').length;
  const warming = !model || model.n < 20;

  return (
    <AppShell
      title="Trade Bot"
      description={`Draft rules for a bot that trades the tokens ${persona.mascot} scores, and a dry run of them on the current feed. Nothing here trades yet.`}
      meta={<Badge tone="accent">Coming soon</Badge>}
    >
      <div className="space-y-4">
        <div role="note" className="flex items-start gap-3 rounded-xl border border-dashed border-accent bg-accent-soft px-4 py-3">
          <IconBot className="mt-0.5 size-5 text-accent" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-fg">
              Coming soon
              <Badge tone="accent">blueprint</Badge>
            </div>
            <p className="mt-0.5 text-sm text-pretty text-muted">
              This page is the plan for the bot, not the bot. It connects no wallet, signs nothing and places no orders. The decisions below are a dry run of the draft rules on
              tokens {persona.mascot} is already watching.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          <Card className="xl:col-span-7">
            <CardHeader title="How a trade would flow" description="Five steps from a new token to a closed position" action={<Badge>draft</Badge>} />
            <ol className="divide-y divide-border">
              {STEPS.map((s, i) => (
                <li key={s.title} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-3 px-5 py-3">
                  <span className="flex size-7 items-center justify-center rounded-full border border-border font-mono text-xs text-muted tabular-nums">{i + 1}</span>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-fg">{s.title}</div>
                    <p className="mt-0.5 text-xs text-pretty text-muted">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>

          <Card className="flex flex-col xl:col-span-5">
            <CardHeader title="Draft rules" description="Placeholder values, open to change before launch" action={<Badge>draft</Badge>} />
            <dl className="divide-y divide-border">
              {RULES.map(([term, value]) => (
                <div key={term} className="flex items-center justify-between gap-3 px-5 py-2">
                  <dt className="text-sm text-muted">{term}</dt>
                  <dd className="font-mono text-xs text-fg tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-auto space-y-3 border-t border-border px-5 py-4">
              <div className="flex items-center gap-2 text-sm text-fg">
                <StatusDot tone={proof?.unlocked ? 'positive' : 'neutral'} />
                <span className="min-w-0 text-pretty">
                  Safety lock {proof?.unlocked ? 'open' : 'closed'}
                  <span className="text-muted">
                    {warming ? ' · model warming up' : proof ? ` · jar ${pct(proof.jar)}${proof.blockedBy ? `, blocked by ${GATE_NAMES[proof.blockedBy]}` : ''}` : ''}
                  </span>
                </span>
              </div>
              <Button variant="primary" className="w-full" disabled title="Coming soon">
                Start bot · coming soon
              </Button>
            </div>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          <Card className="flex flex-col xl:col-span-7">
            <CardHeader
              title="Dry run on the feed"
              description={`${fmtInt(watching.length)} watched · ${wouldEnter} would enter · ${locked} held by the lock · click a token for its analysis`}
              action={
                <span className="flex items-center gap-1">
                  <Button size="sm" variant={filter === 'watching' ? 'secondary' : 'ghost'} aria-pressed={filter === 'watching'} onClick={() => setFilter('watching')}>
                    Watching
                  </Button>
                  <Button size="sm" variant={filter === 'all' ? 'secondary' : 'ghost'} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
                    All
                  </Button>
                </span>
              }
            />
            <div className="hidden grid-cols-[minmax(0,1fr)_4.5rem_6.5rem] gap-3 border-b border-border px-4 py-2 text-xs text-subtle sm:grid">
              <span>Token</span>
              <span className="text-right">Score</span>
              <span className="text-right">Decision</span>
            </div>
            <ul className="scrollbar-thin max-h-[30rem] min-h-64 flex-1 divide-y divide-border overflow-y-auto" aria-label="Dry-run decisions">
              {rows.length === 0 && (
                <li className="p-5 text-sm text-muted">{filter === 'watching' ? 'No token is inside its watch window right now.' : 'Waiting for the first token.'}</li>
              )}
              {rows.map(({ t, plan }) => {
                const isActive = active?.t.mint === t.mint;
                const d = DECISION[plan.decision];
                return (
                  <li key={t.mint}>
                    <button
                      type="button"
                      onClick={() => setSelected(t.mint)}
                      aria-pressed={isActive}
                      className={cn(
                        'grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 text-left transition-colors duration-150 hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent sm:grid-cols-[minmax(0,1fr)_4.5rem_6.5rem]',
                        isActive && 'bg-surface-2',
                      )}
                    >
                      <span className="min-w-0">
                        <span className="flex min-w-0 items-baseline gap-1.5">
                          <span className="truncate text-sm font-medium text-fg">{t.name}</span>
                          <span className="shrink-0 font-mono text-xs text-accent">${t.symbol}</span>
                        </span>
                        <span className="block truncate font-mono text-[11px] text-subtle tabular-nums">
                          {fmtMC(t.peakMc)} · {fmtUtcTime(t.launchedAt, t.hour)}
                        </span>
                      </span>
                      <span className="hidden text-right font-mono text-xs text-muted tabular-nums sm:block">{plan.score == null ? '—' : plan.score.toFixed(3)}</span>
                      <span className="text-right">
                        <Badge tone={d.tone}>{d.label}</Badge>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>

          <div className="xl:col-span-5">
            <AnalysisCard row={active} proof={proof} />
          </div>
        </div>

        <Card className="overflow-hidden">
          <CardHeader title="Before it ships" description="Open questions the finished bot has to answer" action={<Badge tone="accent">Coming soon</Badge>} />
          <ul className="grid grid-cols-1 gap-px bg-border sm:grid-cols-2 xl:grid-cols-4">
            {QUESTIONS.map((q) => (
              <li key={q.title} className="bg-surface px-5 py-4">
                <div className="text-sm font-medium text-fg">{q.title}</div>
                <p className="mt-1 text-xs text-pretty text-muted">{q.body}</p>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </AppShell>
  );
}
