import { useState } from 'react';
import type { Candidate } from '@/engine/types';
import { cn } from '@/lib/cn';
import { pad2 } from '@/lib/format';
import { sha256Fields } from '@/math/sha256';
import { Badge, Card, CardHeader } from '../ui/primitives';

export function CandidatesList({ candidates, cycleId, runId }: { candidates: Candidate[]; cycleId: number | null; runId: number | null }) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <Card className="flex h-[32rem] flex-col">
      <CardHeader title={`All ${candidates.length || 100} candidates`} description="Ranked by model score; click a hash to verify it" action={<Badge className="font-mono">cycle {cycleId ?? '—'}</Badge>} />
      <ol className="scrollbar-thin flex-1 divide-y divide-border overflow-y-auto">
        {candidates.length === 0 && <li className="p-5 text-sm text-muted">No cycle yet. The first model is still training.</li>}
        {candidates.map((c) => {
          const lead = c.rank === 1;
          const expanded = open === c.commitment;
          const verified = expanded && runId != null ? sha256Fields([c.name, c.lore, String(c.hour), String(runId)]) === c.commitment : null;
          return (
            <li key={c.commitment} className={cn('grid grid-cols-[2.75rem_minmax(0,1fr)_auto] items-start gap-3 px-4 py-3', lead && 'border-l-2 border-l-accent bg-accent-soft')}>
              <span className="pt-0.5 font-mono text-xs text-subtle tabular-nums">#{String(c.rank).padStart(3, '0')}</span>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-fg">{c.name}</div>
                <div className="mt-0.5 text-xs text-pretty text-muted">{c.lore}</div>
                <button
                  type="button"
                  onClick={() => setOpen(expanded ? null : c.commitment)}
                  aria-expanded={expanded}
                  className="mt-1 block cursor-pointer text-left font-mono text-[11px] break-all text-subtle hover:text-fg"
                >
                  {expanded ? c.commitment : `${c.commitment.slice(0, 16)}…`}
                </button>
                {expanded && verified !== null && (
                  <div className={cn('mt-1 text-xs', verified ? 'text-positive' : 'text-negative')}>
                    {verified ? 'Recomputed in your browser: sha256(name ␟ lore ␟ hour ␟ run_id) matches.' : 'Commitment does not match its fields.'}
                  </div>
                )}
              </div>
              <div className="text-right">
                <div className="font-mono text-sm font-semibold text-fg tabular-nums">{c.score.toFixed(4)}</div>
                <div className="font-mono text-[11px] text-subtle tabular-nums">{pad2(c.hour)}:00 UTC</div>
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
