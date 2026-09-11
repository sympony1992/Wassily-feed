import { SITE } from '@/config/site';
import { CONTENT_RULES } from '@/engine/ideas';
import { useLiveProof } from '@/hooks/useProof';
import { confidenceLabel } from '@/math/bounds';
import { useBound, usePersona, useStore } from '@/store/useStore';
import { Stat } from '../ui/primitives';
import { CandidatesList } from './CandidatesList';
import { ConfidenceBanner } from './ConfidenceBanner';
import { LiveSource } from './LiveSource';
import { RevisedAndExclusions } from './RevisedAndExclusions';
import { ScoreHistogram } from './ScoreHistogram';

export function IdeasSection() {
  const persona = usePersona();
  const bound = useBound();
  const ideas = useStore((s) => s.ideas);
  const model = useStore((s) => s.model);
  const training = useStore((s) => s.training);
  const countdown = useStore((s) => s.countdown);
  const proof = useLiveProof();

  const cycle = ideas.current;
  const candidates = cycle?.candidates ?? [];
  // The live model judged by the bound the visitor picked.
  const auc = model?.auc ?? null;
  const floor = proof && !proof.pending ? proof.floor : null;
  const rulesTitle = CONTENT_RULES.map((r) => `${r.label}: ${cycle?.ruleHits[r.id] ?? 0}`).join('\n');

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Cycle" value={cycle?.cycleId ?? '—'} hint={`run_id ${cycle?.runId ?? '—'}`} />
        <Stat label="Generated" value={`${cycle?.nGenerated ?? 0}/${SITE.candidatesPerCycle}`} hint="all published" />
        <Stat label="Rejected by filter" value={cycle?.nRejected ?? 0} hint={<span title={rulesTitle}>before scoring</span>} />
        <Stat label="Excluded (taken)" value={cycle?.nExcluded ?? 0} hint="deployed by others" />
        <Stat label="Leader" tone="accent" value={<span className="font-sans text-base">{candidates[0]?.name ?? '—'}</span>} hint={candidates[0] ? `score ${candidates[0].score.toFixed(4)}` : undefined} />
        <Stat label="Next cycle" value={training ? '…' : `${countdown}s`} hint={training ? 'scoring new model' : 'generating'} />
      </div>

      {ideas.error && ideas.updatedAt && (
        <p className="rounded-lg border border-negative/30 bg-negative-soft px-3 py-2 text-sm text-negative">
          Latest fetch failed; showing the last good cycle from {new Date(ideas.updatedAt).toUTCString()}.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <LiveSource />
        <CandidatesList candidates={candidates} cycleId={cycle?.cycleId ?? null} runId={cycle?.runId ?? null} />
      </div>

      <ConfidenceBanner auc={auc} floor={floor} label={floor == null ? 'none' : confidenceLabel(floor)} boundName={bound.name} mascot={persona.mascot} topScore={candidates[0]?.score ?? null} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <RevisedAndExclusions eliminated={ideas.eliminated} exclusions={ideas.exclusions} />
        <ScoreHistogram candidates={candidates} />
      </div>

      <p className="max-w-3xl text-sm text-pretty text-muted">
        Every candidate is committed as <code className="font-mono text-fg">sha256(name ␟ lore ␟ hour ␟ run_id)</code> before it is shown, and the RNG is seeded with{' '}
        <code className="font-mono text-fg">sha256(run_id)</code>, so any cycle can be replayed. That log is our record of what {persona.mascot} wrote and when: a name that was never committed cannot be
        launched, and if a stranger deploys one first, the timestamps settle priority.
      </p>
    </div>
  );
}
