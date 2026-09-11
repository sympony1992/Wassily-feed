import { json } from '@/server/http';
import { getRuntime } from '@/server/runtime';

export const dynamic = 'force-dynamic';

/** The source of the generator that is actually running, with its sha. */
export function GET() {
  const { generator } = getRuntime();
  return json({ generator_sha: generator.sha, filename: 'src/engine/ideas.ts', source: generator.source });
}
