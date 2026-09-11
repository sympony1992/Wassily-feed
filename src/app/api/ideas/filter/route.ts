import { CONTENT_RULES } from '@/engine/ideas';
import { json, query } from '@/server/http';
import { getRuntime } from '@/server/runtime';

export const dynamic = 'force-dynamic';

export function GET(req: Request) {
  const current = getRuntime().agent.ledger(query(req).get('persona')).current;
  return json({
    active_rules: CONTENT_RULES.map((r) => r.label),
    rejection_summary: { total_rejected_last_cycle: current?.nRejected ?? 0, rule_hits: current?.ruleHits ?? {} },
  });
}
