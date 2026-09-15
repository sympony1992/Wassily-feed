import { describe, expect, it } from 'vitest';
import { FEATURE_NAMES } from '@/engine/features';
import type { ModelRun, ScoringModel, Token } from '@/engine/types';
import { Agent } from '../agent';
import { NATIVE_ETH, type Quote, type RouteSummary } from './kyber';
import { TradeService } from './service';

const HOUR = 3_600_000;
const NOW = 1_789_000_000_000;
const HOT = '0x1000000000000000000000000000000000000001'; // qualifies, real market
const YOUNG = '0x2000000000000000000000000000000000000002'; // no holder count yet
const DEAD_POOL = '0x3000000000000000000000000000000000000003'; // qualifies on paper, but no route
const TRAP = '0x4000000000000000000000000000000000000004'; // buyable, but selling back returns almost nothing
const TWIN_A = '0x5000000000000000000000000000000000000005'; // two watched tokens with one symbol
const TWIN_B = '0x6000000000000000000000000000000000000006';
const SLUR = '0x7000000000000000000000000000000000000007';
const SENDER = '0x000000000000000000000000000000000000beef';
const PROBE_WEI = 4_000_000_000_000_000; // $10 at $2,500 ETH

const d = FEATURE_NAMES.length;
const scoring: ScoringModel = { bias: -2, weights: FEATURE_NAMES.map((n) => (n === 'holders_log' ? 1 : 0)), mu: new Array(d).fill(0), sigma: new Array(d).fill(1) };
const run = (auc: number): ModelRun => ({
  runId: 1,
  ranAt: new Date(NOW).toISOString(),
  n: 5000,
  nPositive: 1500,
  d,
  auc,
  aucStd: 0.01,
  foldAucs: [auc],
  timeSplitGap: 0.01,
  bootLower: auc - 0.01,
  featureImportance: {},
  hourRates: [],
  hourCounts: [],
  medianHolders: 5,
  model: scoring,
  source: 'api',
});
const token = (mint: string, over: Partial<Token> = {}): Token => ({
  mint,
  name: 'Patient Otter',
  symbol: `T${mint.slice(-2)}`,
  lore: '',
  loreRaw: '',
  loreWithheld: false,
  holders: 20,
  holdersMissing: false,
  peakMc: 15_000,
  status: 'pending',
  hour: 3,
  dow: 1,
  launchedAt: new Date(NOW - 3 * HOUR).toISOString(),
  deployer: '',
  hue: 38,
  ...over,
});
const summary = (over: Partial<RouteSummary> = {}): RouteSummary => ({
  tokenIn: NATIVE_ETH,
  amountIn: '10000000000000000', // $25 at $2,500 ETH
  amountInUsd: '0', // KyberSwap's USD fields are never trusted
  tokenOut: HOT,
  amountOut: '1000',
  amountOutUsd: '0',
  gas: '1',
  gasUsd: '0.07',
  route: [[{ pool: '0xpool', exchange: 'pons-v2', tokenIn: NATIVE_ETH, tokenOut: HOT }]],
  ...over,
});

// ETH a sale of the test buy returns, as a share of the ETH spent.
const SALE_SHARE: Record<string, number> = { [HOT]: 0.95, [TRAP]: 0.002, [TWIN_A]: 0.95, [TWIN_B]: 0.95 };

function setup(o: { live?: boolean; enabled?: boolean; auc?: number } = {}) {
  const agent = new Agent('hoeffding', null, 3600);
  agent.runs = [run(o.auc ?? 0.8)];
  agent.upsert(token(HOT), false);
  agent.upsert(token(YOUNG, { holdersMissing: true, launchedAt: new Date(NOW - 0.5 * HOUR).toISOString() }), false);
  agent.upsert(token(DEAD_POOL), false);
  agent.upsert(token(TRAP), false);
  agent.upsert(token(TWIN_A, { symbol: 'SCRIBE' }), false);
  agent.upsert(token(TWIN_B, { symbol: 'scribe' }), false);
  agent.upsert(token(SLUR, { name: 'Nigger Coin' }), false);
  const quotes: [string, string, bigint][] = [];
  const builds: [RouteSummary, string, number][] = [];
  const kyber = {
    quote: async (tokenIn: string, tokenOut: string, amountIn: bigint): Promise<Quote | null> => {
      quotes.push([tokenIn, tokenOut, amountIn]);
      if (tokenIn === NATIVE_ETH) {
        if (tokenOut === DEAD_POOL) return null;
        return { summary: summary({ tokenIn, tokenOut, amountIn: amountIn.toString() }), exchanges: ['pons-v2'] };
      }
      const share = SALE_SHARE[tokenIn];
      if (share == null) return null;
      return { summary: summary({ tokenIn, tokenOut, amountIn: amountIn.toString(), amountOut: String(Math.round(PROBE_WEI * share)) }), exchanges: ['pons-v2'] };
    },
    build: async (s: RouteSummary, sender: string, slippageBps: number) => {
      builds.push([s, sender, slippageBps]);
      return { to: '0x6131b5fae19ea4f9d964eac0408e4408b66337b5', data: '0xe21fd0e9', value: s.amountIn, amountOut: s.amountOut };
    },
  };
  const fetchImpl = (async () => new Response(JSON.stringify({ data: { attributes: { token_prices: { weth: '2500' } } } }))) as unknown as typeof fetch;
  const trade = new TradeService(agent, { live: o.live ?? true, enabled: o.enabled ?? true, kyber, geckoApi: 'https://gecko.test', network: 'robinhood', fetchImpl, now: () => NOW, sleep: async () => {} });
  const state = (mint: string) => trade.signalFor(mint)?.signal;
  return { agent, trade, quotes, builds, state };
}

