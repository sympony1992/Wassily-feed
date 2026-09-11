import { json, query } from '@/server/http';
import { getRuntime } from '@/server/runtime';
import { modelJson } from '@/server/serialize';

export const dynamic = 'force-dynamic';

export function GET(req: Request) {
  const { agent, config } = getRuntime();
  const perDay = Math.max(1, Math.round(86_400 / config.cycleSeconds));
  const runs = agent.runs.slice(-(query(req).num('days') ?? 30) * perDay);
  return json(
    runs.map((r) => {
      const m = modelJson(r, agent.bound);
      return { id: m.id, ran_at: m.ran_at, n_samples: m.n, n_positive: m.n_positive, auc_mean: m.auc, proven_floor: m.proven_floor, jar_level: m.jar_level, blocked_by: m.blocked_by };
    }),
  );
}
