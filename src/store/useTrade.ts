import { create } from 'zustand';
import type { WalletInfo } from '@/client/wallet';
import { QUICK_BUY } from '@/config/bot';
import type { TradeRecord } from '@/engine/portfolio';

export interface TradeSettings {
  amountUsd: number;
  slippageBps: number;
  confirm: boolean; // ask on this page before the wallet opens
}

export interface Toast {
  id: number;
  tone: 'positive' | 'negative' | 'accent' | 'neutral';
  title: string;
  body?: string;
  href?: string;
}

export type BusyKind = 'quote' | 'confirm' | 'approve' | 'wallet' | 'pending';

export interface ConfirmRequest {
  title: string;
  rows: [string, string][];
  note?: string;
  action: string;
  resolve: (ok: boolean) => void;
}

interface TradeState {
  ready: boolean; // browser storage has been read (after mount, so server and client render the same first)
  settings: TradeSettings;
  disclaimerAt: number | null;
  wallets: WalletInfo[];
  wallet: { id: string; name: string; address: string } | null;
  trades: TradeRecord[]; // for the connected address
  busy: Record<string, BusyKind>;
  toasts: Toast[];
  confirm: ConfirmRequest | null;

  init: () => void;
  setSettings: (p: Partial<TradeSettings>) => void;
  acceptDisclaimer: () => void;
  setWallets: (wallets: WalletInfo[]) => void;
  setWallet: (wallet: TradeState['wallet']) => void;
  addTrade: (t: TradeRecord) => void;
  setBusy: (mint: string, kind: BusyKind | null) => void;
  toast: (t: Omit<Toast, 'id'>) => number;
  dismiss: (id: number) => void;
  requestConfirm: (c: Omit<ConfirmRequest, 'resolve'>) => Promise<boolean>;
}

const SETTINGS_KEY = 'wassily.trade.settings.v1';
const DISCLAIMER_KEY = 'wassily.trade.disclaimer.v1';
const tradesKey = (address: string) => `wassily.trade.trades.v1.${address.toLowerCase()}`;

// Storage can be missing or throw (private windows, blocked site data): every read and write is guarded.
function read<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // the page keeps working without persistence
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function cleanSettings(s: Partial<TradeSettings> | null | undefined): TradeSettings {
  const amount = Number(s?.amountUsd);
  const slippage = Number(s?.slippageBps);
  return {
    amountUsd: Number.isFinite(amount) ? clamp(Math.round(amount), QUICK_BUY.minUsd, QUICK_BUY.maxUsd) : QUICK_BUY.defaultUsd,
    slippageBps: Number.isFinite(slippage) ? clamp(Math.round(slippage), QUICK_BUY.minSlippageBps, QUICK_BUY.maxSlippageBps) : QUICK_BUY.defaultSlippageBps,
    confirm: typeof s?.confirm === 'boolean' ? s.confirm : false,
  };
}

function loadTrades(address: string): TradeRecord[] {
  const list = read<TradeRecord[]>(tradesKey(address));
  return Array.isArray(list) ? list.filter((t) => t && typeof t.id === 'string' && (t.kind === 'buy' || t.kind === 'sell')) : [];
}

let toastId = 0;

export const useTrade = create<TradeState>()((set, get) => ({
  ready: false,
  settings: cleanSettings(null),
  disclaimerAt: null,
  wallets: [],
  wallet: null,
  trades: [],
  busy: {},
  toasts: [],
  confirm: null,

  init: () => {
    if (get().ready) return;
    const accepted = read<number>(DISCLAIMER_KEY);
    set({ ready: true, settings: cleanSettings(read<TradeSettings>(SETTINGS_KEY)), disclaimerAt: typeof accepted === 'number' ? accepted : null });
  },
  setSettings: (p) => {
    const settings = cleanSettings({ ...get().settings, ...p });
    write(SETTINGS_KEY, settings);
    set({ settings });
  },
  acceptDisclaimer: () => {
    const at = Date.now();
    write(DISCLAIMER_KEY, at);
    set({ disclaimerAt: at });
  },
  setWallets: (wallets) => set({ wallets }),
  setWallet: (wallet) => set({ wallet, trades: wallet ? loadTrades(wallet.address) : [] }),
  addTrade: (t) => {
    const { wallet, trades } = get();
    if (!wallet || trades.some((x) => x.id === t.id)) return;
    const next = [...trades, t];
    write(tradesKey(wallet.address), next);
    set({ trades: next });
  },
  setBusy: (mint, kind) =>
    set((s) => {
      const busy = { ...s.busy };
      if (kind) busy[mint] = kind;
      else delete busy[mint];
      return { busy };
    }),
  toast: (t) => {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts.slice(-4), { ...t, id }] }));
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  requestConfirm: (c) =>
    new Promise<boolean>((resolve) => {
      get().confirm?.resolve(false); // a newer request replaces an open one
      set({
        confirm: {
          ...c,
          resolve: (ok) => {
            set({ confirm: null });
            resolve(ok);
          },
        },
      });
    }),
}));
