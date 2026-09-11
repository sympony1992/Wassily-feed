import { ideasCache, json, query } from '@/server/http';
import { getRuntime } from '@/server/runtime';
import { exclusionJson } from '@/server/serialize';

export const dynamic = 'force-dynamic';

/** The theft record: committed names someone else deployed first. */
export function GET(req: Request) {
  const ledger = getRuntime().agent.ledger(query(req).get('persona'));
  return json(ledger.exclusions.map(exclusionJson), { headers: ideasCache });
}
