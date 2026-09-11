import { useState } from 'react';
import type { Candidate } from '@/engine/types';
import { cn } from '@/lib/cn';
import { Badge, Card, CardHeader } from '../ui/primitives';

const BINS = 28;

export function ScoreHistogram({ candidates }: { candidates: Candidate[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const bins = new Array(BINS).fill(0);
  candidates.forEach((c) => bins[Math.min(BINS - 1, Math.max(0, Math.floor(c.score * BINS)))]++);
  const max = Math.max(1, ...bins);
  const range = (i: number) => `${(i / BINS).toFixed(2)}–${((i + 1) / BINS).toFixed(2)}`;

  return (
    <Card className="flex h-80 flex-col">
      <CardHeader title="Score distribution" description="Watch the shape, not the leader" action={<Badge className="font-mono">n = {candidates.length}</Badge>} />
      <div className="flex flex-1 flex-col justify-end px-5 pt-3 pb-4">
        <div className="mb-2 h-4 font-mono text-xs text-fg tabular-nums" aria-live="polite">
          {hover != null ? `${range(hover)} · ${bins[hover]} candidate${bins[hover] === 1 ? '' : 's'}` : ''}
        </div>
        <div className="relative flex h-32 items-end gap-0.5" onMouseLeave={() => setHover(null)}>
          <div className="pointer-events-none absolute inset-y-0 left-1/2 border-l border-dashed border-border-strong" aria-hidden />
          <span className="pointer-events-none absolute top-0 left-1/2 ml-1.5 text-[11px] text-subtle">no opinion</span>
          {bins.map((v, i) => (
            <div key={i} className="flex h-full flex-1 items-end" onMouseEnter={() => setHover(i)} title={`${range(i)}: ${v}`}>
              <div
                className={cn('w-full rounded-t-sm', hover === i ? 'bg-fg' : v ? 'bg-accent' : 'bg-border')}
                style={{ height: v ? `${Math.max(4, (v / max) * 100)}%` : '2px' }}
              />
            </div>
          ))}
        </div>
        <div className="mt-2 flex justify-between border-t border-border pt-2 font-mono text-xs text-muted tabular-nums">
          <span>0.00</span>
          <span>0.50</span>
          <span>1.00</span>
        </div>
        <p className="mt-3 text-xs text-pretty text-muted">An uninformed model piles every idea near 0.50. As it learns, the spread widens and the right tail grows.</p>
      </div>
    </Card>
  );
}
