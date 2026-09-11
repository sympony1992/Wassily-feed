import { ideasCache, json, query } from '@/server/http';
import { getRuntime } from '@/server/runtime';
import { cycleJson } from '@/server/serialize';
import { isPersonaId } from '@/config/personas';

export const dynamic = 'force-dynamic';

/** The latest 100 candidates for ?persona= (defaults to the server persona). */
export function GET(req: Request) {
  const { agent, generator } = getRuntime();
  const p = query(req).get('persona');
  const persona = isPersonaId(p) ? p : agent.persona;
  const cycle = agent.ledger(persona).current;
  return cycle ? json(cycleJson(cycle, generator.sha, persona), { headers: ideasCache }) : json({ error: 'no cycle yet' }, { status: 404 });
}
