import { EventEmitter } from 'node:events';
import { PERSONAS, PERSONA_BY_ID, isPersonaId, type PersonaId } from '@/config/personas';
import { SITE } from '@/config/site';
import { IdeaLedger, type LedgerSnapshot } from '@/engine/ledger';
import { toTrainingRow } from '@/engine/simulator';
import { trainRun, type TrainResult } from '@/engine/trainer';
import type { ModelRun, Token } from '@/engine/types';
import { BOUND_BY_ID, type BoundId } from '@/math/bounds';
import { median } from '@/math/stats';

export interface AgentSnapshot {
  version: 2;
  runId: number;
  tokens: Token[];
  runs: ModelRun[];
  ledgers: Partial<Record<PersonaId, LedgerSnapshot>>;
}

/** Snapshots written before idea cycles were kept per persona. */
interface LegacySnapshot {
  version: 1;
  runId: number;
  tokens: Token[];
  runs: ModelRun[];
  ledger: LedgerSnapshot;
}

const TRAIN = { folds: SITE.cvFolds, resamples: SITE.bootstrapResamples, seed: 20_260_911 };

/**
 * Server-side agent: owns the token set, retrains every cycle, publishes an
 * idea cycle for every persona, and records thefts.
 * Events: token, model, cycle (cycle, personaId), exclusion (record, personaId).
 */
export class Agent extends EventEmitter {
  readonly tokens = new Map<string, Token>(); // key: lowercased address
  runs: ModelRun[] = [];
  readonly ledgers = Object.fromEntries(PERSONAS.map((p) => [p.id, new IdeaLedger(SITE.firstCycleId)])) as Record<PersonaId, IdeaLedger>;
  nextCycleAt = 0;
  private runId: number = SITE.firstRunId;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    readonly persona: PersonaId,
    readonly boundId: BoundId | null,
    readonly cycleSeconds: number,
  ) {
    super();
    this.setMaxListeners(1000); // one listener per open stream
  }

  get personaDef() {
    return PERSONA_BY_ID[this.persona];
  }

  get bound() {
    return BOUND_BY_ID[this.boundId ?? this.personaDef.defaultBound];
  }

  get latest(): ModelRun | null {
    return this.runs[this.runs.length - 1] ?? null;
  }

  ledger(persona?: string | null): IdeaLedger {
    return this.ledgers[isPersonaId(persona) ? persona : this.persona];
  }

  upsert(token: Token, announce = true): boolean {
    const key = token.mint.toLowerCase();
    const isNew = !this.tokens.has(key);
    this.tokens.set(key, token);
    if (isNew) {
      // Someone deployed a name we committed earlier: that is the theft record.
      for (const p of PERSONAS) {
        const hit = this.ledgers[p.id].findCommitted(token.name);
        if (hit && Date.parse(token.launchedAt) > Date.parse(hit.candidate.committedAt)) {
          const record = this.ledgers[p.id].recordTheft(hit.cycle, hit.candidate, {
            mint: token.mint,
            deployer: token.deployer || 'unknown',
            at: new Date(token.launchedAt),
            blockNumber: 0,
          });
          this.emit('exclusion', record, p.id);
        }
      }
    }
    if (announce) this.emit('token', token);
    return isNew;
  }

  remove(mint: string) {
    this.tokens.delete(mint.toLowerCase());
  }

  /** Study population: labelled tokens that cleared the entry line, oldest first. */
  labelled(): Token[] {
    return [...this.tokens.values()]
      .filter((t) => t.status !== 'pending' && t.peakMc >= SITE.entryMc)
      .sort((a, b) => Date.parse(a.launchedAt) - Date.parse(b.launchedAt));
  }

  counters() {
    const labelled = this.labelled();
    const passed = labelled.filter((t) => t.status === 'passed').length;
    const known = labelled.filter((t) => !t.holdersMissing).map((t) => t.holders);
    return {
      above_10k: labelled.length,
      passed_30k: passed,
      stalled: labelled.length - passed,
      pending: [...this.tokens.values()].filter((t) => t.status === 'pending').length,
      median_holders: known.length ? median(known) : null,
    };
  }

  /** Progress towards a model worth reading, for the "warming up" state. */
  warmup() {
    const pending = [...this.tokens.values()].filter((t) => t.status === 'pending');
    const oldest = pending.reduce((min, t) => Math.min(min, Date.parse(t.launchedAt)), Infinity);
    return {
      labelled: this.labelled().length,
      needed: SITE.gates.nSamplesMin,
      pending: pending.length,
      next_label_at: Number.isFinite(oldest) ? new Date(oldest + SITE.holderSampleHours * 3_600_000).toISOString() : null,
    };
  }

  /** Training rows; unknown holder counts are imputed with the known median. */
  private rows(limit?: number) {
    const all = this.labelled();
    const slice = limit == null ? all : all.slice(0, limit);
    const med = median(slice.filter((t) => !t.holdersMissing).map((t) => t.holders)) || 288;
    return slice.map((t) => toTrainingRow(t.holdersMissing ? { ...t, holders: med } : t));
  }

  runCycle(at = new Date()): ModelRun {
    const result = trainRun(this.rows(), ++this.runId, TRAIN);
    const run: ModelRun = { ...result, ranAt: at.toISOString(), source: 'api' };
    this.runs.push(run);
    if (this.runs.length > 24 * 30) this.runs.shift();
    this.publish(result, at);
    this.emit('model', run);
    return run;
  }

  /** Older cycles on older slices of the data, so the revision record starts with history. */
  replayPrior(count: number, now = Date.now()) {
    const n = this.labelled().length;
    for (let i = count; i >= 1; i--) {
      const result = trainRun(this.rows(Math.max(0, n - i * 25)), ++this.runId, { ...TRAIN, quick: true });
      this.publish(result, new Date(now - i * this.cycleSeconds * 1000));
    }
  }

  private publish(result: TrainResult, at: Date) {
    const deployed = new Set([...this.tokens.values()].map((t) => t.name.toLowerCase()));
    for (const p of PERSONAS) {
      const bound = BOUND_BY_ID[this.boundId ?? p.defaultBound];
      const cycle = this.ledgers[p.id].publish(result, p, bound, deployed, at);
      this.emit('cycle', cycle, p.id); // listeners append the commitment log before anything is served
    }
  }

  start() {
    if (this.timer) return;
    // A saved model older than one cycle (after restarts, say) is refreshed now, not a full cycle from now.
    if (!this.latest || Date.now() - Date.parse(this.latest.ranAt) >= this.cycleSeconds * 1000) this.runCycle();
    this.nextCycleAt = Date.now() + this.cycleSeconds * 1000;
    this.timer = setInterval(() => {
      this.runCycle();
      this.nextCycleAt = Date.now() + this.cycleSeconds * 1000;
    }, this.cycleSeconds * 1000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  snapshot(): AgentSnapshot {
    return {
      version: 2,
      runId: this.runId,
      tokens: [...this.tokens.values()],
      runs: this.runs,
      ledgers: Object.fromEntries(PERSONAS.map((p) => [p.id, this.ledgers[p.id].snapshot()])),
    };
  }

  restore(s: AgentSnapshot | LegacySnapshot) {
    this.runId = s.runId;
    this.tokens.clear();
    s.tokens.forEach((t) => this.tokens.set(t.mint.toLowerCase(), t));
    this.runs = s.runs;
    if (s.version === 2) {
      for (const p of PERSONAS) {
        const ledger = s.ledgers[p.id];
        if (ledger) this.ledgers[p.id].restore(ledger);
      }
    } else {
      this.ledgers[this.persona].restore(s.ledger);
    }
  }
}
