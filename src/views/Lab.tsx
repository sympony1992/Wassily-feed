'use client';

import { useMemo } from 'react';
import { SimControls } from '@/components/analytics/SimControls';
import { FloorChart } from '@/components/lab/FloorChart';
import { AppShell } from '@/components/shell/AppShell';
import { Formula } from '@/components/ui/Formula';
import { Badge, Button, Card, CardHeader, Meter } from '@/components/ui/primitives';
import { SITE } from '@/config/site';
import { simInput, useSimProof } from '@/hooks/useProof';
import { cn } from '@/lib/cn';
import { fmtInt } from '@/lib/format';
import { BOUNDS, jarFraction } from '@/math/bounds';
import { useBound, usePersona, useStore } from '@/store/useStore';

export function LabView() {
  const persona = usePersona();
  const bound = useBound();
  const sim = useStore((s) => s.sim);
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
      description={`Same evidence, nine ways to decide how much of it to trust. ${persona.mascot}'s jar uses the ${bound.short} bound; the other eight are here to compare against it.`}
      meta={
        <Badge tone="accent">
          {persona.mascot} uses · {bound.short}
        </Badge>
      }
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
          <CardHeader title="All bounds, ranked by floor" description={`n = ${fmtInt(sim.n)} · AUC ${sim.auc.toFixed(3)} · δ = ${SITE.delta} · highlighted: ${persona.mascot}'s formula`} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="px-5 py-2.5 font-normal">Formula</th>
                  <th className="px-3 py-2.5 font-normal">Credit</th>
                  <th className="px-3 py-2.5 text-right font-normal">ε</th>
                  <th className="px-3 py-2.5 text-right font-normal">Floor</th>
                  <th className="px-5 py-2.5 font-normal">Jar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map(({ b, epsilon, floor, pending, jar }) => {
                  const active = b.id === bound.id;
                  return (
                    <tr key={b.id} className={cn(active && 'bg-accent-soft')}>
                      <td className="px-5 py-3">
                        <div className="font-medium text-fg">
                          {b.short}
                          {active && <span className="ml-2 text-xs font-normal text-accent">{persona.mascot}</span>}
                        </div>
                        <div className="text-xs text-muted">{b.name}</div>
                      </td>
                      <td className="px-3 py-3 text-xs text-muted">
                        {b.credit}
                        <div className="text-subtle">{b.year}</div>
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-xs text-muted tabular-nums">{pending ? '…' : epsilon >= 1 ? '—' : epsilon.toFixed(4)}</td>
                      <td className="px-3 py-3 text-right font-mono font-semibold text-fg tabular-nums">{pending ? '…' : floor.toFixed(4)}</td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <Meter value={pending ? 0 : jar} className="w-24" label={`${b.short} jar`} />
                          <span className="w-9 text-right font-mono text-xs text-muted tabular-nums">{pending ? '…' : `${(jar * 100).toFixed(0)}%`}</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
