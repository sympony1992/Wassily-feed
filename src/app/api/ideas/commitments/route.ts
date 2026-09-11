import { isPersonaId } from '@/config/personas';
import { ideasCache, json, query } from '@/server/http';
import { getRuntime } from '@/server/runtime';

export const dynamic = 'force-dynamic';

/** The append-only commitment log (from disk when persistence is on). */
export function GET(req: Request) {
  const { agent, store } = getRuntime();
  const q = query(req);
  const p = q.get('persona');
  const persona = isPersonaId(p) ? p : agent.persona;
  const from = q.num('from');
  const to = q.num('to');
  const rows = store
    ? store.readCommitments(persona, from, to)
    : agent
        .ledger(persona)
        .cycles.filter((c) => (from == null || c.cycleId >= from) && (to == null || c.cycleId <= to))
        .flatMap((c) =>
          c.candidates.map((x) => ({ persona, cycle_id: c.cycleId, run_id: c.runId, rank: x.rank, name: x.name, lore: x.lore, hour: x.hour, commitment: x.commitment, committed_at: x.committedAt })),
        );
  return json(rows, { headers: ideasCache });
}
