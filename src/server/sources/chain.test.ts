/* eslint-disable @typescript-eslint/no-explicit-any */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Agent } from '../agent';
import { NATIVE, TOPICS, WETH } from '../chain/abi';
import { loadConfig } from '../config';
import { ChainSource } from './chain';

const HOUR_S = 3600;
const WETH_USD_POOL = '0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca';
const pad = (hex: string) => hex.replace(/^0x/, '').padStart(64, '0');
const topic = (address: string) => `0x${pad(address)}`;
const hex = (n: number | bigint) => `0x${n.toString(16)}`;
const abiString = (s: string) => `0x${pad('0x20')}${pad(hex(s.length))}${Buffer.from(s).toString('hex').padEnd(64, '0')}`;
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });

const X = '0x1000000000000000000000000000000000000001'; // Pons launch that runs past $30K
const CURVE_X = '0x1000000000000000000000000000000000000c01';
const CREATOR = '0x9000000000000000000000000000000000000009';
const Y = '0x2000000000000000000000000000000000000002'; // DEX launch that never reached $10K
const POOL_Y = '0x2000000000000000000000000000000000000d02';
const S = '0x3000000000000000000000000000000000000003'; // spam pool nobody trades
const O = '0x4000000000000000000000000000000000000004'; // an old token opening a new pool
const Z = '0x5000000000000000000000000000000000000005'; // young DEX launch, watched then labelled
const POOL_Z = '0x5000000000000000000000000000000000000d05';
const A = '0xa00000000000000000000000000000000000000a';
const B = '0xb00000000000000000000000000000000000000b';
const C = '0xc00000000000000000000000000000000000000c'; // buys X after its first hour

