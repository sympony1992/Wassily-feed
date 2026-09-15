import { json } from '@/server/http';
import { getRuntime } from '@/server/runtime';
import { signalJson } from '@/server/serialize';

export const dynamic = 'force-dynamic';

const SCORED_CONTEXT = 60; // watched tokens that fail a gate but have a score, shown for context

/** Watched tokens with their quick buy state and the server's score: active first, then locked by the jar, then scored tokens that fail a gate. */
export function GET() {
  const rt = getRuntime();
  const rows = rt.trade.signals();
  const count = (state: string) => rows.filter((r) => r.signal.state === state).length;
  const shown = [...rows.filter((r) => r.signal.state !== 'none'), ...rows.filter((r) => r.signal.state === 'none' && r.signal.score != null).slice(0, SCORED_CONTEXT)];
  const reason = rt.trade.disabledReason();
  return json({
    quick_buy: { enabled: !reason, reason, jar_unlocked: rt.trade.jarUnlocked() },
    counts: { watching: rows.length, active: count('active'), locked: count('disabled'), scored: rows.filter((r) => r.signal.score != null).length },
    signals: shown.slice(0, 200).map((r) => signalJson(r, rt.config.chain)),
  });
}
