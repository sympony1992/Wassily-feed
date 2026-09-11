import { Dialog } from '@base-ui/react/dialog';
import { useState } from 'react';
import Link from 'next/link';
import { PERSONAS, PERSONA_BY_ID } from '@/config/personas';
import { evaluateModel } from '@/engine/proof';
import { cn } from '@/lib/cn';
import { BOUNDS, BOUND_BY_ID, type BoundId } from '@/math/bounds';
import { useStore } from '@/store/useStore';
import { IconClose, IconCopy } from '../ui/Icons';
import { PersonaMark } from '../ui/PersonaMark';
import { buttonClass } from '../ui/primitives';

export function RemixDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const personaId = useStore((s) => s.personaId);
  const boundId = useStore((s) => s.boundId);
  const model = useStore((s) => s.model);
  const setPersona = useStore((s) => s.setPersona);
  const setBound = useStore((s) => s.setBound);
  const [copied, setCopied] = useState(false);
  const persona = PERSONA_BY_ID[personaId];

  const origin = typeof window === 'undefined' ? '' : `${window.location.origin}${window.location.pathname}`;
  const shareUrl = `${origin}?persona=${personaId}&bound=${boundId ?? 'default'}`;
  const copyShare = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked */
    }
  };
  const preview = (id: BoundId) => (model ? evaluateModel(model, BOUND_BY_ID[id]) : null);

  return (
    <Dialog.Root open={open} onOpenChange={(next) => onOpenChange(next)}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Popup className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-5xl -translate-1/2 flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-xl">
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div>
              <Dialog.Title className="text-base font-semibold text-balance text-fg">Remix the agent</Dialog.Title>
              <Dialog.Description className="mt-0.5 text-sm text-pretty text-muted">
                Pick a mathematician for the persona and a bound for the jar. Every number on the site recomputes.
              </Dialog.Description>
            </div>
            <Dialog.Close className={buttonClass('ghost', 'icon')} aria-label="Close">
              <IconClose />
            </Dialog.Close>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-1 divide-y divide-border overflow-y-auto lg:grid-cols-2 lg:divide-x lg:divide-y-0">
            <section className="p-5">
              <h3 className="mb-3 text-xs font-medium text-muted">Persona</h3>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {PERSONAS.map((p) => {
                  const active = p.id === personaId;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPersona(p.id)}
                      aria-pressed={active}
                      className={cn(
                        'flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-left transition-colors duration-150',
                        active ? 'border-accent bg-accent-soft' : 'border-border hover:bg-surface-2',
                      )}
                    >
                      <PersonaMark persona={p} className="size-10" />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-fg">
                          {p.mascot} <span className="font-mono text-xs text-muted">{p.ticker}</span>
                        </span>
                        <span className="block truncate text-xs text-muted">
                          {p.mathematician} · {p.life}
                        </span>
                        <span className="mt-1 block text-xs text-subtle">Default: {BOUND_BY_ID[p.defaultBound].short}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="p-5">
              <h3 className="mb-3 text-xs font-medium text-muted">Bound formula</h3>
              <div className="flex flex-col gap-1.5">
                {[null, ...BOUNDS.map((b) => b.id)].map((id) => {
                  const effective = id ?? persona.defaultBound;
                  const b = BOUND_BY_ID[effective];
                  const active = boundId === id;
                  const p = preview(effective);
                  return (
                    <button
                      key={id ?? 'default'}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setBound(id)}
                      className={cn(
                        'grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors duration-150',
                        active ? 'border-accent bg-accent-soft' : 'border-border hover:bg-surface-2',
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-fg">{id ? b.name : `Persona default · ${b.short}`}</span>
                        <span className="block truncate text-xs text-muted">
                          {b.credit} · {b.year}
                        </span>
                      </span>
                      <span className="text-right font-mono text-xs tabular-nums">
                        {p ? (
                          <>
                            <span className="block text-fg">floor {p.pending ? '…' : p.floor.toFixed(3)}</span>
                            <span className="block text-muted">jar {(p.jar * 100).toFixed(0)}%</span>
                          </>
                        ) : (
                          <span className="text-subtle">training…</span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3">
            <span className="min-w-0 truncate font-mono text-xs text-muted">{shareUrl}</span>
            <span className="flex gap-2">
              <button type="button" onClick={copyShare} className={buttonClass('secondary', 'sm')}>
                <IconCopy className="size-3.5" /> {copied ? 'Copied' : 'Copy link'}
              </button>
              <Link href="/lab" onClick={() => onOpenChange(false)} className={buttonClass('primary', 'sm')}>
                Compare in the Lab
              </Link>
            </span>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
