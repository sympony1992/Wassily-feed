import { useState } from 'react';
import { SITE } from '@/config/site';
import { cn } from '@/lib/cn';
import { usePersona } from '@/store/useStore';
import { IconCheck, IconCopy } from '../ui/Icons';

/** Contract address with copy. `overlay` sits on top of media; `inline` follows the theme. */
export function CopyAddress({ variant = 'inline', className }: { variant?: 'overlay' | 'inline'; className?: string }) {
  const persona = usePersona();
  const [copied, setCopied] = useState(false);
  const ca = SITE.contractAddress;
  const base =
    variant === 'overlay'
      ? 'bg-black/65 text-white/90 ring-1 ring-white/15'
      : 'border border-border bg-surface text-muted';

  if (!ca) {
    return (
      <span className={cn('inline-flex max-w-full items-center gap-1.5 rounded-lg px-2.5 py-1 font-mono text-xs', base, className)}>
        <span className="font-semibold">CA</span> not deployed
      </span>
    );
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(ca);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked; the address is still selectable */
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copy ${persona.ticker} contract address`}
      className={cn('inline-flex max-w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1 font-mono text-xs transition-colors duration-150', base, className)}
    >
      <span className="font-semibold">CA</span>
      <span className="truncate select-all">{ca}</span>
      {copied ? <IconCheck className="size-3.5 text-positive" /> : <IconCopy className="size-3.5" />}
      <span className="sr-only" aria-live="polite">
        {copied ? 'Copied' : ''}
      </span>
    </button>
  );
}
