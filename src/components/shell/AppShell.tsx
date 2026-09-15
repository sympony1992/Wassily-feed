'use client';

import { Dialog } from '@base-ui/react/dialog';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { SITE, fmtUsdK } from '@/config/site';
import { cn } from '@/lib/cn';
import { useBound, usePersona, useStore } from '@/store/useStore';
import { CopyAddress } from '../layout/CopyAddress';
import { IconBot, IconClose, IconFlask, IconGitHub, IconGrid, IconInfo, IconMenu, IconSparkles, IconTerminal, IconUsers, IconX } from '../ui/Icons';
import { Badge, StatusDot, buttonClass } from '../ui/primitives';
import { ThemeToggle } from './ThemeToggle';

const NAV = [
  { href: '/', label: 'Overview', Icon: IconGrid },
  { href: '/console', label: 'Console', Icon: IconTerminal },
  { href: '/brain', label: 'Brain', Icon: IconSparkles },
  { href: '/lab', label: 'Formula Lab', Icon: IconFlask },
  { href: '/bot', label: 'Trade Bot', Icon: IconBot, soon: true },
  { href: '/about', label: 'About', Icon: IconInfo },
];

// Pages are prerendered before the source is known, so claim neither live nor simulated until /api/state answers.
const SOURCE_COPY = {
  connecting: { label: 'Connecting…', detail: 'Checking the data source', footer: 'Connecting to the data source' },
  simulated: { label: 'Simulated data', detail: 'Not real tokens', footer: 'Simulated data, not real tokens' },
  live: { label: 'Live data', detail: `${SITE.chain}, read on-chain`, footer: `Live ${SITE.chain} data, read on-chain` },
} as const;

function Brand() {
  const persona = usePersona();
  return (
    <Link href="/" className="flex items-center gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-accent">
      <Image src="/logo.jpeg" alt="" width={40} height={40} priority className="size-10 shrink-0 rounded-lg object-cover" />
      <span className="min-w-0">
        <span className="block truncate text-base font-semibold text-fg">{persona.mascot}</span>
        <span className="block truncate text-xs text-muted">
          {persona.role} · <span className="font-mono">{persona.ticker}</span>
        </span>
      </span>
    </Link>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const bound = useBound();
  const source = useStore((s) => s.dataSource);
  const connected = useStore((s) => s.connected);
  const countdown = useStore((s) => s.countdown);

  return (
    <div className="flex h-full flex-col gap-6 p-4">
      <Brand />

      <nav aria-label="Primary" className="flex flex-col gap-0.5">
        {NAV.map(({ href, label, Icon, soon }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-accent',
                active ? 'bg-surface-2 font-medium text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg',
              )}
            >
              <Icon className="size-4" />
              {label}
              {soon && (
                <Badge tone="accent" className="ml-auto">
                  Soon
                </Badge>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-3">
        <div className="rounded-lg border border-border p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-fg">
            <StatusDot tone={source === 'connecting' ? 'neutral' : !connected ? 'negative' : source === 'live' ? 'positive' : 'accent'} />
            {SOURCE_COPY[source].label}
          </div>
          <p className="mt-1 text-xs text-pretty text-muted">
            {SOURCE_COPY[source].detail}
            {source !== 'connecting' && (
              <>
                {' '}
                · next cycle in <span className="font-mono tabular-nums">{countdown}s</span>
              </>
            )}
          </p>
        </div>

        <div className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm">
          <span className="text-muted">Jar formula</span>
          <span className="truncate font-medium text-fg">{bound.short}</span>
        </div>

        <div className="flex items-center justify-between gap-2">
          <ThemeToggle />
          <span className="flex items-center gap-1">
            {SITE.githubUrl && (
              <a href={SITE.githubUrl} target="_blank" rel="noopener noreferrer" aria-label="GitHub repository" title="GitHub repository" className={buttonClass('ghost', 'icon', 'size-8')}>
                <IconGitHub className="size-4" />
              </a>
            )}
            {SITE.xUrl && (
              <a href={SITE.xUrl} target="_blank" rel="noopener noreferrer" aria-label="Follow on X" title="Follow on X" className={buttonClass('ghost', 'icon', 'size-8')}>
                <IconX className="size-4" />
              </a>
            )}
            {SITE.xCommunityUrl && (
              <a href={SITE.xCommunityUrl} target="_blank" rel="noopener noreferrer" aria-label="X Community" title="X Community" className={buttonClass('ghost', 'icon', 'size-8')}>
                <IconUsers className="size-4" />
              </a>
            )}
          </span>
        </div>
        <CopyAddress className="w-full" />
      </div>
    </div>
  );
}

export function AppShell({ title, description, meta, children }: { title: ReactNode; description?: ReactNode; meta?: ReactNode; children: ReactNode }) {
  const persona = usePersona();
  const source = useStore((s) => s.dataSource);
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className="flex min-h-dvh bg-bg text-fg">
      <div className="hidden w-64 shrink-0 border-r border-border bg-surface lg:block">
        <aside className="sticky top-0 h-dvh">
          <SidebarContent />
        </aside>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-surface px-4 pt-[max(0.625rem,env(safe-area-inset-top))] pb-2.5 lg:hidden">
          <Brand />
          <button type="button" onClick={() => setNavOpen(true)} aria-label="Open navigation" className={buttonClass('secondary', 'icon')}>
            <IconMenu />
          </button>
        </div>

        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 pt-6 pb-10 sm:px-6 lg:px-8">
          <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold text-balance text-fg">{title}</h1>
              {description && <p className="mt-1 max-w-3xl text-sm text-pretty text-muted">{description}</p>}
            </div>
            {meta && <div className="flex flex-wrap items-center gap-2">{meta}</div>}
          </header>
          {children}
        </main>

        <footer className="border-t border-border px-4 py-4 text-xs text-pretty text-muted sm:px-6 lg:px-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              {SOURCE_COPY[source].footer} · {persona.mascot} is a mascot, not a financial adviser. It estimates whether a token past{' '}
              {fmtUsdK(SITE.entryMc)} reaches {fmtUsdK(SITE.targetMc)}; it does not predict price.
            </div>
            {(SITE.xCommunityUrl || SITE.xUrl) && (
              <div className="flex shrink-0 items-center gap-4">
                {SITE.xCommunityUrl && (
                  <a
                    href={SITE.xCommunityUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 font-medium text-muted transition-colors hover:text-fg"
                  >
                    <IconUsers className="size-3.5" />
                    <span>X Community</span>
                  </a>
                )}
                {SITE.xUrl && (
                  <a
                    href={SITE.xUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 font-medium text-muted transition-colors hover:text-fg"
                  >
                    <IconX className="size-3.5" />
                    <span>Follow @{persona.mascot}</span>
                  </a>
                )}
              </div>
            )}
          </div>
        </footer>
      </div>

      <Dialog.Root open={navOpen} onOpenChange={(next) => setNavOpen(next)}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/50 lg:hidden" />
          <Dialog.Popup className="fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] border-r border-border bg-surface pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] shadow-xl lg:hidden">
            <Dialog.Title className="sr-only">Navigation</Dialog.Title>
            <Dialog.Close aria-label="Close navigation" className={buttonClass('ghost', 'icon', 'absolute top-3 right-3')}>
              <IconClose />
            </Dialog.Close>
            <SidebarContent onNavigate={() => setNavOpen(false)} />
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
