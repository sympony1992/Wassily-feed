'use client';

import { Dialog } from '@base-ui/react/dialog';
import { useState } from 'react';
import { QUICK_BUY } from '@/config/bot';
import { usePersona } from '@/store/useStore';
import { Button } from '../ui/primitives';

/** Shown once before a wallet's first quick buy; nothing is bought until it is accepted. */
export function DisclaimerDialog({ open, onClose, onAccept }: { open: boolean; onClose: () => void; onAccept: () => void }) {
  const persona = usePersona();
  const [checked, setChecked] = useState(false);
  const points = [
    `${persona.mascot} is a mascot, not a financial adviser. It measures survival, not price.`,
    'A full jar means the model ranks tokens better than a coin flip. It does not mean any token will rise. Most memecoins lose value, and you can lose everything you put in.',
    'Every trade is signed in your own wallet. This site never holds your keys or funds and cannot reverse a transaction.',
    'Swaps route through KyberSwap. The price can move between the quote and your confirmation; slippage and network fees apply.',
    `The limits here ($${QUICK_BUY.minUsd}–$${QUICK_BUY.maxUsd} a trade, ${QUICK_BUY.maxOpenPositions} open positions, a $${QUICK_BUY.dailyLossCapUsd} daily loss cap) only cover trades made on this page.`,
  ];

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Popup className="fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-1/2 overflow-y-auto rounded-xl border border-border bg-surface p-5 shadow-xl">
          <Dialog.Title className="text-base font-semibold text-fg">Before your first quick buy</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-pretty text-muted">Not financial advice. Trade at your own risk.</Dialog.Description>
          <ul className="mt-4 space-y-2.5 text-sm text-pretty text-muted">
            {points.map((p) => (
              <li key={p} className="flex gap-2">
                <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" />
                <span>{p}</span>
              </li>
            ))}
          </ul>
          <label className="mt-5 flex cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-sm text-fg">
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-0.5 size-4 accent-[var(--color-accent)]" />
            <span>I understand these risks and accept them.</span>
          </label>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!checked} onClick={onAccept}>
              Accept and continue
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
