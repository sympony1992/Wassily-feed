import { json } from '@/server/http';
import { getRuntime } from '@/server/runtime';
import { stateJson } from '@/server/serialize';

export const dynamic = 'force-dynamic';

/** Counters, warm-up progress, Console findings, the latest model and the 400 newest tokens. */
export function GET() {
  return json(stateJson(getRuntime()));
}
