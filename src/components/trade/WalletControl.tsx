'use client';

import { useState } from 'react';
import { connect, disconnectWallet, refreshWallets } from '@/client/tradeActions';
import { ROBINHOOD_CHAIN } from '@/client/wallet';
import { shortHex } from '@/lib/format';
import { useTrade } from '@/store/useTrade';
import { Button, StatusDot } from '../ui/primitives';

/** Connect once per session; the wallet then confirms each trade itself. */
export function WalletControl() {
  const wallet = useTrade((s) => s.wallet);
  const wallets = useTrade((s) => s.wallets);
  const toast = useTrade((s) => s.toast);
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);

  if (wallet) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-sm text-fg">
          <StatusDot tone="positive" />
          <span className="text-muted">{wallet.name}</span>
          <a href={`${ROBINHOOD_CHAIN.explorer}/address/${wallet.address}`} target="_blank" rel="noopener noreferrer" className="font-mono text-xs hover:underline">
            {shortHex(wallet.address)}
          </a>
        </span>
        <Button size="sm" variant="ghost" onClick={disconnectWallet}>
          Disconnect
        </Button>
      </div>
    );
  }

  const start = async () => {
    setBusy(true);
    try {
      const found = await refreshWallets();
      if (!found.length) toast({ tone: 'negative', title: 'No browser wallet found', body: 'Install MetaMask or Rabby, then reload this page.' });
      else if (found.length === 1) await connect(found[0].id);
      else setChoosing(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {!choosing && (
        <Button variant="primary" size="sm" onClick={start} disabled={busy}>
          {busy ? 'Looking for wallets…' : 'Connect wallet'}
        </Button>
      )}
      {choosing && (
        <>
          <span className="text-xs text-muted">Choose a wallet:</span>
          {wallets.map((w) => (
            <Button
              key={w.id}
              size="sm"
              onClick={async () => {
                setChoosing(false);
                await connect(w.id);
              }}
            >
              {w.icon && <img src={w.icon} alt="" className="size-4 rounded-sm" />}
              {w.name}
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setChoosing(false)}>
            Cancel
          </Button>
        </>
      )}
    </div>
  );
}
