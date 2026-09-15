// Quick buy and sell, end to end in the browser: price on the server, sign in the user's wallet, record what the chain confirmed.
import { QUICK_BUY } from '@/config/bot';
import { dailyPnl, positionsFrom, type Position } from '@/engine/portfolio';
import { KYBER_ROUTER } from '@/server/trade/kyber';
import { useTrade } from '@/store/useTrade';
import { buildSwap, quoteBuy, quoteSell, type SignalJson } from './trade';
import {
  approveCalldata,
  connectWallet,
  discoverWallets,
  ethBalance,
  explorerTx,
  gasPaid,
  receiptOk,
  sendTransaction,
  tokenAllowance,
  tokenBalance,
  tokenDecimals,
  tokensReceived,
  waitForReceipt,
  walletMessage,
  type Eip1193,
} from './wallet';

const SESSION_WALLET_KEY = 'wassily.trade.session-wallet';
const store = () => useTrade.getState();
let unsubscribe: (() => void) | null = null;

const fmtUsd = (v: number) => `$${v.toFixed(2)}`;
const fmtPrice = (v: number) => (v >= 0.01 ? `$${v.toFixed(4)}` : `$${v.toPrecision(3)}`);
const units = (raw: bigint, decimals: number) => Number(raw) / 10 ** decimals;

function provider(): Eip1193 | null {
  const { wallet, wallets } = store();
  return wallet ? (wallets.find((w) => w.id === wallet.id)?.provider ?? null) : null;
}

export async function refreshWallets() {
  const wallets = await discoverWallets();
  store().setWallets(wallets);
  return wallets;
}

function watch(p: Eip1193) {
  unsubscribe?.();
  const onAccounts = (accounts: string[]) => {
    const w = store().wallet;
    if (!w) return;
    if (!accounts?.[0]) disconnectWallet();
    else if (accounts[0].toLowerCase() !== w.address) store().setWallet({ ...w, address: accounts[0].toLowerCase() });
  };
  p.on?.('accountsChanged', onAccounts);
  unsubscribe = () => p.removeListener?.('accountsChanged', onAccounts);
}

export async function connect(walletId: string) {
  const wallets = store().wallets.length ? store().wallets : await refreshWallets();
  const w = wallets.find((x) => x.id === walletId);
  if (!w) return void store().toast({ tone: 'negative', title: 'That wallet is no longer available.' });
  try {
    const address = await connectWallet(w.provider);
    store().setWallet({ id: w.id, name: w.name, address });
    watch(w.provider);
    try {
      window.sessionStorage.setItem(SESSION_WALLET_KEY, w.id);
    } catch {
      // the session simply is not remembered
    }
  } catch (err) {
    store().toast({ tone: 'negative', title: 'Wallet not connected', body: walletMessage(err) });
  }
}

/** Reconnect within the same browser session without a wallet popup, when the wallet still shares the account. */
export async function restoreSession() {
  let id: string | null = null;
  try {
    id = window.sessionStorage.getItem(SESSION_WALLET_KEY);
  } catch {
    return;
  }
  if (!id) return;
  const w = (await refreshWallets()).find((x) => x.id === id);
  if (!w) return;
  try {
    const accounts: string[] = await w.provider.request({ method: 'eth_accounts' });
    if (accounts?.[0]) {
      store().setWallet({ id: w.id, name: w.name, address: accounts[0].toLowerCase() });
      watch(w.provider);
    }
  } catch {
    // stay disconnected
  }
}

export function disconnectWallet() {
  unsubscribe?.();
  unsubscribe = null;
  store().setWallet(null);
  try {
    window.sessionStorage.removeItem(SESSION_WALLET_KEY);
  } catch {
    // nothing to forget
  }
}

/** Why a new buy is not allowed by the user's own limits, or null. */
export function buyLimitReason(mint: string): string | null {
  const { trades } = store();
  const open = positionsFrom(trades).filter((p) => p.open);
  if (!open.some((p) => p.mint === mint) && open.length >= QUICK_BUY.maxOpenPositions) return `You already hold ${QUICK_BUY.maxOpenPositions} positions, the most quick buy allows. Sell one first.`;
  const today = dailyPnl(trades).get(new Date().toISOString().slice(0, 10));
  if (today && -today.pnlUsd >= QUICK_BUY.dailyLossCapUsd) return `Today's realized losses reached the $${QUICK_BUY.dailyLossCapUsd} daily cap. Quick buy reopens tomorrow (UTC).`;
  return null;
}

