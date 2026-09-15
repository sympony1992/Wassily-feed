import { describe, expect, it } from 'vitest';
import { dailyPnl, exitAlerts, positionsFrom, streaks, tradesCsv, type TradeRecord } from './portfolio';

const HOUR = 3_600_000;
const T0 = Date.parse('2026-09-15T10:00:00Z');
const E18 = 10n ** 18n;

const trade = (kind: 'buy' | 'sell', at: number, tokens: bigint, usd: number, mint = '0xaaa', id = `${kind}-${at}`): TradeRecord => ({
  id,
  kind,
  mint,
  symbol: 'WASS',
  name: 'Wassily Agent',
  at,
  usd,
  ethWei: '10000000000000000',
  gasWei: '30000000000000',
  tokens: tokens.toString(),
  decimals: 18,
  ethUsd: 2500,
  score: kind === 'buy' ? 0.7 : null,
});

describe('Portfolio', () => {
  it('keeps an average cost basis and books realized profit on partial sales', () => {
    const trades = [trade('buy', T0, 1000n * E18, 25), trade('buy', T0 + HOUR, 1000n * E18, 15), trade('sell', T0 + 2 * HOUR, 500n * E18, 30)];
    const [p] = positionsFrom(trades);
    expect(p.tokens).toBe(1500n * E18);
    expect(p.investedUsd).toBe(40);
    expect(p.realizedUsd).toBeCloseTo(30 - 10, 10); // a quarter of the $40 basis left with the sale
    expect(p.costUsd).toBeCloseTo(30, 10);
    expect(p.entryPriceUsd).toBeCloseTo(0.02, 10);
    expect(p.open).toBe(true);
  });

  it('closes a position that sold everything', () => {
    const [p] = positionsFrom([trade('buy', T0, 100n, 25), trade('sell', T0 + HOUR, 100n, 10)]);
    expect(p).toMatchObject({ open: false, tokens: 0n, realizedUsd: -15 });
  });

  it('alerts on +200%, −40% and 48 hours held, and never on a closed position', () => {
    const [p] = positionsFrom([trade('buy', T0, 100n, 25)]);
    expect(exitAlerts(p, 80, T0 + HOUR)).toEqual(['take_profit']);
    expect(exitAlerts(p, 14, T0 + HOUR)).toEqual(['stop_loss']);
    expect(exitAlerts(p, 25, T0 + 49 * HOUR)).toEqual(['time_stop']);
    expect(exitAlerts(p, 25, T0 + HOUR)).toEqual([]);
    const [closed] = positionsFrom([trade('buy', T0, 100n, 25), trade('sell', T0 + HOUR, 100n, 10)]);
    expect(exitAlerts(closed, 0, T0 + 49 * HOUR)).toEqual([]);
  });

  it('books realized PnL on the UTC day of each sale and counts every trade', () => {
    const day2 = Date.parse('2026-09-16T01:00:00Z');
    const days = dailyPnl([trade('buy', T0, 100n, 25), trade('sell', day2, 50n, 20), trade('buy', day2 + HOUR, 10n, 10, '0xbbb'), trade('sell', day2 + 2 * HOUR, 10n, 4, '0xbbb')]);
    expect(days.get('2026-09-15')).toMatchObject({ pnlUsd: 0, trades: 1, wins: 0, losses: 0 });
    expect(days.get('2026-09-16')).toMatchObject({ trades: 3, wins: 1, losses: 1 });
    expect(days.get('2026-09-16')!.pnlUsd).toBeCloseTo(7.5 - 6, 10);
  });

  it('counts winning and losing streaks over days with results', () => {
    const d = (date: string, pnlUsd: number) => ({ date, pnlUsd, trades: 1, wins: pnlUsd > 0 ? 1 : 0, losses: pnlUsd < 0 ? 1 : 0, entries: [] });
    expect(streaks([d('2026-09-01', 5), d('2026-09-02', 3), d('2026-09-03', -1), d('2026-09-04', 2), d('2026-09-05', 4)])).toEqual({ current: 2, best: 2 });
    expect(streaks([d('2026-09-01', 5), d('2026-09-02', -3), d('2026-09-03', -1)])).toEqual({ current: -2, best: 1 });
  });

  it('exports every trade as CSV with whole-token amounts', () => {
    const csv = tradesCsv([trade('buy', T0, 1500n * E18, 25)]);
    const [header, row] = csv.replace(/^﻿/, '').split('\r\n');
    expect(header).toBe('time_utc,kind,symbol,name,token,tokens,usd,eth,gas_eth,eth_usd,score,tx');
    expect(row).toBe(`2026-09-15T10:00:00.000Z,buy,WASS,Wassily Agent,0xaaa,1500,25.00,0.01,0.00003,2500.00,0.7000,buy-${T0}`);
  });
});
