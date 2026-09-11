import { json } from '@/server/http';
import { getRuntime } from '@/server/runtime';

export const dynamic = 'force-dynamic';

export function GET() {
  const rt = getRuntime();
  return json({
    ok: true,
    source: rt.config.source,
    chain: rt.config.chain,
    started_at: rt.startedAt,
    tokens: rt.agent.tokens.size,
    runs: rt.agent.runs.length,
    next_cycle_at: new Date(rt.agent.nextCycleAt).toISOString(),
    warmup: rt.agent.warmup(),
    ingest: rt.ingestStats(),
  });
}
