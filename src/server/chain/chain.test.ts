import { describe, expect, it } from 'vitest';
import { TOPICS, WETH, decodeLaunch, decodeString } from './abi';
import { GeckoClient } from './gecko';
import { holdersAt } from './holders';
import type { RpcLog } from './rpc';

const pad = (hex: string) => hex.replace(/^0x/, '').padStart(64, '0');
const topic = (address: string) => `0x${pad(address)}`;
const A = '0x1111111111111111111111111111111111111111';
const B = '0x2222222222222222222222222222222222222222';
const C = '0x3333333333333333333333333333333333333333';
const log = (topics: string[], data = '0x', blockNumber = '0x10'): RpcLog => ({ address: C, topics, data, blockNumber, transactionHash: '0x', logIndex: '0x0' });

describe('decodeLaunch', () => {
  it('reads v2 pairs, v3 pools, v4 pool ids and Pons curves', () => {
    expect(decodeLaunch(log([TOPICS.v2PairCreated, topic(A), topic(B)], `0x${pad(C)}${pad('0x1')}`))).toEqual({ kind: 'v2', pool: C, tokenA: A, tokenB: B, block: 16 });
    expect(decodeLaunch(log([TOPICS.v3PoolCreated, topic(A), topic(B), topic('0x2710')], `0x${pad('0x3c')}${pad(C)}`))).toMatchObject({ kind: 'v3', pool: C });
    const id = `0x${'ab'.repeat(32)}`;
    expect(decodeLaunch(log([TOPICS.v4Initialize, id, topic(A), topic(B)], `0x${pad('0x0')}`))).toMatchObject({ kind: 'v4', pool: id, tokenA: A, tokenB: B });
    expect(decodeLaunch(log([TOPICS.ponsCreated, topic(A), topic(B), topic(C)]))).toEqual({ kind: 'pons', pool: B, tokenA: A, tokenB: WETH, creator: C, block: 16 });
    expect(decodeLaunch(log([TOPICS.transfer, topic(A), topic(B)]))).toBeNull();
  });

  it('decodes ABI strings and bytes32 names', () => {
    const abiString = `0x${pad('0x20')}${pad('0x5')}${Buffer.from('Hello').toString('hex').padEnd(64, '0')}`;
    expect(decodeString(abiString)).toBe('Hello');
    expect(decodeString(`0x${Buffer.from('MKR').toString('hex').padEnd(64, '0')}`)).toBe('MKR');
  });
});

describe('holdersAt', () => {
  it('replays transfers and counts positive balances', async () => {
    const zero = '0x0000000000000000000000000000000000000000';
    const transfer = (from: string, to: string, value: bigint) => log([TOPICS.transfer, topic(from), topic(to)], `0x${pad(value.toString(16))}`);
    const rpc = {
      getLogs: async () => [
        transfer(zero, A, 1000n), // mint
        transfer(A, B, 400n),
        transfer(A, C, 600n), // A is empty again
        transfer(C, zero, 100n), // burn
        log([TOPICS.transfer, topic(A), topic(B), topic('0x1')]), // ERC-721 shape, ignored
      ],
    };
    expect(await holdersAt(rpc, A, 0, 100)).toBe(2); // B and C
  });
});

describe('RpcClient', () => {
  it('waits out rate limits on the same range and splits only ranges the node refuses', async () => {
    const { RpcClient } = await import('./rpc');
    const ranges: string[] = [];
    let limited = 1;
    const fetchImpl = (async (_: unknown, init?: RequestInit) => {
      const { fromBlock, toBlock } = JSON.parse(String(init?.body)).params[0];
      ranges.push(`${Number(fromBlock)}-${Number(toBlock)}`);
      if (limited-- > 0) return new Response('slow down', { status: 429 });
      const body = Number(toBlock) - Number(fromBlock) > 100 ? { error: { code: -32000, message: 'logs matched by query exceeds limit of 10000' } } : { result: [] };
      return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    await new RpcClient('https://rpc.test', { fetchImpl }).getLogs({ fromBlock: 0, toBlock: 200 });
    expect(ranges.slice(0, 2)).toEqual(['0-200', '0-200']); // after a 429 the same range is asked again
    expect(ranges).toEqual(expect.arrayContaining(['0-100', '101-200']));
  });
});

describe('GeckoClient', () => {
  const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
  const quick = { network: 'robinhood', sleep: async () => {}, now: () => 0 };

  it('batches pool lookups by 30 and reads the base token', async () => {
    const urls: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
      const u = String(input);
      urls.push(u);
      const addrs = u.split('/pools/multi/')[1].split(',');
      return json({ data: addrs.slice(0, 1).map((a) => ({ attributes: { address: a, name: 'X / WETH', pool_created_at: '2026-09-01T00:00:00Z' }, relationships: { dex: { data: { id: 'pons-v2' } }, base_token: { data: { id: `robinhood_${A}` } }, quote_token: { data: { id: `robinhood_${WETH}` } } } })) });
    }) as typeof fetch;
    const gecko = new GeckoClient({ ...quick, fetchImpl });
    const pools = await gecko.pools(Array.from({ length: 31 }, (_, i) => `0x${String(i).padStart(40, '0')}`));
    expect(urls).toHaveLength(2);
    expect(pools[0]).toMatchObject({ dex: 'pons-v2', baseToken: A, quoteToken: WETH });
  });

  it('retries after 429 and takes the highest hourly price inside the window', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      if (calls === 1) return json({}, 429);
      return json({ data: { attributes: { ohlcv_list: [[7200, 1, 9, 1, 1, 1], [3600, 1, 5, 1, 1, 1], [-7200, 1, 99, 1, 1, 1]] } } });
    }) as typeof fetch;
    const gecko = new GeckoClient({ ...quick, fetchImpl });
    expect(await gecko.peakPrice(`0x${'1'.repeat(40)}`, A, 3600, 7200)).toBe(9); // the candle before the launch hour is ignored
    expect(gecko.stats.throttled).toBe(1);
  });

  it('drops placeholder images', async () => {
    const fetchImpl = (async () =>
      json({ data: [{ attributes: { address: A, name: 'A', symbol: 'A', decimals: 18, normalized_total_supply: '1000000000', image_url: 'missing.png' } }] })) as typeof fetch;
    const [token] = await new GeckoClient({ ...quick, fetchImpl }).tokens([A]);
    expect(token).toMatchObject({ supply: 1_000_000_000, imageUrl: undefined });
  });
});