describe('Trade service', () => {
  it('shows no button until a market check confirms a token can be bought and sold back', async () => {
    const { trade, state } = setup();
    expect(state(HOT)).toMatchObject({ state: 'none', blockedBy: 'market', market: null });
    await expect(trade.quoteBuy(HOT, 25)).rejects.toThrow('still being checked');
    await trade.refreshMarkets();
    expect(state(HOT)).toMatchObject({ state: 'active', market: { ok: true, reason: null } });
    expect(state(HOT)!.market!.roundTrip).toBeCloseTo(-0.05, 10); // 0.95 of the ETH comes back, whatever the USD fields say
  });

  it('keeps tokens with no route, or a trap that cannot be sold back, without a button', async () => {
    const { trade, state } = setup();
    await trade.refreshMarkets();
    expect(state(DEAD_POOL)).toMatchObject({ state: 'none', blockedBy: 'market', market: { ok: false, reason: 'no_route' } });
    expect(state(TRAP)).toMatchObject({ state: 'none', blockedBy: 'market', market: { ok: false, reason: 'round_trip' } });
    await expect(trade.quoteBuy(TRAP, 25)).rejects.toThrow('bought and sold back');
  });

  it('refuses copycat symbols and leaves offensive names off the list', async () => {
    const { trade, state } = setup();
    await trade.refreshMarkets();
    expect(state(TWIN_A)).toMatchObject({ state: 'none', blockedBy: 'copycat' });
    expect(state(TWIN_B)).toMatchObject({ state: 'none', blockedBy: 'copycat' });
    expect(trade.signals().some((r) => r.token.mint === SLUR)).toBe(false);
  });

  it('asks the router only about tokens that pass every other gate, and not again while the answer is fresh', async () => {
    const { trade, quotes } = setup();
    await trade.refreshMarkets();
    const asked = new Set(quotes.filter(([tokenIn]) => tokenIn === NATIVE_ETH).map(([, tokenOut]) => tokenOut));
    expect([...asked].sort()).toEqual([HOT, DEAD_POOL, TRAP].sort()); // not YOUNG (no holders), not the twins (copycats), not the slur
    const before = quotes.length;
    await trade.refreshMarkets();
    expect(quotes.length).toBe(before);
  });

  it('prices a buy in ETH at the current ETH price, only for an active signal and a stake inside the limits', async () => {
    const { trade, quotes } = setup();
    await trade.refreshMarkets();
    quotes.length = 0;
    const { ethUsd } = await trade.quoteBuy(HOT, 25);
    expect(ethUsd).toBe(2500);
    expect(quotes[0]).toEqual([NATIVE_ETH, HOT, 10n ** 16n]); // $25 at $2,500 is 0.01 ETH
    await expect(trade.quoteBuy(HOT, 60)).rejects.toThrow('between $10 and $50');
    await expect(trade.quoteBuy(YOUNG, 25)).rejects.toThrow('does not qualify');
    await expect(trade.quoteBuy('0x9000000000000000000000000000000000000009', 25)).rejects.toThrow('not watching');
  });

  it('locks every buy while the jar is not full, and refuses them on a simulated or switched-off server', async () => {
    const locked = setup({ auc: 0.55 });
    await locked.trade.refreshMarkets();
    await expect(locked.trade.quoteBuy(HOT, 25)).rejects.toThrow('jar is not full');
    await expect(setup({ live: false }).trade.quoteBuy(HOT, 25)).rejects.toThrow('simulated');
    await expect(setup({ enabled: false }).trade.quoteBuy(HOT, 25)).rejects.toThrow('switched off');
  });

  it('builds only swaps that match the trade they claim to be, capping the stake from the ETH it sends', async () => {
    const { trade, builds } = setup();
    await trade.refreshMarkets();
    const swap = await trade.build('buy', HOT, summary(), SENDER, 500);
    expect(swap.value).toBe('10000000000000000');
    expect(builds[0][1]).toBe(SENDER);
    await expect(trade.build('buy', HOT, summary({ tokenOut: YOUNG }), SENDER, 500)).rejects.toThrow('does not match this buy');
    await expect(trade.build('buy', HOT, summary({ amountIn: '32000000000000000' }), SENDER, 500)).rejects.toThrow('may not exceed $50'); // $80 of ETH
    await expect(trade.build('buy', HOT, summary(), SENDER, 5000)).rejects.toThrow('Slippage');
    await expect(trade.build('buy', HOT, summary(), 'me', 500)).rejects.toThrow('wallet address');
    await expect(trade.build('sell', HOT, summary(), SENDER, 500)).rejects.toThrow('does not match this sale');
  });

  it('always lets a user sell on a live server, even with quick buy switched off', async () => {
    const { trade } = setup({ enabled: false });
    const sale = summary({ tokenIn: HOT, tokenOut: NATIVE_ETH, amountIn: '1000' });
    await expect(trade.build('sell', HOT, sale, SENDER, 500)).resolves.toMatchObject({ to: '0x6131b5fae19ea4f9d964eac0408e4408b66337b5' });
    await expect(setup({ live: false }).trade.build('sell', HOT, sale, SENDER, 500)).rejects.toThrow('simulated');
  });

  it('caps how many swaps one wallet can build in a minute', async () => {
    const { trade } = setup();
    await trade.refreshMarkets();
    for (let i = 0; i < 6; i++) await trade.build('buy', HOT, summary(), SENDER, 500);
    await expect(trade.build('buy', HOT, summary(), SENDER, 500)).rejects.toThrow('Too many trades');
  });
});
