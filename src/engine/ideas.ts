// ideas.ts — runs once per model retrain. This exact file is what the Brain
// page displays as the generator's live source; its sha is computed from it.
import { sha256Fields, sha256Hex } from '@/math/sha256';
import { pick, rngFromHex } from '@/math/stats';
import { featurize } from './features';
import { predictProba } from './model';
import type { Candidate, IdeaCycle, ScoringModel } from './types';

export const CONTENT_RULES = [
  { id: 'real_person', label: 'No real person’s name', pattern: /\b(elon|musk|trump|biden|vitalik|saylor|satoshi)\b/i },
  { id: 'financial_promise', label: 'No claims about returns, yield or price', pattern: /\b(guarantee[ds]?|profits?|returns?|yield|apy|\d+x|risk[- ]?free)\b/i },
  { id: 'ticker_impersonation', label: 'No impersonation of existing tickers', pattern: /\b(btc|eth|sol|pepe|doge|usdc|usdt)\b/i },
  { id: 'near_duplicate', label: 'No near-duplicates of deployed tokens', pattern: null },
] as const;

export interface CycleInput {
  cycleId: number;
  runId: number;
  model: ScoringModel;
  medianHolders: number;
  dow: number;
  names: readonly string[];
  suffixes: readonly string[];
  lores: readonly string[];
  deployedNames: ReadonlySet<string>; // every token name already on chain (casefolded)
  stolenNames: ReadonlySet<string>; // our own past ideas someone else deployed
  auc: number;
  floor: number;
  n?: number;
  now?: Date;
}

export function generateCycle(input: CycleInput): IdeaCycle {
  const { runId, model, medianHolders, dow, n = 100, now = new Date() } = input;

  // Anyone holding the model and the run id can replay this exact cycle.
  const seed = sha256Hex(String(runId));
  const rng = rngFromHex(seed);

  const seen = new Set<string>();
  const rejected = new Set<string>(); // count each rejected name once
  const ruleHits: Record<string, number> = {};
  const out: Omit<Candidate, 'rank'>[] = [];
  let nRejected = 0;
  let nExcluded = 0;

  for (let attempt = 0; out.length < n && attempt < n * 60; attempt++) {
    const name = pick(rng, input.names) + (rng() < 0.35 ? pick(rng, input.suffixes) : '');
    const lore = pick(rng, input.lores);
    const hour = Math.floor(rng() * 24);
    const key = name.toLowerCase();

    // 1. Reject before scoring, never after — the filter must not shape the ranking.
    const rule = CONTENT_RULES.find((r) =>
      r.pattern ? r.pattern.test(`${name} ${lore}`) : input.deployedNames.has(key) && !input.stolenNames.has(key),
    );
    if (rule) {
      if (!rejected.has(key)) {
        rejected.add(key);
        nRejected++;
        ruleHits[rule.id] = (ruleHits[rule.id] ?? 0) + 1;
      }
      continue;
    }

    // 2. Case-folded uniqueness within the cycle.
    if (seen.has(key)) continue;
    seen.add(key);

    // 3. Deployed by another address since we wrote it: ours no longer.
    if (input.stolenNames.has(key)) {
      nExcluded++;
      continue;
    }

    // 4. Holders pinned at the dataset median, so only name, lore and hour move the score.
    const x = featurize({ name, lore, loreMissing: false, hour, dow, holders: medianHolders });
    const score = predictProba(model, x);

    // 5. Commit before anything can display it. 0x1f separates the fields.
    const commitment = sha256Fields([name, lore, String(hour), String(runId)]);
    out.push({ name, lore, hour, score, commitment, committedAt: now.toISOString() });
  }

  out.sort((a, b) => b.score - a.score);

  return {
    cycleId: input.cycleId,
    runId,
    startedAt: now.toISOString(),
    seed,
    medianHolders,
    dow,
    nGenerated: out.length,
    nRejected,
    nExcluded,
    ruleHits,
    model: { auc: input.auc, floor: input.floor },
    candidates: out.map((c, i) => ({ ...c, rank: i + 1 })),
  };
}
