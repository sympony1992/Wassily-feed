import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IdeaCycle } from '@/engine/types';
import type { AgentSnapshot } from './agent';

/** JSON snapshot for state, plus an append-only JSONL commitment log. */
export class Persistence {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  private get stateFile() {
    return join(this.dir, 'state.json');
  }

  private get logFile() {
    return join(this.dir, 'commitments.jsonl');
  }

  load(): Parameters<import('./agent').Agent['restore']>[0] | null {
    if (!existsSync(this.stateFile)) return null;
    try {
      const s = JSON.parse(readFileSync(this.stateFile, 'utf8'));
      return s.version === 1 || s.version === 2 ? s : null;
    } catch {
      return null;
    }
  }

  save(snapshot: AgentSnapshot) {
    const tmp = `${this.stateFile}.tmp`;
    writeFileSync(tmp, JSON.stringify(snapshot));
    renameSync(tmp, this.stateFile); // atomic replace: a crash never leaves half a file
  }

  /** Called synchronously when a cycle is generated, before any endpoint can serve it. */
  appendCycle(cycle: IdeaCycle, persona: string) {
    const lines = cycle.candidates.map((c) =>
      JSON.stringify({
        persona,
        cycle_id: cycle.cycleId,
        run_id: cycle.runId,
        rank: c.rank,
        name: c.name,
        lore: c.lore,
        hour: c.hour,
        commitment: c.commitment,
        committed_at: c.committedAt,
      }),
    );
    appendFileSync(this.logFile, `${lines.join('\n')}\n`);
  }

  readCommitments(persona: string, from?: number, to?: number): Record<string, unknown>[] {
    if (!existsSync(this.logFile)) return [];
    return readFileSync(this.logFile, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { cycle_id: number; persona?: string })
      .filter((r) => (r.persona ?? persona) === persona && (from == null || r.cycle_id >= from) && (to == null || r.cycle_id <= to));
  }
}