function world(stateFile: string | null = null) {
  const clock = { head: 1_000_000, headS: 1_789_000_000 };
  const ts = (block: number) => clock.headS - (clock.head - block); // one block per second
  const edge = clock.head - 48 * HOUR_S; // 48h ago at the first start
  const blocks = { x: edge - 20_000, y: edge - 40_000, s: edge - 50_000, o: edge - 10_000, z: clock.head - 10 * HOUR_S };
  const ms = (block: number) => ts(block) * 1000;
  const trade = (quoteWei: bigint, tokenWei: bigint) => `0x${pad(hex(quoteWei))}${pad(hex(tokenWei))}${pad('0x0')}${pad('0x0')}`;

  const logs = [
    { blockNumber: hex(blocks.x), topics: [TOPICS.ponsCreated, topic(X), topic(CURVE_X), topic(CREATOR)], data: `0x${pad('0x0')}${pad('0x0')}${pad(hex(42n * 10n ** 17n))}` },
    { blockNumber: hex(blocks.y), topics: [TOPICS.v2PairCreated, topic(Y), topic(WETH)], data: `0x${pad(POOL_Y)}${pad('0x1')}` },
    { blockNumber: hex(blocks.s), topics: [TOPICS.v4Initialize, `0x${'5'.repeat(64)}`, topic(NATIVE), topic(S)], data: `0x${pad('0x0')}` },
    { blockNumber: hex(blocks.o), topics: [TOPICS.v2PairCreated, topic(O), topic(WETH)], data: `0x${pad('0x4000000000000000000000000000000000000d04')}${pad('0x2')}` },
    { blockNumber: hex(blocks.z), topics: [TOPICS.v2PairCreated, topic(Z), topic(WETH)], data: `0x${pad(POOL_Z)}${pad('0x3')}` },
    // Curve trades: 0.02 WETH for a million X is $0.00005 a token at $2,500 ETH, $50K on a billion supply
    { address: CURVE_X, blockNumber: hex(blocks.x + 3), topics: [TOPICS.ponsTrade, topic(A), topic(A)], data: trade(10n ** 15n, 10n ** 24n) },
    { address: CURVE_X, blockNumber: hex(blocks.x + 7), topics: [TOPICS.ponsTrade, topic(B), topic(B)], data: trade(2n * 10n ** 16n, 10n ** 24n) },
    { address: CURVE_X, blockNumber: hex(blocks.x + 60 * HOUR_S), topics: [TOPICS.ponsTrade, topic(B), topic(B)], data: trade(10n ** 18n, 10n ** 24n) }, // after 48h: ignored
    // X transfers: supply minted to the curve, then two buyers
    { address: X, blockNumber: hex(blocks.x), topics: [TOPICS.transfer, topic(NATIVE), topic(CURVE_X)], data: `0x${pad(hex(10n ** 27n))}` },
    { address: X, blockNumber: hex(blocks.x + 5), topics: [TOPICS.transfer, topic(CURVE_X), topic(A)], data: `0x${pad(hex(10n ** 24n))}` },
    { address: X, blockNumber: hex(blocks.x + 9), topics: [TOPICS.transfer, topic(CURVE_X), topic(B)], data: `0x${pad(hex(10n ** 24n))}` },
    { address: X, blockNumber: hex(blocks.x + 2 * HOUR_S), topics: [TOPICS.transfer, topic(CURVE_X), topic(C)], data: `0x${pad(hex(10n ** 24n))}` }, // after the first hour: not counted
  ].map((l) => ({ address: '0xfactory', transactionHash: '0x', logIndex: '0x0', ...l }));

  const erc20: Record<string, [string, string]> = { [X]: ['Patient Otter', 'POTR'], [Y]: ['Quiet', 'QT'], [Z]: ['Young Heron', 'YHRN'] };
  const dexscreener: Record<string, any[]> = {
    [Y]: [{ pairAddress: POOL_Y, pairCreatedAt: ms(blocks.y), liquidity: { usd: 800 }, fdv: 2_000, baseToken: { address: Y, name: 'Quiet', symbol: 'QT' } }],
    [O]: [{ pairAddress: '0xold', pairCreatedAt: ms(blocks.o) - 30 * 24 * 3_600_000, baseToken: { address: O, name: 'Old', symbol: 'OLD' } }],
    [Z]: [{ pairAddress: POOL_Z, pairCreatedAt: ms(blocks.z), liquidity: { usd: 5000 }, fdv: 12_000, baseToken: { address: Z, name: 'Young Heron', symbol: 'YHRN' } }],
  };
  const highs: Record<string, [number, number]> = {
    [POOL_Y]: [ts(blocks.y) + 2 * HOUR_S, 0.000005], // $5K
    [POOL_Z]: [ts(blocks.z) + 30 * HOUR_S, 0.00002], // $20K
  };

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('https://rpc.test')) {
      const { method, params } = JSON.parse(String(init?.body));
      if (method === 'eth_blockNumber') return json({ result: hex(clock.head) });
      if (method === 'eth_getBlockByNumber') return json({ result: { timestamp: hex(ts(Number(params[0]))) } });
      if (method === 'eth_call') {
        const meta = erc20[params[0].to];
        if (!meta) return json({ error: { code: 3, message: 'execution reverted' } });
        const answers: Record<string, string> = { '0x06fdde03': abiString(meta[0]), '0x95d89b41': abiString(meta[1]), '0x313ce567': `0x${pad('0x12')}`, '0x18160ddd': `0x${pad(hex(10n ** 27n))}` };
        return json({ result: answers[params[0].data] });
      }
      if (method === 'eth_getLogs') {
        const f = params[0];
        const [from, to] = [Number(f.fromBlock), Number(f.toBlock)];
        const wanted = f.topics?.[0];
        const addresses = f.address ? [f.address].flat() : null;
        return json({
          result: logs.filter(
            (l) =>
              Number(l.blockNumber) >= from &&
              Number(l.blockNumber) <= Math.min(to, clock.head) &&
              (!addresses || addresses.includes(l.address)) &&
              (!wanted || (Array.isArray(wanted) ? wanted.includes(l.topics[0]) : wanted === l.topics[0])),
          ),
        });
      }
    }
    if (url.startsWith('https://dex.test/tokens/v1/robinhood/')) return json(url.split('/').pop()!.split(',').flatMap((a) => dexscreener[a] ?? []));
    if (url.startsWith(`https://gecko.test/networks/robinhood/pools/${WETH_USD_POOL}/ohlcv/hour`)) {
      const q = new URL(url).searchParams;
      const before = Math.floor(Number(q.get('before_timestamp')) / HOUR_S) * HOUR_S;
      const list = Array.from({ length: Number(q.get('limit')) }, (_, i) => [before - i * HOUR_S, 2500, 2500, 2500, 2500, 1]);
      return json({ data: { attributes: { ohlcv_list: list } } });
    }
    if (url.startsWith('https://gecko.test/networks/robinhood/pools/')) {
      const pool = url.split('/pools/')[1].split('/')[0];
      const high = highs[pool];
      return high ? json({ data: { attributes: { ohlcv_list: [[high[0], 0, high[1], 0, 0, 0]] } } }) : json({}, 404);
    }
    if (url.startsWith('https://gecko.test/networks/robinhood/tokens/multi/')) {
      const addrs = url.split('/multi/')[1].split(',');
      return json({ data: addrs.filter((a) => a === X).map((a) => ({ attributes: { address: a, name: 'Patient Otter', symbol: 'POTR', decimals: 18, normalized_total_supply: '1000000000', image_url: 'https://assets.geckoterminal.com/x.png' } })) });
    }
    return json({}, 404);
  }) as typeof fetch;

  const agent = new Agent('hoeffding', null, 3600);
  const make = () =>
    new ChainSource(agent, {
      rpcUrl: 'https://rpc.test',
      geckoApi: 'https://gecko.test',
      geckoPerMinute: 1000,
      dexscreenerApi: 'https://dex.test',
      network: 'robinhood',
      pollSeconds: 60,
      backfillDays: 3,
      backfillSample: 1,
      stateFile,
      fetchImpl,
      now: () => clock.headS * 1000,
      sleep: async () => {},
    });
  return { clock, agent, source: make(), make };
}

