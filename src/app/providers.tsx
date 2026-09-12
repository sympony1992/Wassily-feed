'use client';

import { useEffect, type ReactNode } from 'react';
import { startLive } from '@/client/live';
import { SITE } from '@/config/site';
import { usePersona } from '@/store/useStore';

// Persona and formula choices saved by the old Remix dialog; the site now runs one agent.
const LEGACY_REMIX_KEY = 'survival-agent:remix';

export function Providers({ children }: { children: ReactNode }) {
  const persona = usePersona();

  useEffect(() => {
    try {
      localStorage.removeItem(LEGACY_REMIX_KEY);
    } catch {
      /* storage blocked */
    }
    startLive();
  }, []);

  useEffect(() => {
    // The theme derives readable light/dark accents from this one value.
    document.documentElement.style.setProperty('--accent-base', persona.accent.base);
  }, [persona]);

  // React 19 hoists <title> into <head> and keeps it in sync; setting document.title
  // imperatively would be overwritten when Next.js commits its metadata.
  return (
    <>
      <title>{`${persona.mascot} — Autonomous ${SITE.chain} Token Survival Agent`}</title>
      {children}
    </>
  );
}