export async function quickBuy(signal: SignalJson) {
  const s = store();
  const p = provider();
  const mint = signal.mint.toLowerCase();
  if (!s.wallet || !p) return void s.toast({ tone: 'negative', title: 'Connect a wallet first.' });
  if (s.busy[mint]) return;
  const limit = buyLimitReason(mint);
  if (limit) return void s.toast({ tone: 'negative', title: 'Quick buy blocked', body: limit });
  const { amountUsd, slippageBps, confirm } = s.settings;
  const address = s.wallet.address;

  s.setBusy(mint, 'quote');
  try {
    const q = await quoteBuy(mint, amountUsd);
    if (confirm) {
      store().setBusy(mint, 'confirm');
      const ok = await store().requestConfirm({
        title: `Buy $${signal.symbol}`,
        action: `Buy for ${fmtUsd(q.amount_in_usd)}`,
        rows: [
          ['Spend', `${units(BigInt(q.amount_in_wei), 18).toFixed(6)} ETH (${fmtUsd(q.amount_in_usd)})`],
          ['Route', q.exchanges.join(' → ') || 'KyberSwap'],
          ['Slippage', `${slippageBps / 100}%`],
          ['Network fee', `about ${fmtUsd(q.gas_usd)}`],
          ['Wassily score', signal.score == null ? '—' : signal.score.toFixed(3)],
        ],
        note: 'Not financial advice. Trade at your own risk.',
      });
      if (!ok) return;
    }
    const swap = await buildSwap('buy', mint, q.route_summary, address, slippageBps);
    store().setBusy(mint, 'wallet');
    const ask = store().toast({ tone: 'accent', title: `Confirm the $${signal.symbol} buy in your wallet` });
    const hash = await sendTransaction(p, address, swap).finally(() => store().dismiss(ask));
    store().setBusy(mint, 'pending');
    const receipt = await waitForReceipt(p, hash);
    if (!receiptOk(receipt)) return void store().toast({ tone: 'negative', title: `The $${signal.symbol} buy failed on-chain`, body: 'No tokens were bought; only the network fee was spent.', href: explorerTx(hash) });
    const decimals = await tokenDecimals(p, mint);
    let tokens = tokensReceived(receipt, mint, address);
    if (tokens === 0n) tokens = await tokenBalance(p, mint, address).catch(() => 0n);
    const usd = units(BigInt(swap.value), 18) * q.eth_usd;
    store().addTrade({
      id: hash,
      kind: 'buy',
      mint,
      symbol: signal.symbol,
      name: signal.name,
      logo: signal.logo ?? undefined,
      at: Date.now(),
      usd,
      ethWei: swap.value,
      gasWei: gasPaid(receipt).toString(),
      tokens: tokens.toString(),
      decimals,
      ethUsd: q.eth_usd,
      score: signal.score,
    });
    const price = tokens > 0n ? usd / units(tokens, decimals) : 0;
    store().toast({ tone: 'positive', title: `Bought $${signal.symbol} — ${fmtUsd(usd)} at ${fmtPrice(price)}`, body: 'Not financial advice. Trade at your own risk.', href: explorerTx(hash) });
  } catch (err) {
    store().toast({ tone: 'negative', title: `$${signal.symbol} not bought`, body: walletMessage(err) });
  } finally {
    store().setBusy(mint, null);
  }
}

