import { describe, expect, it } from 'vitest';
import { KYBER_ROUTER, KyberClient, NATIVE_ETH, type RouteSummary } from './kyber';

const TOKEN = '0x1e4fa91778bb6d38feca1663888ad8951b9a92ee';
const SENDER = '0x000000000000000000000000000000000000beef';
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
const summary = (over: Partial<RouteSummary> = {}): RouteSummary => ({
  tokenIn: NATIVE_ETH,
  amountIn: '10000000000000000',
  amountInUsd: '24.7',
  tokenOut: TOKEN,
  amountOut: '765758980387409168957440',
  amountOutUsd: '0',
  gas: '418831',
  gasUsd: '0.07',
  route: [[{ pool: '0x153e8e14835536da5bcfd9bf8ee184a3af0b4149', exchange: 'pons-v2', tokenIn: NATIVE_ETH, tokenOut: TOKEN }]],
  checksum: 'abc',
  ...over,
});

function client(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return handler(String(input), init);
  }) as typeof fetch;
  return { calls, kyber: new KyberClient({ api: 'https://kyber.test', chain: 'robinhood', clientId: 'wassily', fetchImpl, now: () => 1_789_000_000_000 }) };
}

describe('KyberClient', () => {
  it('quotes a route, names its exchanges and sends the client id', async () => {
    const { kyber, calls } = client(() => json({ code: 0, data: { routeSummary: summary(), routerAddress: '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5' } }));
    const quote = await kyber.quote(NATIVE_ETH, TOKEN, 10n ** 16n);
    expect(quote?.exchanges).toEqual(['pons-v2']);
    expect(calls[0].url).toBe(`https://kyber.test/robinhood/api/v1/routes?tokenIn=${NATIVE_ETH}&tokenOut=${TOKEN}&amountIn=10000000000000000`);
    expect((calls[0].init?.headers as Record<string, string>)['x-client-id']).toBe('wassily');
  });

  it('returns no route for a token KyberSwap does not know, but throws when the service fails', async () => {
    expect(await client(() => json({ code: 4011, message: 'token not found' }, 400)).kyber.quote(NATIVE_ETH, TOKEN, 1n)).toBeNull();
    await expect(client(() => json({ message: 'slow down' }, 429)).kyber.quote(NATIVE_ETH, TOKEN, 1n)).rejects.toThrow('rate limited');
    await expect(
      client(() => {
        throw new Error('socket hang up');
      }).kyber.quote(NATIVE_ETH, TOKEN, 1n),
    ).rejects.toThrow('unavailable');
    await expect(client(() => json({ code: 5000, message: 'internal' })).kyber.quote(NATIVE_ETH, TOKEN, 1n)).rejects.toThrow('5000');
  });

  it('refuses routes and swaps aimed at any contract but the KyberSwap router', async () => {
    const evil = '0x000000000000000000000000000000000000dead';
    await expect(client(() => json({ code: 0, data: { routeSummary: summary(), routerAddress: evil } })).kyber.quote(NATIVE_ETH, TOKEN, 1n)).rejects.toThrow('unexpected router');
    await expect(client(() => json({ code: 0, data: { routerAddress: evil, data: '0xe21fd0e900', amountOut: '1' } })).kyber.build(summary(), SENDER, 500)).rejects.toThrow('unexpected router');
  });

  it('builds a buy that sends exactly the quoted ETH to the router, back to the sender', async () => {
    const { kyber, calls } = client(() => json({ code: 0, data: { routerAddress: KYBER_ROUTER, data: '0xe21fd0e90000', amountOut: '700', transactionValue: '10000000000000000' } }));
    const swap = await kyber.build(summary(), SENDER, 500);
    expect(swap).toEqual({ to: KYBER_ROUTER, data: '0xe21fd0e90000', value: '10000000000000000', amountOut: '700' });
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body).toMatchObject({ sender: SENDER, recipient: SENDER, slippageTolerance: 500, deadline: 1_789_000_000 + 1200, routeSummary: { checksum: 'abc' } });
  });

  it('rejects a build whose ETH value does not match the trade', async () => {
    const wrongValue = client(() => json({ code: 0, data: { routerAddress: KYBER_ROUTER, data: '0xe21fd0e90000', transactionValue: '99' } }));
    await expect(wrongValue.kyber.build(summary(), SENDER, 500)).rejects.toThrow('value does not match');
    const saleWithEth = client(() => json({ code: 0, data: { routerAddress: KYBER_ROUTER, data: '0xe21fd0e90000', transactionValue: '5' } }));
    await expect(saleWithEth.kyber.build(summary({ tokenIn: TOKEN, tokenOut: NATIVE_ETH, amountIn: '1000' }), SENDER, 500)).rejects.toThrow('must not send ETH');
  });
});
