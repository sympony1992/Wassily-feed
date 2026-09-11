import { useMemo } from 'react';
import { SITE, fmtUsdK } from '@/config/site';
import { FEATURE_GROUPS } from '@/engine/features';
import type { GateKey } from '@/engine/proof';
import { useLiveProof } from '@/hooks/useProof';
import { fmtInt } from '@/lib/format';
import { useStore } from '@/store/useStore';
import { IconCheck, IconClose } from '../ui/Icons';
import { Badge, Card, CardHeader, Meter } from '../ui/primitives';

const GATES: { key: GateKey; label: string }[] = [
  { key: 'n_samples', label: `Sample size ≥ ${fmtInt(SITE.gates.nSamplesMin)}` },
  { key: 'n_positive', label: `Survivors ≥ ${fmtInt(SITE.gates.nPositiveMin)}` },
  { key: 'auc_std', label: `Fold σ < ${SITE.gates.aucStdMax}` },
  { key: 'time_split', label: `Time-split gap ≤ ${SITE.gates.timeSplitGapMax}` },
];

export function GatesCard() {
  const model = useStore((s) => s.model);
  const proof = useLiveProof();
  const enough = !!model && model.n >= 20; // no gate is meaningful before real labels exist
  const passed = proof && enough ? GATES.filter((g) => proof.gates[g.key]).length : 0;

  const value = (k: GateKey) => {
    if (!model || !enough) return '—';
    if (k === 'n_samples') return fmtInt(model.n);
    if (k === 'n_positive') return fmtInt(model.nPositive);
    if (k === 'auc_std') return model.aucStd.toFixed(4);
    return model.source === 'api' && model.gatesOverride ? (proof?.gates.time_split ? 'ok' : '—') : model.timeSplitGap.toFixed(4);
  };

  return (
    <Card>
      <CardHeader
        title="Validation gates"
        description={`The jar is capped at ${SITE.gates.jarCapWhenBlocked * 100}% until all four pass`}
        action={<Badge tone={passed === 4 ? 'positive' : 'neutral'}>{passed}/4</Badge>}
      />
      <ul className="divide-y divide-border">
        {GATES.map((g) => {
          const ok = proof?.gates[g.key] ?? false;
          const blocking = proof?.blockedBy === g.key;
          return (
            <li key={g.key} className="flex items-center justify-between gap-3 px-5 py-2.5">
              <span className="text-sm text-fg">{g.label}</span>
              <span className="flex items-center gap-2">
                <span className="font-mono text-xs text-muted tabular-nums">{value(g.key)}</span>
                {!proof || !enough ? (
                  <Badge>waiting</Badge>
                ) : ok ? (
                  <Badge tone="positive">
                    <IconCheck className="size-3" /> pass
                  </Badge>
                ) : (
                  <Badge tone={blocking ? 'negative' : 'neutral'}>
                    <IconClose className="size-3" /> {blocking ? 'blocking' : 'fail'}
                  </Badge>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export function WeightsCard() {
  const model = useStore((s) => s.model);
  const features = useMemo(() => {
    if (!model || model.n < 20) return [];
    const groups = FEATURE_GROUPS.map((g) => ({
      key: g.key,
      label: g.label,
      value: Object.entries(model.featureImportance)
        .filter(([name]) => g.match(name))
        .reduce((s, [, v]) => s + v, 0),
    }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
    const total = groups.reduce((s, g) => s + g.value, 0) || 1;
    return groups.map((g) => ({ ...g, share: g.value / total }));
  }, [model]);

  return (
    <Card>
      <CardHeader title="What the model leans on" description={`Top feature families by coefficient weight, reached ${fmtUsdK(SITE.targetMc)} vs stalled`} />
      <div className="space-y-3 px-5 py-4">
        {features.length === 0 && <p className="text-sm text-pretty text-muted">Weights appear once real tokens are labelled and the model has something to learn from.</p>}
        {features.map((f) => (
          <div key={f.key}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate text-fg">{f.label}</span>
              <span className="font-mono text-xs text-muted tabular-nums">{(f.share * 100).toFixed(1)}%</span>
            </div>
            <Meter value={f.share} label={f.label} />
          </div>
        ))}
      </div>
    </Card>
  );
}
