/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { Agent } from '../agent';
import { NATIVE, TOPICS, WETH } from '../chain/abi';
import { loadConfig } from '../config';
import { ChainSource } from './chain';

const HOUR_S = 3600;
const pad = (hex: string) => hex.replace(/^0x/, '').padStart(64, '0');
const topic = (address: string) => `0x${pad(address)}`;
const hex = (n: number | bigint) => `0x${n.toString(16)}`;
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });

const X = '0x1000000000000000000000000000000000000001'; // Pons launch that runs past $30K
const CURVE_X = '0x1000000000000000000000000000000000000c01';
const POOL_X = '0x1000000000000000000000000000000000000d01';
const CREATOR = '0x9000000000000000000000000000000000000009';
const Y = '0x2000000000000000000000000000000000000002'; // traded but never reached $10K
const POOL_Y = '0x2000000000000000000000000000000000000d02';
const S = '0x3000000000000000000000000000000000000003'; // spam pool nobody trades
const O = '0x4000000000000000000000000000000000000004'; // an old token opening a new pool
const Z = '0x5000000000000000000000000000000000000005'; // young launch, watched then labelled
const POOL_Z = '0x5000000000000000000000000000000000000d05';
const A = '0xa00000000000000000000000000000000000000a';
const B = '0xb00000000000000000000000000000000000000b';

function world() {
  const clock = { head: 1_000_000, headS: 1_789_000_000 };
  const ts = (block: number) => clock.headS - (clock.head - block); // one block per second
  const edge = clock.head - 48 * HOUR_S; // 48h ago at the first start
  const blocks = { x: edge - 20_000, y: edge - 40_000, s: edge - 50_000, o: edge - 10_000, z: clock.head - 10 * HOUR_S };
  const ms = (block: number) => ts(block) * 1000;

  const logs = [
    { blockNumber: hex(blocks.x), topics: [TOPICS.ponsCreated, topic(X), topic(CURVE_X), topic(CREATOR)], data: '0x' },
    { blockNumber: hex(blocks.y), topics: [TOPICS.v2PairCreated, topic(Y), topic(WETH)], data: `0x${pad(POOL_Y)}${pad('0x1')}` },
    { blockNumber: hex(blocks.s), topics: [TOPICS.v4Initialize, `0x${'5'.repeat(64)}`, topic(NATIVE), topic(S)], data: `0x${pad('0x0')}` },
    { blockNumber: hex(blocks.o), topics: [TOPICS.v2PairCreated, topic(O), topic(WETH)], data: `0x${pad('0x4000000000000000000000000000000000000d04')}${pad('0x2')}` },
    { blockNumber: hex(blocks.z), topics: [TOPICS.v2PairCreated, topic(Z), topic(WETH)], data: `0x${pad(POOL_Z)}${pad('0x3')}` },
    // X transfers: supply minted to the curve, then two buyers
    { address: X, blockNumber: hex(blocks.x), topics: [TOPICS.transfer, topic(NATIVE), topic(CURVE_X)], data: `0x${pad(hex(10n ** 27n))}` },
    { address: X, blockNumber: hex(blocks.x + 5), topics: [TOPICS.transfer, topic(CURVE_X), topic(A)], data: `0x${pad(hex(10n ** 24n))}` },
    { address: X, blockNumber: hex(blocks.x + 9), topics: [TOPICS.transfer, topic(CURVE_X), topic(B)], data: `0x${pad(hex(10n ** 24n))}` },
  ].map((l) => ({ address: '0xfactory', transactionHash: '0x', logIndex: '0x0', ...l }));

  const dexscreener: Record<string, any[]> = {
    [X]: [{ pairAddress: POOL_X, pairCreatedAt: ms(blocks.x) + 3_600_000, liquidity: { usd: 9000 }, fdv: 18_000, baseToken: { address: X, name: 'Patient Otter', symbol: 'POTR' }, info: { imageUrl: 'U7yFWDqA11bogftV' } }],
    [Y]: [{ pairAddress: POOL_Y, pairCreatedAt: ms(blocks.y), liquidity: { usd: 800 }, fdv: 2_000, baseToken: { address: Y, name: 'Quiet', symbol: 'QT' } }],
    [O]: [{ pairAddress: '0xold', pairCreatedAt: ms(blocks.o) - 30 * 24 * 3_600_000, baseToken: { address: O, name: 'Old', symbol: 'OLD' } }],
    [Z]: [{ pairAddress: POOL_Z, pairCreatedAt: ms(blocks.z), liquidity: { usd: 5000 }, fdv: 12_000, baseToken: { address: Z, name: 'Young Heron', symbol: 'YHRN' } }],
  };
  const highs: Record<string, [number, number]> = {
    [POOL_X]: [ts(blocks.x) + 5 * HOUR_S, 0.00005], // $50K on a billion supply
    [CURVE_X]: [ts(blocks.x) + HOUR_S, 0.00002],
    [POOL_Y]: [ts(blocks.y) + 2 * HOUR_S, 0.000005], // $5K
    [POOL_Z]: [ts(blocks.z) + 30 * HOUR_S, 0.00002], // $20K
  };
  const names: Record<string, string> = { [X]: 'Patient Otter', [Y]: 'Quiet', [Z]: 'Young Heron' };

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('https://rpc.test')) {
      const { method, params } = JSON.parse(String(init?.body));
      if (method === 'eth_blockNumber') return json({ result: hex(clock.head) });
      if (method === 'eth_getBlockByNumber') return json({ result: { timestamp: hex(ts(Number(params[0]))) } });
      if (method === 'eth_getLogs') {
        const f = params[0];
        const [from, to] = [Number(f.fromBlock), Number(f.toBlock)];
        const wanted = f.topics?.[0];
        return json({
          result: logs.filter(
            (l) =>
              Number(l.blockNumber) >= from &&
              Number(l.blockNumber) <= Math.min(to, clock.head) &&
              (!f.address || l.address === f.address) &&
              (!wanted || (Array.isArray(wanted) ? wanted.includes(l.topics[0]) : wanted === l.topics[0])),
          ),
        });
      }
    }
    if (url.startsWith('https://dex.test/tokens/v1/robinhood/')) return json(url.split('/').pop()!.split(',').flatMap((a) => dexscreener[a] ?? []));
    if (url.startsWith('https://gecko.test/networks/robinhood/pools/')) {
      const pool = url.split('/pools/')[1].split('/')[0];
      const high = highs[pool];
      return high ? json({ data: { attributes: { ohlcv_list: [[high[0], 0, high[1], 0, 0, 0]] } } }) : json({}, 404);
    }
    if (url.startsWith('https://gecko.test/networks/robinhood/tokens/multi/')) {
      const addrs = url.split('/multi/')[1].split(',');
      return json({ data: addrs.filter((a) => names[a]).map((a) => ({ attributes: { address: a, name: names[a], symbol: 'T', decimals: 18, normalized_total_supply: '1000000000', image_url: 'missing.png' } })) });
    }
    return json({}, 404);
  }) as typeof fetch;

  const agent = new Agent('hoeffding', null, 3600);
  const source = new ChainSource(agent, {
    rpcUrl: 'https://rpc.test',
    geckoApi: 'https://gecko.test',
    geckoPerMinute: 1000,
    dexscreenerApi: 'https://dex.test',
    network: 'robinhood',
    pollSeconds: 60,
    backfillDays: 3,
    backfillSample: 1,
    stateFile: null,
    fetchImpl,
    now: () => clock.headS * 1000,
    sleep: async () => {},
  });
  return { clock, agent, source };
}

