import { json } from '@/server/http';
import { getRuntime } from '@/server/runtime';
import type { RouteSummary } from '@/server/trade/kyber';
import { readJson, tradeError } from '@/server/trade/respond';
import { TradeRefused } from '@/server/trade/service';

export const dynamic = 'force-dynamic';

/**
 * Unsigned swap calldata for the user's own wallet to sign: { side, token, route_summary, sender, slippage_bps }.
 * The server holds no key and sends nothing; it only checks the swap matches the trade it claims to be.
 */
export async function POST(req: Request) {
  try {
    const rt = getRuntime();
    const body = await readJson(req);
    if (body.side !== 'buy' && body.side !== 'sell') throw new TradeRefused('side must be "buy" or "sell".');
    if (!body.route_summary || typeof body.route_summary !== 'object') throw new TradeRefused('route_summary is missing: ask for a quote first.');
    const swap = await rt.trade.build(body.side, String(body.token ?? ''), body.route_summary as RouteSummary, String(body.sender ?? ''), Number(body.slippage_bps));
    return json({ to: swap.to, data: swap.data, value: swap.value, amount_out: swap.amountOut });
  } catch (err) {
    return tradeError(err);
  }
}
