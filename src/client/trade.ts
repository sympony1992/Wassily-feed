/* eslint-disable @typescript-eslint/no-explicit-any */
// Same-origin calls to the trade endpoints. The server prices routes and builds unsigned swaps; the wallet signs.
import type { SignalGate, SignalState } from '@/engine/tradeSignal';

export interface SignalJson {
  mint: string;
  name: string;
  symbol: string;
  logo: string | null;
  launched_at: string;
  launch_hour: number;
  holders: number | null;
  peak_mc: number;
  status: string;
  score: number | null;
  state: SignalState;
  blocked_by: SignalGate | null;
  gates: Record<SignalGate, boolean>;
  age_hours: number;
}

export interface SignalsResponse {
  quick_buy: { enabled: boolean; reason: string | null; jar_unlocked: boolean };
  counts: { watching: number; active: number; locked: number; scored: number };
  signals: SignalJson[];
}

export interface PaperPositionJson {
  mint: string;
  name: string;
  symbol: string;
  logo: string | null;
  score: number;
  opened_at: string;
  stake_usd: number;
  value_usd: number;
  pnl_pct: number;
  exchanges: string[];
  checked_at: string;
  closed_at: string | null;
  exit: 'take_profit' | 'stop_loss' | 'time_stop' | 'no_route' | null;
}

export interface PaperResponse {
  enabled: boolean;
  summary: {
    positions: number;
    open: number;
    closed: number;
    invested_usd: number;
    value_usd: number;
    pnl_usd: number;
    pnl_pct: number;
    win_rate: number | null;
    best_pct: number | null;
    worst_pct: number | null;
    stake_usd: number;
    last_tick_at: string | null;
  } | null;
  positions: PaperPositionJson[];
}

export interface BuyQuote {
  route_summary: Record<string, unknown>;
  exchanges: string[];
  amount_in_wei: string;
  amount_in_usd: number;
  amount_out: string;
  gas_usd: number;
  eth_usd: number;
}

export interface SellQuote {
  route: boolean;
  route_summary?: Record<string, unknown>;
  exchanges?: string[];
  amount_out_wei: string;
  amount_out_usd: number;
  gas_usd?: number;
}

export interface UnsignedSwap {
  to: string;
  data: string;
  value: string;
  amount_out: string;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: 'no-store' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as any).error ?? `HTTP ${res.status}`);
  return body as T;
}

async function postJson<T>(path: string, payload: unknown): Promise<T> {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), cache: 'no-store' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as any).error ?? `HTTP ${res.status}`);
  return body as T;
}

export const fetchSignals = () => getJson<SignalsResponse>('/api/trade/signals');
export const fetchPaper = () => getJson<PaperResponse>('/api/trade/paper');
export const quoteBuy = (token: string, usd: number) => postJson<BuyQuote>('/api/trade/quote', { side: 'buy', token, usd });
export const quoteSell = (token: string, amount: bigint) => postJson<SellQuote>('/api/trade/quote', { side: 'sell', token, amount: amount.toString() });
export const buildSwap = (side: 'buy' | 'sell', token: string, routeSummary: Record<string, unknown>, sender: string, slippageBps: number) =>
  postJson<UnsignedSwap>('/api/trade/build', { side, token, route_summary: routeSummary, sender, slippage_bps: slippageBps });