describe('Chain source (mocked chain, DexScreener and GeckoTerminal)', () => {
  it('backfills history, watches young launches and labels them at 48h', async () => {
    const { clock, agent, source } = world();
    await source.init();
    for (let i = 0; i < 5; i++) await source.backfillStep();

    expect(source.progress()).toMatchObject({ running: false, progress: 1 });
    expect([...agent.tokens.keys()]).toEqual([X]); // Y under $10K, S never traded, O is not a new launch
    expect(agent.tokens.get(X)).toMatchObject({
      status: 'passed',
      peakMc: 50_000,
      holders: 3, // the curve, A and B
      holdersMissing: false,
      deployer: CREATOR,
      loreRaw: '',
      logo: expect.stringContaining('cdn.dexscreener.com/cms/images/U7yFWDqA11bogftV?width=128'),
    });
    expect(source.stats).toMatchObject({ belowEntry: 1, neverTraded: 1, labelled: 1 });

    await source.liveTick(); // finds Z (10h old, $12K now) and shows it as watching
    expect(agent.tokens.get(Z)).toMatchObject({ status: 'pending', peakMc: 12_000 });
    expect(agent.warmup()).toMatchObject({ labelled: 1, pending: 1 });

    clock.head += 40 * HOUR_S; // Z turns 50h old
    clock.headS += 40 * HOUR_S;
    await source.liveTick();
    expect(agent.tokens.get(Z)).toMatchObject({ status: 'stalled', peakMc: 20_000 });
    expect(agent.warmup()).toMatchObject({ labelled: 2, pending: 0 });
  });

  it('retries a step when GeckoTerminal is unavailable instead of rejecting tokens', async () => {
    const { agent, source } = world();
    await source.init();
    const gecko = (source as any).gecko;
    const real = gecko.peakPrice.bind(gecko);
    gecko.peakPrice = async () => {
      throw new Error('geckoterminal unavailable');
    };
    const before = source.progress()!.progress;
    await expect(source.backfillStep()).rejects.toThrow('unavailable');
    expect(source.progress()!.progress).toBe(before); // the cursor did not move
    expect(source.stats.belowEntry).toBe(0);

    gecko.peakPrice = real;
    await source.backfillStep();
    expect(agent.tokens.get(X)).toMatchObject({ status: 'passed' });
  });

  it('still accepts DATA_SOURCE=dexscreener as the live source', () => {
    expect(loadConfig({ DATA_SOURCE: 'dexscreener' }).source).toBe('chain');
    expect(loadConfig({ DATA_SOURCE: 'chain' })).toMatchObject({ source: 'chain', backfillDays: 14, persist: true });
    expect(loadConfig({}).source).toBe('simulated');
  });
});
