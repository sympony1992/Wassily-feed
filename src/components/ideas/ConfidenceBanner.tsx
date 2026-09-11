import { fmtSigned } from '@/lib/format';
import type { ConfidenceLabel } from '@/math/bounds';
import { cn } from '@/lib/cn';
import { IconWarning } from '../ui/Icons';
import { Badge } from '../ui/primitives';

const TONE: Record<ConfidenceLabel, 'negative' | 'accent' | 'positive'> = {
  none: 'negative',
  weak: 'negative',
  provisional: 'accent',
  qualified: 'positive',
};

export function ConfidenceBanner(props: { auc: number | null; floor: number | null; label: ConfidenceLabel; boundName: string; mascot: string; topScore: number | null }) {
  const tone = TONE[props.label];
  return (
    <div
      className={cn(
        'flex gap-3 rounded-xl border px-4 py-3',
        tone === 'negative' ? 'border-negative/30 bg-negative-soft' : tone === 'positive' ? 'border-positive/30 bg-positive-soft' : 'border-accent/30 bg-accent-soft',
      )}
      role="note"
    >
      <IconWarning className="mt-0.5 size-4 text-fg" />
      <div className="min-w-0 text-sm text-pretty text-fg">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <b className="font-semibold">Read every score with this attached.</b>
          <Badge tone={tone}>Confidence: {props.label}</Badge>
        </div>
        <p className="text-muted">
          The model behind these scores measures AUC <b className="font-mono text-fg tabular-nums">{props.auc?.toFixed(4) ?? '—'}</b>, and its proven floor under the {props.boundName} is{' '}
          <b className="font-mono text-fg tabular-nums">{props.floor != null ? fmtSigned(props.floor) : '—'}</b>. A score of {props.topScore?.toFixed(2) ?? '0.80'} does not mean a token will survive, only
          that the model ranks it above the rest. Until the floor rises, this is {props.mascot} arguing with the data in public.
        </p>
      </div>
    </div>
  );
}
