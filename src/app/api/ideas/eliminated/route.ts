import { ideasCache, json, query } from '@/server/http';
import { getRuntime } from '@/server/runtime';
import { eliminatedJson } from '@/server/serialize';

export const dynamic = 'force-dynamic';

/** Candidates that held rank 1 and lost it. */
export function GET(req: Request) {
  const q = query(req);
  const ledger = getRuntime().agent.ledger(q.get('persona'));
  return json(ledger.eliminated.slice(0, Math.min(100, q.num('limit') ?? 50)).map(eliminatedJson), { headers: ideasCache });
}
