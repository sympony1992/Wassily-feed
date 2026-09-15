'use client';

import { Dialog } from '@base-ui/react/dialog';
import { useTrade } from '@/store/useTrade';
import { Button } from '../ui/primitives';

/** The optional "ask first" step: shows the quote before the wallet opens. */
export function ConfirmDialog() {
  const confirm = useTrade((s) => s.confirm);
  return (
    <Dialog.Root
      open={!!confirm}
      onOpenChange={(open) => {
        if (!open) confirm?.resolve(false);
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Popup className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-1/2 rounded-xl border border-border bg-surface p-5 shadow-xl">
          <Dialog.Title className="text-base font-semibold text-fg">{confirm?.title}</Dialog.Title>
          <dl className="mt-3 divide-y divide-border rounded-lg border border-border">
            {confirm?.rows.map(([term, value]) => (
              <div key={term} className="flex items-center justify-between gap-3 px-3 py-2">
                <dt className="text-sm text-muted">{term}</dt>
                <dd className="text-right font-mono text-xs text-fg tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          {confirm?.note && <p className="mt-3 text-xs text-pretty text-subtle">{confirm.note}</p>}
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => confirm?.resolve(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => confirm?.resolve(true)}>
              {confirm?.action}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
