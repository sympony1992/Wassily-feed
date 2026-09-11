import { SITE, fmtUsdK } from '@/config/site';
import { useLiveProof } from '@/hooks/useProof';
import { fmtInt } from '@/lib/format';
import { useBound, useStore } from '@/store/useStore';
import { Stat } from '../ui/primitives';

export function KpiStrip() {
  const bound = useBound();
  const tally = useStore((s) => s.tally);
  const medianHolders = useStore((s) => s.medianHolders);
  const model = useStore((s) => s.model);
  const warmup = useStore((s) => s.warmup);
  const proof = useLiveProof();
  const winRate = tally.all ? (tally.pass / tally.all) * 100 : 0;
  const enough = !!model && model.n >= 20; // below this the trainer has nothing to measure

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <Stat label="Jar level" tone="accent" value={proof ? `${(proof.jar * 100).toFixed(1)}%` : '—'} hint={proof?.unlocked ? 'launch unlocked' : `target AUC ${SITE.aucTarget.toFixed(2)}`} />
      <Stat
        label="ROC-AUC · 5-fold"
        value={model && enough ? model.auc.toFixed(3) : '—'}
        hint={model && enough ? `σ ${model.aucStd.toFixed(3)}` : warmup ? `warming up · ${fmtInt(warmup.labelled)}/${fmtInt(warmup.needed)} labelled` : 'connecting…'}
      />
      <Stat
        label="Proven floor"
        value={enough && proof && !proof.pending ? proof.floor.toFixed(3) : '—'}
        hint={enough && proof ? `${bound.short} · ε ${proof.epsilon >= 1 ? '1.000' : proof.epsilon.toFixed(3)}` : bound.short}
      />
      <Stat label={`Above ${fmtUsdK(SITE.entryMc)}`} value={fmtInt(tally.all)} hint="labelled tokens" />
      <Stat label={`Reached ${fmtUsdK(SITE.targetMc)}`} tone="positive" value={fmtInt(tally.pass)} hint={`${winRate.toFixed(1)}% · ${fmtInt(tally.stall)} stalled`} />
      <Stat label="Median holders" value={fmtInt(medianHolders)} hint={`sampled at ${SITE.holderSampleHours}h`} />
    </div>
  );
}
