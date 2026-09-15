// JSON shapes of the public API (snake_case, compatible with the original service).
import { SITE } from '@/config/site';
import { computeFindings } from '@/engine/findings';
import { evaluateModel } from '@/engine/proof';
import type { EliminatedItem, ExclusionItem, IdeaCycle, ModelRun, Token } from '@/engine/types';
import { confidenceLabel, vcEpsilon, type BoundDef } from '@/math/bounds';
import type { Runtime } from './runtime';
import { dexImageUrl } from './sources/dexImage';
import type { SignalRow } from './trade/service';

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

export const tokenJson = (t: Token, chain: string) => ({
  mint: t.mint,
  chain,
  name: t.name,
  symbol: t.symbol,
  lore: t.lore,
  lore_withheld: t.loreWithheld,
  logo: dexImageUrl(t.logo) ?? null, // older snapshots hold bare boost image ids

  creator: t.deployer || null,
  launched_at: t.launchedAt,
  launch_hour: t.hour,
  holders: t.holdersMissing ? null : t.holders,
  peak_mc: t.peakMc,
  status: t.status,
});

/** A watched token with its quick buy state; the score is the server's, from the real model. */
export const signalJson = (row: SignalRow, chain: string) => ({
  ...tokenJson(row.token, chain),
  score: row.signal.score == null ? null : r4(row.signal.score),
  state: row.signal.state,
  blocked_by: row.signal.blockedBy,
  gates: row.signal.gates,
  age_hours: Math.round(row.signal.ageHours * 10) / 10,
});

export function modelJson(run: ModelRun, bound: BoundDef) {
  const proof = evaluateModel(run, bound);
  return {
    id: run.runId,
    ran_at: run.ranAt,
    n: run.n,
    n_positive: run.nPositive,
    d: run.d,
    auc: r4(run.auc),
    auc_std: r4(run.aucStd),
    fold_aucs: run.foldAucs.map(r4),
    time_split_gap: r4(run.timeSplitGap),
    auc_boot_lower: r4(run.bootLower),
    epsilon_vc: r4(vcEpsilon(run.n, run.d, SITE.delta)),
    bound: bound.id,
    epsilon: r4(proof.epsilon),
    proven_floor: r4(proof.floor),
    jar_level: r4(proof.jar),
    gates: proof.gates,
    blocked_by: proof.blockedBy,
    confidence: proof.confidence,
    hour_rates: Object.fromEntries(run.hourRates.map((r, h) => [String(h), Math.round(r * 1000) / 1000])),
    hour_counts: run.hourCounts,
    feature_importance: Object.fromEntries(Object.entries(run.featureImportance).map(([k, v]) => [k, r4(v)])),
    median_holders: run.medianHolders,
  };
}

export function stateJson(rt: Runtime) {
  const { agent, config } = rt;
  const labelled = agent.labelled();
  const f = computeFindings(labelled);
  const tokens = [...agent.tokens.values()].sort((a, b) => Date.parse(b.launchedAt) - Date.parse(a.launchedAt)).slice(0, 400);
  return {
    source: config.source,
    chain: config.chain,
    persona: config.persona,
    bound: agent.bound.id,
    started_at: rt.startedAt,
    next_cycle_at: new Date(agent.nextCycleAt).toISOString(),
    cycle_number: agent.runs.length,
    counters: agent.counters(),
    warmup: agent.warmup(),
    backfill: rt.backfill(),
    findings: { hour_counts: f.hourAll, hour_wins: f.hourWin, baseline: r4(f.baseline), lift: f.lift, lore_corr: r4(f.loreCorr) },
    latest_model: agent.latest ? modelJson(agent.latest, agent.bound) : null,
    tokens: tokens.map((t) => tokenJson(t, config.chain)),
  };
}

/** A published cycle exactly as recorded: floor and scores are never recomputed with a newer model. */
export function cycleJson(cycle: IdeaCycle, generatorSha: string, persona: string) {
  return {
    persona,
    cycle_id: cycle.cycleId,
    run_id: cycle.runId,
    generator_sha: generatorSha,
    started_at: cycle.startedAt,
    seed: cycle.seed,
    median_holders: cycle.medianHolders,
    dow: cycle.dow,
    n_generated: cycle.nGenerated,
    n_rejected: cycle.nRejected,
    n_excluded: cycle.nExcluded,
    rule_hits: cycle.ruleHits,
    model: { auc: r4(cycle.model.auc), proven_floor: r4(cycle.model.floor), confidence: confidenceLabel(cycle.model.floor) },
    candidates: cycle.candidates.map((c) => ({
      rank: c.rank,
      name: c.name,
      lore: c.lore,
      hour: c.hour,
      score: Math.round(c.score * 1e6) / 1e6,
      commitment: c.commitment,
      committed_at: c.committedAt,
    })),
  };
}

export const eliminatedJson = (e: EliminatedItem) => ({
  name: e.name,
  lore: e.lore,
  led_cycle: e.ledCycle,
  peak_score: r4(e.peakScore),
  current_score: r4(e.currentScore),
  current_rank: e.currentRank,
  demoted_cycle: e.demotedCycle,
});

export const exclusionJson = (x: ExclusionItem) => ({
  name: x.name,
  first_cycle: x.firstCycle,
  first_seen_at: x.firstSeenAt,
  deployed_mint: x.deployedMint,
  deployer: x.deployer,
  deployed_at: x.deployedAt,
  block_number: x.blockNumber,
  time_gap_seconds: x.timeGapSeconds,
});
