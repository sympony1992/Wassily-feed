import { json } from '@/server/http';
import { getRuntime } from '@/server/runtime';
import { readJson, tradeError } from '@/server/trade/respond';
import { TradeRefused } from '@/server/trade/service';

export const dynamic = 'force-dynamic';

/**
 * A priced route. Buy: { side: "buy", token, usd } for a token that is an active signal right now.
 * Sell: { side: "sell", token, amount } in raw token units; selling is never gated.
 */
export async function POST(req: Request) {
  try {
    const rt = getRuntime();
    const body = await readJson(req);
    const token = String(body.token ?? '');
    if (body.side === 'buy') {
      const { quote, ethUsd } = await rt.trade.quoteBuy(token, Number(body.usd));
      const s = quote.summary;
      return json({
        side: 'buy',
        route_summary: s,
        exchanges: quote.exchanges,
        amount_in_wei: s.amountIn,
        amount_in_usd: Number(s.amountInUsd),
        amount_out: s.amountOut,
        gas_usd: Number(s.gasUsd),
        eth_usd: ethUsd,
      });
    }
    if (body.side === 'sell') {
      let amount: bigint;
      try {
        amount = BigInt(String(body.amount ?? ''));
      } catch {
        throw new TradeRefused('The amount to sell must be a whole number of token units.');
      }
      const quote = await rt.trade.quoteSell(token, amount);
      if (!quote) return json({ side: 'sell', route: false, amount_out_wei: '0', amount_out_usd: 0 });
      const s = quote.summary;
      return json({ side: 'sell', route: true, route_summary: s, exchanges: quote.exchanges, amount_out_wei: s.amountOut, amount_out_usd: Number(s.amountOutUsd), gas_usd: Number(s.gasUsd) });
    }
    throw new TradeRefused('side must be "buy" or "sell".');
  } catch (err) {
    return tradeError(err);
  }
}
