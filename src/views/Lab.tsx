'use client';

import { useMemo } from 'react';
import { SimControls } from '@/components/analytics/SimControls';
import { FloorChart } from '@/components/lab/FloorChart';
import { AppShell } from '@/components/shell/AppShell';
import { Formula } from '@/components/ui/Formula';
import { PersonaMark } from '@/components/ui/PersonaMark';
import { Badge, Button, Card, CardHeader, Meter } from '@/components/ui/primitives';
import { PERSONAS } from '@/config/personas';
import { SITE } from '@/config/site';
import { simInput, useSimProof } from '@/hooks/useProof';
import { cn } from '@/lib/cn';
import { fmtInt } from '@/lib/format';
import { BOUNDS, BOUND_BY_ID, jarFraction } from '@/math/bounds';
import { useBound, useStore } from '@/store/useStore';

export function LabView() {
  const bound = useBound();
  const sim = useStore((s) => s.sim);
  const personaId = useStore((s) => s.personaId);
  const boundId = useStore((s) => s.boundId);
  const setBound = useStore((s) => s.setBound);
  const setPersona = useStore((s) => s.setPersona);
  const syncSimWithModel = useStore((s) => s.syncSimWithModel);
  useSimProof(bound, true); // gives the bootstrap rows a value

  const rows = useMemo(() => {
    const input = simInput(sim);
    return BOUNDS.map((b) => {
      const r = b.compute(input);
      return { b, ...r, jar: jarFraction(r.floor, SITE.aucFloor, SITE.aucTarget) };
    }).sort((a, b) => (a.pending ? 1 : 0) - (b.pending ? 1 : 0) || b.floor - a.floor);
  }, [sim]);

  return (
    <AppShell
      title="Formula Lab"
      description="Same evidence, nine ways to decide how much of it to trust. Move the sliders, compare the floors, then pick the formula that fills the jar across the whole site."
      meta={<Badge tone="accent">Active · {bound.short}</Badge>}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[22rem_minmax(0,1fr)]">
          <Card>
            <CardHeader title="Evidence" description="Shared with the proof panel on Overview" />
            <div className="space-y-4 px-5 py-4">
              <SimControls bound={bound} showAll />
              <Button className="w-full" onClick={syncSimWithModel}>
                Use the live model's numbers
              </Button>
              <div className="overflow-x-auto rounded-lg border border-border bg-surface-2 px-3 py-3 text-fg">
                <Formula latex={bound.latex} />
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Proven floor vs tokens sampled"
              description={`AUC ${sim.auc.toFixed(3)} · d ${sim.d} · survivors ${(sim.posRate * 100).toFixed(1)}% · hover for values`}
            />
            <div className="px-3 py-4 sm:px-5">
              <FloorChart auc={sim.auc} d={sim.d} posRate={sim.posRate} currentN={sim.n} activeId={bound.id} />
            </div>
          </Card>
        </div>

        <Card className="overflow-hidden">
          <CardHeader title="All bounds, ranked by floor" description={`n = ${fmtInt(sim.n)} · AUC ${sim.auc.toFixed(3)} · δ = ${SITE.delta}`} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="px-5 py-2.5 font-normal">Formula</th>
                  <th className="px-3 py-2.5 font-normal">Credit</th>
                  <th className="px-3 py-2.5 text-right font-normal">ε</th>
                  <th className="px-3 py-2.5 text-right font-normal">Floor</th>
                  <th className="px-3 py-2.5 font-normal">Jar</th>
                  <th className="px-5 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map(({ b, epsilon, floor, pending, jar }) => {
                  const active = b.id === bound.id;
                  return (
                    <tr key={b.id} className={cn(active && 'bg-accent-soft')}>
                      <td className="px-5 py-3">
                        <div className="font-medium text-fg">{b.short}</div>
                        <div className="text-xs text-muted">{b.name}</div>
                      </td>
                      <td className="px-3 py-3 text-xs text-muted">
                        {b.credit}
                        <div className="text-subtle">{b.year}</div>
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-xs text-muted tabular-nums">{pending ? '…' : epsilon >= 1 ? '—' : epsilon.toFixed(4)}</td>
                      <td className="px-3 py-3 text-right font-mono font-semibold text-fg tabular-nums">{pending ? '…' : floor.toFixed(4)}</td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <Meter value={pending ? 0 : jar} className="w-24" label={`${b.short} jar`} />
                          <span className="w-9 text-right font-mono text-xs text-muted tabular-nums">{pending ? '…' : `${(jar * 100).toFixed(0)}%`}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <Button size="sm" variant={active ? 'secondary' : 'ghost'} onClick={() => setBound(b.id)} disabled={active && boundId === b.id}>
                          {active ? 'Active' : 'Use'}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <section className="pt-2">
          <h2 className="text-lg font-semibold text-balance text-fg">Personas</h2>
          <p className="mt-1 mb-4 max-w-3xl text-sm text-pretty text-muted">
            A persona renames the agent after a mathematician and changes its colour, story, chalkboard and the vocabulary of its ideas. It brings its own formula, which you can still override above.
          </p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {PERSONAS.map((p) => {
              const active = p.id === personaId;
              return (
                <Card key={p.id} className={cn('flex flex-col', active && 'border-accent')}>
                  <div className="flex items-center gap-3 px-5 pt-5">
                    <PersonaMark persona={p} className="size-11" />
                    <div className="min-w-0">
                      <h3 className="truncate font-semibold text-fg">
                        {p.mascot} <span className="font-mono text-xs text-muted">{p.ticker}</span>
                      </h3>
                      <p className="truncate text-xs text-muted">
                        {p.mathematician} · {p.life}
                      </p>
                    </div>
                  </div>
                  <p className="flex-1 px-5 pt-3 text-sm text-pretty text-muted">{p.origin.body}</p>
                  <div className="mt-4 flex items-center justify-between gap-3 border-t border-border px-5 py-3">
                    <span className="text-xs text-subtle">Formula: {BOUND_BY_ID[p.defaultBound].short}</span>
                    <Button
                      size="sm"
                      variant={active && boundId === null ? 'secondary' : 'primary'}
                      disabled={active && boundId === null}
                      onClick={() => {
                        setPersona(p.id);
                        setBound(null);
                      }}
                    >
                      {active && boundId === null ? 'Active' : 'Use persona'}
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