describe('Chain source (mocked chain, DexScreener and GeckoTerminal)', () => {
  it('backfills history, watches young launches and labels them at 48h', async () => {
    const { clock, agent, source } = world();
    await source.init();
    for (let i = 0; i < 5; i++) {
      await source.backfillStep();
      await source.slowStep();
    }
    await source.drainHolders();
    await source.drainLogos();

    expect(source.progress()).toMatchObject({ running: false, progress: 1 });
    expect([...agent.tokens.keys()]).toEqual([X]); // Y under $10K, S never traded, O is not a new launch
    expect(agent.tokens.get(X)).toMatchObject({
      status: 'passed',
      peakMc: 50_000, // from the curve's own trades; the trade after 48h does not count
      name: 'Patient Otter',
      symbol: 'POTR',
      holders: 3, // the curve, A and B; C bought after the first hour
      holdersMissing: false,
      deployer: CREATOR,
      loreRaw: '',
      logo: 'https://assets.geckoterminal.com/x.png',
    });
    expect(source.stats).toMatchObject({ belowEntry: 1, labelled: 1 });
    expect(source.stats.neverTraded).toBeGreaterThanOrEqual(1);

    await source.liveTick(); // finds Z (10h old, $12K now) and shows it as watching
    expect(agent.tokens.get(Z)).toMatchObject({ status: 'pending', peakMc: 12_000 });
    expect(agent.warmup()).toMatchObject({ labelled: 1, pending: 1 });

    clock.head += 40 * HOUR_S; // Z turns 50h old
    clock.headS += 40 * HOUR_S;
    await source.liveTick();
    await source.labelQueued();
    expect(agent.tokens.get(Z)).toMatchObject({ status: 'stalled', peakMc: 20_000 });
    expect(agent.warmup()).toMatchObject({ labelled: 2, pending: 0 });
  });

  it('retries a step when prices are unavailable instead of rejecting tokens', async () => {
    const { agent, source } = world();
    await source.init();
    const prices = (source as any).prices;
    const real = prices.usdAt.bind(prices);
    prices.usdAt = async () => {
      throw new Error('geckoterminal unavailable');
    };
    const before = (source as any).state.backfillCursor;
    await expect(source.backfillStep()).rejects.toThrow('unavailable');
    expect((source as any).state.backfillCursor).toBe(before); // the cursor did not move
    expect(source.stats.belowEntry).toBe(0);

    prices.usdAt = real;
    await source.backfillStep();
    expect(agent.tokens.get(X)).toMatchObject({ status: 'passed' });
  });

  it('retrains at start when the saved model is older than one cycle', () => {
    const agent = new Agent('hoeffding', null, 3600);
    agent.runCycle(new Date(Date.now() - 2 * 3_600_000));
    const before = agent.runs.length;
    agent.start();
    agent.stop();
    expect(agent.runs.length).toBe(before + 1);
  });

  it('counts holders again after an upgrade from counts taken at another hour', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'chain-')), 'chain.json');
    const { agent, source, make } = world(file);
    await source.init();
    for (let i = 0; i < 5; i++) await source.backfillStep();
    await source.drainHolders();
    expect(agent.tokens.get(X)).toMatchObject({ holders: 3, holdersMissing: false });
    expect(JSON.parse(readFileSync(file, 'utf8')).holdersSampledHours).toBe(1);

    // A state written when holders were counted at 48h: C's later buy was in the count.
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    delete saved.holdersSampledHours;
    writeFileSync(file, JSON.stringify(saved));
    agent.upsert({ ...agent.tokens.get(X)!, holders: 4 }, false);

    const upgraded = make();
    await upgraded.init();
    expect(agent.tokens.get(X)).toMatchObject({ holdersMissing: true });
    expect(agent.latest?.n).toBe(0); // the model fed by the old counts was replaced at once
    expect(JSON.parse(readFileSync(file, 'utf8')).holdersSampledHours).toBe(1);

    await upgraded.drainHolders();
    expect(agent.tokens.get(X)).toMatchObject({ holders: 3, holdersMissing: false });
  });

  it('trains only on tokens whose holder count is known', () => {
    const agent = new Agent('hoeffding', null, 3600);
    for (let i = 0; i < 40; i++) {
      agent.upsert(
        {
          mint: `0x${(i + 1).toString(16).padStart(40, '0')}`,
          name: `Token ${i}`,
          symbol: 'TKN',
          lore: '',
          loreWithheld: false,
          holders: 5 + i,
          holdersMissing: i >= 30,
          peakMc: i % 3 ? 15_000 : 40_000,
          status: i % 3 ? 'stalled' : 'passed',
          hour: i % 24,
          dow: i % 7,
          launchedAt: new Date(1_789_000_000_000 + i * 60_000).toISOString(),
          deployer: '',
          hue: 38,
        },
        false,
      );
    }
    expect(agent.runCycle().n).toBe(30);
    expect(agent.warmup()).toMatchObject({ labelled: 40, ready: 30 });
    expect(agent.counters().median_holders).toBe(20); // known counts only
  });

  it('still accepts DATA_SOURCE=dexscreener as the live source', () => {
    expect(loadConfig({ DATA_SOURCE: 'dexscreener' }).source).toBe('chain');
    expect(loadConfig({ DATA_SOURCE: 'chain' })).toMatchObject({ source: 'chain', backfillDays: 14, persist: true });
    expect(loadConfig({}).source).toBe('simulated');
  });
});
