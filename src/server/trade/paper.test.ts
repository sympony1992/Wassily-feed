import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TradeSignal } from '@/engine/tradeSignal';
import type { Token } from '@/engine/types';
import { NATIVE_ETH, type Quote } from './kyber';
import { PaperTrader } from './paper';

const HOUR = 3_600_000;
const MINT = '0x1000000000000000000000000000000000000001';

const token = { mint: MINT, name: 'Patient Otter', symbol: 'POTR', lore: '', loreWithheld: false, holders: 20, peakMc: 15_000, status: 'pending', hour: 3, dow: 1, launchedAt: '2026-09-15T00:00:00.000Z', deployer: '', hue: 38 } as Token;
const active: TradeSignal = { score: 0.72, gates: {} as TradeSignal['gates'], blockedBy: null, state: 'active', ageHours: 3 };

/** Sell quotes answer from `values` in turn: a number is the USD a sale returns, null is no route, an Error is an outage. */
function setup(values: (number | null | Error)[], file: string | null = null) {
  const clock = { now: 1_789_000_000_000 };
  const signals = [{ token, signal: active }];
  const kyber = {
    quote: async (tokenIn: string, tokenOut: string, amountIn: bigint): Promise<Quote | null> => {
      if (tokenIn === NATIVE_ETH) return { summary: { tokenIn, tokenOut, amountIn: amountIn.toString(), amountInUsd: '25', amountOut: '1000', amountOutUsd: '0', gas: '1', gasUsd: '0.07', route: [] }, exchanges: ['pons-v2'] };
      const next = values.shift();
      if (next instanceof Error) throw next;
      if (next == null) return null;
      return { summary: { tokenIn, tokenOut, amountIn: amountIn.toString(), amountInUsd: '0', amountOut: '1', amountOutUsd: String(next), gas: '1', gasUsd: '0.07', route: [] }, exchanges: ['pons-v2'] };
    },
  };
  const paper = new PaperTrader({ signals: () => signals, ethUsd: async () => 2500 }, kyber, { file, now: () => clock.now, sleep: async () => {} });
  return { paper, clock };
}

describe('Paper trading', () => {
  it('buys each active signal once at a real quote and closes it at +200%', async () => {
    const { paper } = setup([30, 80]);
    await paper.tick(); // opens, then values it at $30
    expect(paper.list()).toMatchObject([{ mint: MINT, stakeUsd: 25, amountInWei: '10000000000000000', tokens: '1000', valueUsd: 30, score: 0.72 }]);
    await paper.tick(); // $80 is more than three times the stake
    expect(paper.list()[0]).toMatchObject({ exit: 'take_profit', valueUsd: 80 });
    await paper.tick();
    expect(paper.list()).toHaveLength(1); // never bought twice
    expect(paper.summary()).toMatchObject({ positions: 1, closed: 1, win_rate: 1, pnl_usd: 55, best_pct: 2.2 });
  });

  it('stops out at −40% and closes on the time stop 48h after the buy', async () => {
    const stop = setup([14]);
    await stop.paper.tick();
    expect(stop.paper.list()[0]).toMatchObject({ exit: 'stop_loss', valueUsd: 14 });

    const time = setup([25, 26]);
    await time.paper.tick();
    time.clock.now += 49 * HOUR;
    await time.paper.tick();
    expect(time.paper.list()[0]).toMatchObject({ exit: 'time_stop', valueUsd: 26 });
  });

  it('writes a position off only after three checks with no route, never because of an outage', async () => {
    const { paper } = setup([new Error('kyberswap unavailable'), null, null, new Error('kyberswap unavailable'), null]);
    await paper.tick();
    await paper.tick();
    await paper.tick();
    await paper.tick();
    expect(paper.list()[0]).toMatchObject({ missedQuotes: 2 });
    expect(paper.list()[0].exit).toBeUndefined();
    expect(paper.stats.errors).toBe(2);
    await paper.tick();
    expect(paper.list()[0]).toMatchObject({ exit: 'no_route', valueUsd: 0 });
  });

  it('keeps the record across restarts', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'paper-')), 'paper.json');
    const first = setup([30], file);
    await first.paper.tick();
    const again = setup([], file);
    expect(again.paper.list()).toMatchObject([{ mint: MINT, valueUsd: 30 }]);
  });
});
