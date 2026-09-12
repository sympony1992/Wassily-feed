import { SITE } from '@/config/site';
import { fillTargetFor, useLiveProof, useSimProof } from '@/hooks/useProof';
import { cn } from '@/lib/cn';
import { fmtInt } from '@/lib/format';
import { useBound, usePersona, useStore } from '@/store/useStore';
import { GATE_NAMES, JarGlyph } from '../overview/JarCard';
import { Formula } from '../ui/Formula';
import { IconFastForward, IconReset, IconSync } from '../ui/Icons';
import { Badge, Button, Card, CardHeader } from '../ui/primitives';
import { SimControls } from './SimControls';

export function ProofPanel() {
  const persona = usePersona();
  const bound = useBound();
  const sim = useStore((s) => s.sim);
  const tally = useStore((s) => s.tally);
  const model = useStore((s) => s.model);
  const example = !model || model.n < 20; // no real labels yet: the sliders hold example values
  const syncSimWithModel = useStore((s) => s.syncSimWithModel);
  const applyPreset = useStore((s) => s.applyPreset);
  const proof = useSimProof(bound);
  const live = useLiveProof(); // the sliders know nothing of the gates; only the live model can say a launch was earned

  const ready = proof.jar >= 1 && !proof.pending; // the bound alone clears the target for these slider values
  const eps = proof.epsilon;
  const usesD = bound.uses.includes('d');
  const confidence = Math.round((1 - SITE.delta) * 100);

  return (
    <Card id="proof" className="scroll-mt-20">
      <CardHeader
        title="Proof & capacity"
        description={`${bound.name} · ${bound.credit.split(';')[0]}, ${bound.year.split(' ')[0]}`}
        action={
          example ? (
            <Badge>What-if · example values</Badge>
          ) : (
            <Badge tone={ready ? 'positive' : 'accent'}>{ready ? 'Floor clears target' : `Jar ${(proof.jar * 100).toFixed(1)}%`}</Badge>
          )
        }
      />
      {example && (
        <p className="border-b border-border px-5 py-2.5 text-xs text-pretty text-muted">
          No tokens are labelled yet, so these sliders start from example values to show how the bound behaves. The real jar is the one above.
        </p>
      )}

      <div className="grid grid-cols-1 divide-y divide-border lg:grid-cols-12 lg:divide-x lg:divide-y-0">
        <div className="space-y-5 p-5 lg:col-span-7">
          <div className="grid grid-cols-3 gap-3">
            <Readout label="Measured AUC" value={sim.auc.toFixed(3)} />
            <Readout label="Penalty ε" value={proof.pending ? '…' : eps >= 1 ? '—' : eps.toFixed(3)} />
            <Readout label="Proven floor" value={proof.pending ? '…' : proof.shownFloor.toFixed(3)} accent />
          </div>

          <SimControls bound={bound} />

          <p className={cn('rounded-lg border px-3 py-2.5 text-sm text-pretty', ready ? 'border-positive/40 bg-positive-soft text-fg' : 'border-border bg-surface-2 text-muted')} aria-live="polite">
            {proof.pending ? (
              <>Resampling {fmtInt(SITE.bootstrapResamples)} bootstrap draws…</>
            ) : ready ? (
              <>
                The floor is <b className="font-mono tabular-nums">{proof.floor.toFixed(3)}</b>, clear of {SITE.aucTarget.toFixed(3)}, so the bound alone fills this jar.{' '}
                {live?.unlocked
                  ? `${persona.mascot} has earned a launch.`
                  : live?.blockedBy
                    ? `The live jar also needs all four gates, and the ${GATE_NAMES[live.blockedBy]} gate still holds it at ${Math.round(SITE.gates.jarCapWhenBlocked * 100)}%.`
                    : 'The live jar also needs all four gates to pass.'}
              </>
            ) : (
              <>
                Measured <b className="font-mono text-fg tabular-nums">{sim.auc.toFixed(3)}</b>, ε removes{' '}
                <b className="font-mono text-fg tabular-nums">{eps >= 1 ? 'all of it' : eps.toFixed(3)}</b>, so the floor is <b className="font-mono text-fg tabular-nums">{proof.shownFloor.toFixed(3)}</b>.
              </>
            )}
          </p>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={syncSimWithModel}>
              <IconSync className="size-3.5" /> Sync live data ({fmtInt(tally.all)})
            </Button>
            <Button size="sm" variant="primary" onClick={() => applyPreset(fillTargetFor(bound, sim.posRate, SITE.presets.fillToTarget))}>
              <IconFastForward className="size-3.5" /> Fill to target
            </Button>
            <Button size="sm" variant="ghost" onClick={() => applyPreset(SITE.presets.resetDay1)}>
              <IconReset className="size-3.5" /> Reset to day 1
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-4 p-5 lg:col-span-5">
          <div className="flex items-start gap-5">
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-balance text-fg">Why the jar fills slowly</h3>
              <p className="mt-1 text-sm text-pretty text-muted">
                On a small sample, luck looks like skill. With n tokens {usesD ? 'and a model of capacity d' : 'and n₊ survivors'}, the true AUC sits at most ε below the measured one, with {confidence}%
                confidence.
              </p>
            </div>
            <JarGlyph fraction={proof.jar} className="h-28 w-16" />
          </div>
          <div className="overflow-x-auto rounded-lg border border-border bg-surface-2 px-3 py-3 text-fg">
            <Formula latex={bound.latex} />
          </div>
          <p className="text-sm text-pretty text-muted">{bound.summary}</p>
          <p className="text-sm text-pretty text-muted">
            The jar fills with <b className="font-medium text-fg">AUC − ε</b>, never the raw score. A strong model on a thin sample leaves it empty, by design.
          </p>
        </div>
      </div>
    </Card>
  );
}

function Readout({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2 px-3 py-2">
      <div className="text-xs leading-tight text-pretty text-muted">{label}</div>
      <div className={cn('mt-0.5 font-mono text-lg font-semibold tabular-nums', accent ? 'text-accent' : 'text-fg')}>{value}</div>
    </div>
  );
}
