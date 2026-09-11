import { isPersonaId } from '@/config/personas';
import { ideasCache, json, query } from '@/server/http';
import { getRuntime } from '@/server/runtime';
import { cycleJson } from '@/server/serialize';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { agent, generator } = getRuntime();
  const p = query(req).get('persona');
  const persona = isPersonaId(p) ? p : agent.persona;
  const cycle = agent.ledger(persona).cycles.find((c) => c.cycleId === Number(id));
  return cycle ? json(cycleJson(cycle, generator.sha, persona), { headers: ideasCache }) : json({ error: 'cycle not retained' }, { status: 404 });
}
