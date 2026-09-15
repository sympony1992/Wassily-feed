import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TradeSignal } from '@/engine/tradeSignal';
import type { Token } from '@/engine/types';
import { NATIVE_ETH, type Quote } from './kyber';
import { PaperTrader, type PaperPosition } from './paper';

const HOUR = 3_600_000;
const ETH_USD = 2500;
const MINT = '0x1000000000000000000000000000000000000001';

const token = { mint: MINT, name: 'Patient Otter', symbol: 'POTR', lore: '', loreWithheld: false, holders: 20, peakMc: 15_000, status: 'pending', hour: 3, dow: 1, launchedAt: '2026-09-15T00:00:00.000Z', deployer: '', hue: 38 } as Token;
const active: TradeSignal = { score: 0.72, gates: {} as TradeSignal['gates'], blockedBy: null, state: 'active', ageHours: 3, market: { ok: true, reason: null, roundTrip: -0.05, checkedAt: 0 } };

// A sale's value in wei of ETH at the test's ETH price.
const weiFor = (usd: number) => BigInt(Math.round((usd / ETH_USD) * 1e18)).toString();

/**
 * Sell quotes answer from `values` in turn: a number is the USD the ETH returned is worth, 'zero' is a quote that
 * returns no ETH, null is no route, an Error is an outage. Every quote's own USD field says "0" on purpose.
 */
function setup(values: (number | 'zero' | null | Error)[], file: string | null = null) {
  const clock = { now: 1_789_000_000_000 };
  const signals = [{ token, signal: active }];
  const kyber = {
    quote: async (tokenIn: string, tokenOut: string, amountIn: bigint): Promise<Quote | null> => {
      if (tokenIn === NATIVE_ETH) return { summary: { tokenIn, tokenOut, amountIn: amountIn.toString(), amountInUsd: '0', amountOut: '1000', amountOutUsd: '0', gas: '1', gasUsd: '0.07', route: [] }, exchanges: ['pons-v2'] };
      const next = values.shift();
      if (next instanceof Error) throw next;
      if (next == null) return null;
      const amountOut = next === 'zero' ? '0' : weiFor(next);
      return { summary: { tokenIn, tokenOut, amountIn: amountIn.toString(), amountInUsd: '0', amountOut, amountOutUsd: '0', gas: '1', gasUsd: '0.07', route: [] }, exchanges: ['pons-v2'] };
    },
  };
  const paper = new PaperTrader({ signals: () => signals, ethUsd: async () => ETH_USD }, kyber, { file, now: () => clock.now, sleep: async () => {} });
  return { paper, clock };
}

describe('Paper trading', () => {
  it('buys each active signal once at a real quote and takes profit when two checks in a row are past +200%', async () => {
    const { paper } = setup([30, 80, 80]);
    await paper.tick(); // opens, then values it at $30
    expect(paper.list()).toMatchObject([{ mint: MINT, stakeUsd: 25, amountInWei: '10000000000000000', tokens: '1000', score: 0.72 }]);
    expect(paper.list()[0].valueUsd).toBeCloseTo(30, 6);
    await paper.tick(); // $80: past +200% once
    expect(paper.list()[0].exit).toBeUndefined();
    await paper.tick(); // and again: closed
    expect(paper.list()[0]).toMatchObject({ exit: 'take_profit' });
    expect(paper.list()).toHaveLength(1); // never bought twice
    expect(paper.summary()).toMatchObject({ positions: 1, closed: 1, win_rate: 1, pnl_usd: 55, best_pct: 2.2 });
  });

  it('stops out at −40% only when a second check agrees, and closes on the time stop 48h after the buy', async () => {
    const stop = setup([14, 30, 14, 14]);
    await stop.paper.tick(); // below −40% once
    await stop.paper.tick(); // recovered: the count starts over
    await stop.paper.tick();
    expect(stop.paper.list()[0].exit).toBeUndefined();
    await stop.paper.tick();
    expect(stop.paper.list()[0]).toMatchObject({ exit: 'stop_loss' });
    expect(stop.paper.list()[0].valueUsd).toBeCloseTo(14, 6);

    const time = setup([25, 26]);
    await time.paper.tick();
    time.clock.now += 49 * HOUR;
    await time.paper.tick();
    expect(time.paper.list()[0]).toMatchObject({ exit: 'time_stop' });
  });

  it('values a sale by the ETH it returns, and treats a quote that returns none as missed, not as a worthless token', async () => {
    const { paper } = setup(['zero', 'zero', 24]);
    await paper.tick();
    await paper.tick();
    expect(paper.list()[0]).toMatchObject({ missedQuotes: 2 });
    expect(paper.list()[0].exit).toBeUndefined();
    await paper.tick();
    expect(paper.list()[0]).toMatchObject({ missedQuotes: 0 });
    expect(paper.list()[0].valueUsd).toBeCloseTo(24, 6); // though every quote's USD field said "0"
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

  it('keeps the record across restarts, and reopens positions a zero-value quote had stopped out', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'paper-')), 'paper.json');
    const first = setup([30], file);
    await first.paper.tick();
    const saved = JSON.parse(readFileSync(file, 'utf8')) as { version: 1; positions: PaperPosition[] };
    const base = saved.positions[0];
    saved.positions.push(
      { ...base, mint: '0x2000000000000000000000000000000000000002', symbol: 'ZERO', valueUsd: 0, exit: 'stop_loss', closedAt: '2026-09-15T13:50:00.000Z' }, // the valuation bug
      { ...base, mint: '0x3000000000000000000000000000000000000003', symbol: 'TRAP', valueUsd: 0.02, exit: 'stop_loss', closedAt: '2026-09-15T13:50:00.000Z' }, // a real trap sale
    );
    writeFileSync(file, JSON.stringify(saved));

    const again = setup([], file);
    const bySymbol = Object.fromEntries(again.paper.list().map((p) => [p.symbol, p]));
    expect(bySymbol.POTR.valueUsd).toBeCloseTo(30, 6);
    expect(bySymbol.ZERO).toMatchObject({ valueUsd: 25, missedQuotes: 0 });
    expect(bySymbol.ZERO.exit).toBeUndefined();
    expect(bySymbol.TRAP).toMatchObject({ exit: 'stop_loss', valueUsd: 0.02 });
    expect(again.paper.stats.reopened).toBe(1);
  });
});
