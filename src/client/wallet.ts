/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The user's own browser wallet, reached through the standard provider interface (EIP-1193) and found with EIP-6963
 * announcements. Every transaction is signed and sent by that wallet: nothing on this page or the server sees a key.
 */

export interface Eip1193 {
  request(args: { method: string; params?: unknown[] | Record<string, unknown> }): Promise<any>;
  on?(event: string, listener: (...args: any[]) => void): void;
  removeListener?(event: string, listener: (...args: any[]) => void): void;
}

export interface WalletInfo {
  id: string;
  name: string;
  icon?: string;
  provider: Eip1193;
}

export interface Receipt {
  status: string;
  blockNumber: string;
  gasUsed: string;
  effectiveGasPrice?: string;
  logs: { address: string; topics: string[]; data: string }[];
}

export const ROBINHOOD_CHAIN = {
  id: 4663,
  idHex: '0x1237',
  name: 'Robinhood Chain',
  rpcUrl: 'https://rpc.mainnet.chain.robinhood.com',
  explorer: 'https://robinhoodchain.blockscout.com',
} as const;

export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

export class WalletError extends Error {}

const pad = (hex: string) => hex.replace(/^0x/, '').toLowerCase().padStart(64, '0');
const toHex = (v: bigint) => `0x${v.toString(16)}`;

/** Wallets that announced themselves, or the injected `window.ethereum` when none did. */
export function discoverWallets(waitMs = 350): Promise<WalletInfo[]> {
  if (typeof window === 'undefined') return Promise.resolve([]);
  const found = new Map<string, WalletInfo>();
  const onAnnounce = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    if (detail?.info?.uuid && detail.provider) found.set(detail.info.uuid, { id: detail.info.uuid, name: String(detail.info.name ?? 'Wallet'), icon: detail.info.icon, provider: detail.provider });
  };
  window.addEventListener('eip6963:announceProvider', onAnnounce);
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  return new Promise((resolve) =>
    setTimeout(() => {
      window.removeEventListener('eip6963:announceProvider', onAnnounce);
      const injected = (window as any).ethereum as (Eip1193 & { isRabby?: boolean; isMetaMask?: boolean }) | undefined;
      if (!found.size && injected?.request) found.set('injected', { id: 'injected', name: injected.isRabby ? 'Rabby' : injected.isMetaMask ? 'MetaMask' : 'Browser wallet', provider: injected });
      resolve([...found.values()]);
    }, waitMs),
  );
}

/** Plain words for the errors wallets return. */
export function walletMessage(err: unknown): string {
  const e = err as { code?: number; message?: string };
  if (e?.code === 4001) return 'You declined the request in your wallet.';
  if (e?.code === -32002) return 'Your wallet already has a request open. Check the wallet window.';
  if (err instanceof WalletError) return err.message;
  return String(e?.message ?? err).slice(0, 180) || 'The wallet did not answer.';
}

export async function connectWallet(provider: Eip1193): Promise<string> {
  const accounts: string[] = await provider.request({ method: 'eth_requestAccounts' });
  if (!accounts?.[0]) throw new WalletError('The wallet shared no account.');
  await ensureChain(provider);
  return accounts[0].toLowerCase();
}

/** Switch the wallet to Robinhood Chain, adding the network first when the wallet does not know it. */
export async function ensureChain(provider: Eip1193) {
  const current = String(await provider.request({ method: 'eth_chainId' })).toLowerCase();
  if (current === ROBINHOOD_CHAIN.idHex) return;
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: ROBINHOOD_CHAIN.idHex }] });
  } catch (err) {
    const e = err as { code?: number; message?: string };
    if (e?.code !== 4902 && !/unrecognized|not added|unknown chain|not been added/i.test(String(e?.message))) throw err;
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId: ROBINHOOD_CHAIN.idHex,
          chainName: ROBINHOOD_CHAIN.name,
          nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
          rpcUrls: [ROBINHOOD_CHAIN.rpcUrl],
          blockExplorerUrls: [ROBINHOOD_CHAIN.explorer],
        },
      ],
    });
  }
  const after = String(await provider.request({ method: 'eth_chainId' })).toLowerCase();
  if (after !== ROBINHOOD_CHAIN.idHex) throw new WalletError(`Switch your wallet to ${ROBINHOOD_CHAIN.name} to trade.`);
}

/** Hands the transaction to the wallet, which asks the user to confirm it. Returns the transaction hash. */
export async function sendTransaction(provider: Eip1193, from: string, tx: { to: string; data: string; value: string }): Promise<string> {
  await ensureChain(provider);
  const hash: string = await provider.request({ method: 'eth_sendTransaction', params: [{ from, to: tx.to, data: tx.data, value: toHex(BigInt(tx.value)) }] });
  if (!/^0x[0-9a-f]{64}$/i.test(String(hash))) throw new WalletError('The wallet returned no transaction hash.');
  return hash;
}

export async function waitForReceipt(provider: Eip1193, hash: string, timeoutMs = 180_000, pollMs = 1_500): Promise<Receipt> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const receipt: Receipt | null = await provider.request({ method: 'eth_getTransactionReceipt', params: [hash] }).catch(() => null);
    if (receipt?.blockNumber) return receipt;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new WalletError('The transaction is taking long to confirm. Check it in the explorer.');
}

export const receiptOk = (r: Receipt) => BigInt(r.status) === 1n;
export const gasPaid = (r: Receipt) => BigInt(r.gasUsed) * BigInt(r.effectiveGasPrice ?? '0x0');

/** Token units `owner` received in this transaction, read from the token's own Transfer events. */
export function tokensReceived(r: Receipt, token: string, owner: string): bigint {
  const t = token.toLowerCase();
  const to = `0x${pad(owner)}`;
  return r.logs
    .filter((l) => l.address.toLowerCase() === t && l.topics[0] === TRANSFER_TOPIC && l.topics[2]?.toLowerCase() === to)
    .reduce((sum, l) => sum + BigInt(l.data.slice(0, 66)), 0n);
}

const call = async (provider: Eip1193, to: string, data: string) => String(await provider.request({ method: 'eth_call', params: [{ to, data }, 'latest'] }));

export async function tokenBalance(provider: Eip1193, token: string, owner: string): Promise<bigint> {
  const out = await call(provider, token, `0x70a08231${pad(owner)}`);
  return out.length >= 66 ? BigInt(out.slice(0, 66)) : 0n;
}

export async function tokenAllowance(provider: Eip1193, token: string, owner: string, spender: string): Promise<bigint> {
  const out = await call(provider, token, `0xdd62ed3e${pad(owner)}${pad(spender)}`);
  return out.length >= 66 ? BigInt(out.slice(0, 66)) : 0n;
}

export async function tokenDecimals(provider: Eip1193, token: string): Promise<number> {
  try {
    const out = await call(provider, token, '0x313ce567');
    const places = out.length >= 66 ? Number(BigInt(out.slice(0, 66))) : 18;
    return places <= 36 ? places : 18;
  } catch {
    return 18;
  }
}

export async function ethBalance(provider: Eip1193, owner: string): Promise<bigint> {
  return BigInt(await provider.request({ method: 'eth_getBalance', params: [owner, 'latest'] }));
}

/** approve(spender, amount): exactly the amount being sold, never an unlimited allowance. */
export const approveCalldata = (spender: string, amount: bigint) => `0x095ea7b3${pad(spender)}${amount.toString(16).padStart(64, '0')}`;

export const explorerTx = (hash: string) => `${ROBINHOOD_CHAIN.explorer}/tx/${hash}`;
