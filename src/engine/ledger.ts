import type { Persona } from '@/config/personas';
import { SITE } from '@/config/site';
import type { BoundDef } from '@/math/bounds';
import { featurize } from './features';
import { generateCycle } from './ideas';
import { predictProba } from './model';
import { evaluateModel } from './proof';
import type { TrainResult } from './trainer';
import type { Candidate, EliminatedItem, ExclusionItem, IdeaCycle } from './types';

export interface LedgerSnapshot {
  nextCycleId: number;
  cycles: IdeaCycle[];
  eliminated: EliminatedItem[];
  exclusions: ExclusionItem[];
  stolen: string[];
}

/**
 * Idea cycles plus the two public records built from them: leaders that lost
 * rank 1, and ideas someone else deployed first. Shared by the browser engine
 * and the Node server so both behave identically.
 */
export class IdeaLedger {
  cycles: IdeaCycle[] = [];
  eliminated: EliminatedItem[] = [];
  exclusions: ExclusionItem[] = [];
  readonly stolen = new Set<string>();
  private nextCycleId: number;

  constructor(
    private readonly firstCycleId: number,
    private readonly keep = 48,
  ) {
    this.nextCycleId = firstCycleId;
  }

  get current(): IdeaCycle | null {
    return this.cycles[this.cycles.length - 1] ?? null;
  }

  reset() {
    this.cycles = [];
    this.eliminated = [];
    this.exclusions = [];
    this.stolen.clear();
    this.nextCycleId = this.firstCycleId;
  }

  publish(result: TrainResult, persona: Persona, bound: BoundDef, deployedNames: ReadonlySet<string>, at: Date): IdeaCycle {
    const proof = evaluateModel(result, bound);
    const cycle = generateCycle({
      cycleId: this.nextCycleId++,
      runId: result.runId,
      model: result.model,
      medianHolders: result.medianHolders,
      dow: (at.getUTCDay() + 6) % 7,
      names: persona.ideas.names,
      suffixes: persona.ideas.suffixes,
      lores: persona.ideas.lores,
      deployedNames,
      stolenNames: this.stolen,
      auc: result.auc,
      floor: proof.floor,
      n: SITE.candidatesPerCycle,
      now: at,
    });

    // The previous leader lost rank 1: keep the record of the revision.
    const prevCycle = this.current;
    const prev = prevCycle?.candidates[0];
    if (prevCycle && prev && cycle.candidates[0]?.name !== prev.name) {
      const again = cycle.candidates.find((c) => c.name === prev.name);
      const currentScore =
        again?.score ??
        predictProba(result.model, featurize({ name: prev.name, lore: prev.lore, loreMissing: false, hour: prev.hour, dow: cycle.dow, holders: cycle.medianHolders }));
      this.eliminated = [
        { name: prev.name, lore: prev.lore, ledCycle: prevCycle.cycleId, peakScore: prev.score, currentScore, currentRank: again?.rank ?? null, demotedCycle: cycle.cycleId },
        ...this.eliminated,
      ].slice(0, 50);
    }

    this.cycles.push(cycle);
    if (this.cycles.length > this.keep) this.cycles.shift();
    return cycle;
  }

  /** The earliest commitment of a name we wrote and have not yet recorded as taken. */
  findCommitted(name: string): { cycle: IdeaCycle; candidate: Candidate } | null {
    const key = name.toLowerCase();
    if (this.stolen.has(key)) return null;
    for (const cycle of this.cycles) {
      const candidate = cycle.candidates.find((c) => c.name.toLowerCase() === key);
      if (candidate) return { cycle, candidate };
    }
    return null;
  }

  recordTheft(cycle: IdeaCycle, candidate: Candidate, deployment: { mint: string; deployer: string; at: Date; blockNumber: number }): ExclusionItem {
    this.stolen.add(candidate.name.toLowerCase());
    const record: ExclusionItem = {
      name: candidate.name,
      firstCycle: cycle.cycleId,
      firstSeenAt: candidate.committedAt,
      deployedMint: deployment.mint,
      deployer: deployment.deployer,
      deployedAt: deployment.at.toISOString(),
      blockNumber: deployment.blockNumber,
      timeGapSeconds: Math.max(0, Math.round((deployment.at.getTime() - Date.parse(candidate.committedAt)) / 1000)),
    };
    this.exclusions = [record, ...this.exclusions].slice(0, 100);
    return record;
  }

  snapshot(): LedgerSnapshot {
    return { nextCycleId: this.nextCycleId, cycles: this.cycles, eliminated: this.eliminated, exclusions: this.exclusions, stolen: [...this.stolen] };
  }

  restore(s: LedgerSnapshot) {
    this.nextCycleId = s.nextCycleId;
    this.cycles = s.cycles;
    this.eliminated = s.eliminated;
    this.exclusions = s.exclusions;
    this.stolen.clear();
    s.stolen.forEach((n) => this.stolen.add(n));
  }
}
