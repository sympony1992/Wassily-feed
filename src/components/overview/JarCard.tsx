import { useEffect, useState } from 'react';
import { SITE } from '@/config/site';
import { useLiveProof } from '@/hooks/useProof';
import { cn } from '@/lib/cn';
import { fmtInt } from '@/lib/format';
import { useBound, usePersona, useStore } from '@/store/useStore';
import { IconArrowRight } from '../ui/Icons';
import { Badge, Card, CardHeader, Meter } from '../ui/primitives';

const GATE_NAMES: Record<string, string> = { n_samples: 'sample size', n_positive: 'survivor count', auc_std: 'fold variance', time_split: 'time split' };

export function JarGlyph({ fraction, className }: { fraction: number; className?: string }) {
  const v = Math.max(0, Math.min(1, fraction));
  return (
    <div className={cn('relative h-40 w-24 shrink-0', className)} role="img" aria-label={`Jar ${Math.round(v * 100)}% full`}>
      <div className="absolute inset-x-4 top-0 h-3 rounded-sm bg-border-strong" />
      <div className="absolute inset-x-0 top-4 bottom-0 overflow-hidden rounded-t-md rounded-b-2xl border-2 border-border-strong bg-surface-2">
        <div className="absolute inset-x-0 top-[10%] bottom-0">
          <div className="size-full origin-bottom bg-accent transition-transform duration-200 ease-out" style={{ transform: `scaleY(${v})` }} />
        </div>
        <div className="absolute inset-x-0 top-[10%] border-t border-dashed border-positive" aria-hidden />
      </div>
    </div>
  );
}

/** A 0.40–0.70 AUC ruler with the coin-flip line, the target, the floor and the measured score. */
function FloorScale({ floor, auc }: { floor: number | null; auc: number | null }) {
  const lo = 0.4;
  const hi = 0.7;
  const pos = (v: number) => `${((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * 100}%`;
  return (
    <div className="pt-5 pb-6" aria-hidden>
      <div className="relative h-1.5 rounded-full bg-surface-2">
        <div className="absolute inset-y-0 rounded-full bg-accent-soft" style={{ left: pos(SITE.aucFloor), right: `calc(100% - ${pos(SITE.aucTarget)})` }} />
        {[SITE.aucFloor, SITE.aucTarget].map((v) => (
          <div key={v} className="absolute -top-1.5 h-4.5 w-px bg-border-strong" style={{ left: pos(v) }}>
            <span className="absolute top-5 -translate-x-1/2 font-mono text-[11px] text-subtle tabular-nums">{v.toFixed(2)}</span>
          </div>
        ))}
        {auc != null && <div className="absolute top-1/2 size-2.5 -translate-1/2 rounded-full border-2 border-surface bg-muted" style={{ left: pos(auc) }} title={`measured ${auc.toFixed(3)}`} />}
        {floor != null && <div className="absolute top-1/2 size-3.5 -translate-1/2 rounded-full border-2 border-surface bg-accent" style={{ left: pos(floor) }} title={`floor ${floor.toFixed(3)}`} />}
      </div>
    </div>
  );
}

function fmtDuration(ms: number) {
  if (ms <= 0) return 'any minute now';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h ? `in ${h}h ${m}m` : `in ${m}m`;
}

/** Shown until enough real tokens are labelled for the model to measure anything. */
function WarmingUp() {
  const warmup = useStore((s) => s.warmup);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  if (!warmup) return null;
  const share = warmup.labelled / warmup.needed;

  return (
    <div className="mt-4 space-y-3 rounded-lg border border-border bg-surface-2 p-3">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium text-fg">Warming up</span>
        <span className="font-mono text-xs text-muted tabular-nums">
          {fmtInt(warmup.labelled)} / {fmtInt(warmup.needed)} labelled
        </span>
      </div>
      <Meter value={share} label="Labelled tokens towards the sample-size gate" />
      <dl className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <dt className="text-muted">Being watched</dt>
          <dd className="mt-0.5 font-mono text-sm text-fg tabular-nums">{fmtInt(warmup.pending)}</dd>
        </div>
        <div>
          <dt className="text-muted">Next label</dt>
          <dd className="mt-0.5 text-sm text-fg">{warmup.nextLabelAt ? fmtDuration(Date.parse(warmup.nextLabelAt) - now) : 'waiting for launches'}</dd>
        </div>
      </dl>
    </div>
  );
}

export function JarCard() {
  const persona = usePersona();
  const bound = useBound();
  const model = useStore((s) => s.model);
  const proof = useLiveProof();
  const jar = proof?.jar ?? 0;
  const enough = !!model && model.n >= 20; // below this the trainer has nothing to measure

  const status = !proof
    ? { tone: 'neutral' as const, text: 'Connecting' }
    : !enough
      ? { tone: 'accent' as const, text: 'Warming up' }
      : proof.unlocked
        ? { tone: 'positive' as const, text: 'Launch unlocked' }
        : proof.blockedBy
          ? { tone: 'negative' as const, text: `Blocked · ${GATE_NAMES[proof.blockedBy]}` }
          : { tone: 'accent' as const, text: 'Learning' };

  const unit = persona.unit[0].toUpperCase() + persona.unit.slice(1);

  return (
    <Card className="flex flex-col">
      <CardHeader title="The jar" description={`Filled by the ${bound.name}`} action={<Badge tone={status.tone}>{status.text}</Badge>} />
      <div className="flex flex-1 flex-col gap-6 px-5 py-5 sm:flex-row sm:items-center">
        <JarGlyph fraction={jar} className="self-center" />
        <div className="min-w-0 flex-1">
          <div className="font-mono text-5xl font-semibold text-fg tabular-nums">
            {(jar * 100).toFixed(1)}
            <span className="text-2xl text-muted">%</span>
          </div>
          <p className="mt-1 text-sm text-pretty text-muted">
            {enough
              ? `${unit} drops in only when the proven floor clears AUC ${SITE.aucTarget.toFixed(2)}.`
              : `The jar stays empty until real tokens are labelled, ${SITE.holderSampleHours}h after launch. No numbers are shown before they exist.`}
          </p>

          {enough ? (
            <>
              <FloorScale floor={proof && !proof.pending ? proof.floor : null} auc={model ? model.auc : null} />
              <dl className="grid grid-cols-3 gap-3 text-xs">
                <div>
                  <dt className="text-muted">Measured</dt>
                  <dd className="mt-0.5 font-mono text-sm text-fg tabular-nums">{model ? model.auc.toFixed(3) : '—'}</dd>
                </div>
                <div>
                  <dt className="text-muted">Penalty ε</dt>
                  <dd className="mt-0.5 font-mono text-sm text-fg tabular-nums">{proof ? (proof.epsilon >= 1 ? '—' : proof.epsilon.toFixed(3)) : '—'}</dd>
                </div>
                <div>
                  <dt className="text-muted">Floor</dt>
                  <dd className="mt-0.5 font-mono text-sm text-accent tabular-nums">{proof && !proof.pending ? proof.floor.toFixed(3) : '—'}</dd>
                </div>
              </dl>
            </>
          ) : (
            <WarmingUp />
          )}

          <a href="#proof" className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
            Explore the proof <IconArrowRight className="size-3.5" />
          </a>
        </div>
      </div>
    </Card>
  );
}
