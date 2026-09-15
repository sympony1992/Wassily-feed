'use client';

import { useEffect } from 'react';
import { cn } from '@/lib/cn';
import { useTrade, type Toast } from '@/store/useTrade';
import { IconClose } from '../ui/Icons';
import { buttonClass } from '../ui/primitives';

const EDGE: Record<Toast['tone'], string> = {
  positive: 'border-l-positive',
  negative: 'border-l-negative',
  accent: 'border-l-accent',
  neutral: 'border-l-border-strong',
};

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useTrade((s) => s.dismiss);
  useEffect(() => {
    const t = setTimeout(() => dismiss(toast.id), toast.tone === 'negative' ? 14_000 : 9_000);
    return () => clearTimeout(t);
  }, [toast.id, toast.tone, dismiss]);

  return (
    <li className={cn('flex items-start gap-3 rounded-xl border border-l-4 border-border bg-surface px-3.5 py-3 shadow-lg', EDGE[toast.tone])}>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-pretty text-fg">{toast.title}</p>
        {toast.body && <p className="mt-0.5 text-xs text-pretty text-muted">{toast.body}</p>}
        {toast.href && (
          <a href={toast.href} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-xs font-medium text-accent hover:underline">
            View transaction
          </a>
        )}
      </div>
      <button type="button" onClick={() => dismiss(toast.id)} aria-label="Dismiss" className={buttonClass('ghost', 'icon', 'size-7 shrink-0')}>
        <IconClose className="size-3.5" />
      </button>
    </li>
  );
}

/** Trade progress and receipts, bottom corner, newest last. */
export function TradeToasts() {
  const toasts = useTrade((s) => s.toasts);
  return (
    <ol aria-live="polite" className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col gap-2 sm:left-auto sm:w-96 [&>li]:pointer-events-auto">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </ol>
  );
}
