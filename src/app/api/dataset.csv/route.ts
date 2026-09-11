import { datasetCsv } from '@/lib/download';
import { getRuntime } from '@/server/runtime';

export const dynamic = 'force-dynamic';

/** Every labelled token, BOM-prefixed so spreadsheets open it as UTF-8. */
export function GET() {
  return new Response(datasetCsv(getRuntime().agent.labelled()), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename=dataset.csv',
      'Cache-Control': 'no-store',
    },
  });
}