export async function sell(position: Position, percent: number) {
  const s = store();
  const p = provider();
  const mint = position.mint;
  if (!s.wallet || !p) return void s.toast({ tone: 'negative', title: 'Connect a wallet first.' });
  if (s.busy[mint]) return;
  if (!(percent > 0 && percent <= 100)) return void s.toast({ tone: 'negative', title: 'Choose between 1% and 100% to sell.' });
  const { slippageBps, confirm } = s.settings;
  const address = s.wallet.address;

  s.setBusy(mint, 'quote');
  try {
    const balance = await tokenBalance(p, mint, address);
    if (balance === 0n) return void store().toast({ tone: 'negative', title: `This wallet holds no $${position.symbol} anymore.` });
    const amount = percent >= 100 ? balance : (balance * BigInt(Math.round(percent * 100))) / 10_000n;
    const q = await quoteSell(mint, amount);
    if (!q.route || !q.route_summary) return void store().toast({ tone: 'negative', title: `There is no market to sell $${position.symbol} into right now.` });
    if (confirm) {
      store().setBusy(mint, 'confirm');
      const ok = await store().requestConfirm({
        title: `Sell ${percent}% of $${position.symbol}`,
        action: `Sell for about ${fmtUsd(q.amount_out_usd)}`,
        rows: [
          ['Tokens', units(amount, position.decimals).toLocaleString('en-US', { maximumFractionDigits: 2 })],
          ['Expected', `${units(BigInt(q.amount_out_wei), 18).toFixed(6)} ETH (${fmtUsd(q.amount_out_usd)})`],
          ['Route', (q.exchanges ?? []).join(' → ') || 'KyberSwap'],
          ['Slippage', `${slippageBps / 100}%`],
        ],
        note: 'Not financial advice. Trade at your own risk.',
      });
      if (!ok) return;
    }

    const allowance = await tokenAllowance(p, mint, address, KYBER_ROUTER);
    if (allowance < amount) {
      store().setBusy(mint, 'approve');
      const askApprove = store().toast({ tone: 'accent', title: `Approve $${position.symbol} for the KyberSwap router in your wallet`, body: 'Only the amount you are selling is approved.' });
      const approveHash = await sendTransaction(p, address, { to: mint, data: approveCalldata(KYBER_ROUTER, amount), value: '0' }).finally(() => store().dismiss(askApprove));
      const approval = await waitForReceipt(p, approveHash);
      if (!receiptOk(approval)) return void store().toast({ tone: 'negative', title: 'The approval failed on-chain.', href: explorerTx(approveHash) });
    }

    const swap = await buildSwap('sell', mint, q.route_summary, address, slippageBps);
    const before = await ethBalance(p, address);
    store().setBusy(mint, 'wallet');
    const ask = store().toast({ tone: 'accent', title: `Confirm the $${position.symbol} sale in your wallet` });
    const hash = await sendTransaction(p, address, swap).finally(() => store().dismiss(ask));
    store().setBusy(mint, 'pending');
    const receipt = await waitForReceipt(p, hash);
    if (!receiptOk(receipt)) return void store().toast({ tone: 'negative', title: `The $${position.symbol} sale failed on-chain`, body: 'Your tokens were not sold; only the network fee was spent.', href: explorerTx(hash) });
    const after = await ethBalance(p, address);
    let received = after - before + gasPaid(receipt);
    if (received <= 0n) received = BigInt(q.amount_out_wei); // another transaction moved the balance: fall back to the quote
    const ethOut = units(BigInt(q.amount_out_wei), 18);
    const ethUsd = q.eth_usd ?? (ethOut > 0 ? q.amount_out_usd / ethOut : 0);
    const usd = units(received, 18) * ethUsd;
    store().addTrade({
      id: hash,
      kind: 'sell',
      mint,
      symbol: position.symbol,
      name: position.name,
      logo: position.logo,
      at: Date.now(),
      usd,
      ethWei: received.toString(),
      gasWei: gasPaid(receipt).toString(),
      tokens: amount.toString(),
      decimals: position.decimals,
      ethUsd,
    });
    store().toast({ tone: 'positive', title: `Sold ${percent}% of $${position.symbol} for ${fmtUsd(usd)}`, body: 'Not financial advice. Trade at your own risk.', href: explorerTx(hash) });
  } catch (err) {
    store().toast({ tone: 'negative', title: `$${position.symbol} not sold`, body: walletMessage(err) });
  } finally {
    store().setBusy(mint, null);
  }
}

/** What selling a position's tokens would return right now, or null when no market is left. */
export async function positionValue(position: Position): Promise<number | null> {
  if (position.tokens <= 0n) return 0;
  const q = await quoteSell(position.mint, position.tokens);
  return q.route ? q.amount_out_usd : null;
}
