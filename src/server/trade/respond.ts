import { json } from '../http';
import { TradeRefused, isTradeRefused } from './service';

/** A refusal answers with its own message and status; anything else is logged and answered generically. */
export function tradeError(err: unknown) {
  if (isTradeRefused(err)) return json({ error: err.message }, { status: err.status });
  console.error('[trade]', err);
  return json({ error: 'Something went wrong. Try again.' }, { status: 500 });
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    if (body && typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    // handled below
  }
  throw new TradeRefused('The request body must be a JSON object.');
}
