import { SITE } from '@/config/site';
import { FEATURE_NAMES } from '@/engine/features';
import { CONTENT_RULES } from '@/engine/ideas';
import type { Token } from '@/engine/types';
import type { BoundDef } from '@/math/bounds';
import type { Persona } from '@/config/personas';

export function saveFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const href = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

const csvCell = (v: string | number | boolean) => {
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Every labelled token, BOM-prefixed so spreadsheets open it as UTF-8. */
export function datasetCsv(tokens: readonly Token[]): string {
  const header = ['mint', 'name', 'symbol', 'launched_at', 'launch_hour_utc', 'dow', `holders_${SITE.holderSampleHours}h`, 'lore_withheld', 'peak_mc', 'status', 'passed_label'];
  const lines = tokens
    .filter((t) => t.status !== 'pending')
    .map((t) =>
      // A holder count not known yet is left blank, never written as zero.
      [t.mint, t.name, t.symbol, t.launchedAt, t.hour, t.dow, t.holdersMissing ? '' : t.holders, t.loreWithheld, t.peakMc, t.status, t.status === 'passed' ? 1 : 0].map(csvCell).join(','),
    );
  return String.fromCharCode(0xfeff) + [header.join(','), ...lines].join('\r\n');
}

export function methodology(persona: Persona, bound: BoundDef) {
  return {
    agent: persona.mascot,
    universe: `Every token launched on ${SITE.chain}`,
    study_population: `Tokens with peak market cap >= $${SITE.entryMc.toLocaleString('en-US')}`,
    positive_label: `Peak market cap reached >= $${SITE.targetMc.toLocaleString('en-US')}`,
    negative_label: `Reached the entry line, did not reach the target, age >= ${SITE.labelHours} hours`,
    holder_count: `ERC-20 holders ${SITE.holderSampleHours}h after launch; a token whose count is not known yet is left out of training`,
    features: FEATURE_NAMES,
    capacity_d: FEATURE_NAMES.length,
    model: 'Class-balanced L2 logistic regression (IRLS), stratified k-fold CV',
    cv_folds: SITE.cvFolds,
    bootstrap_resamples: SITE.bootstrapResamples,
    bound: { id: bound.id, name: bound.name, credit: bound.credit, year: bound.year, latex: bound.latex },
    delta: SITE.delta,
    floor_auc: SITE.aucFloor,
    target_auc: SITE.aucTarget,
    jar_level: 'clamp((proven_floor - floor_auc) / (target_auc - floor_auc), 0, 1), capped while any gate fails',
    gates: {
      n_samples_min: SITE.gates.nSamplesMin,
      n_positive_min: SITE.gates.nPositiveMin,
      auc_std_max: SITE.gates.aucStdMax,
      time_split_gap_max: SITE.gates.timeSplitGapMax,
      jar_cap_when_blocked: SITE.gates.jarCapWhenBlocked,
    },
    ideas: {
      per_cycle: SITE.candidatesPerCycle,
      seed: 'sha256(run_id)',
      commitment: 'sha256(name 0x1f lore 0x1f hour 0x1f run_id)',
      content_rules: CONTENT_RULES.map((r) => r.label),
    },
  };
}
