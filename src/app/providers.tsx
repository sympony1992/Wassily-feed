'use client';

import { useEffect, type ReactNode } from 'react';
import { startLive } from '@/client/live';
import { isPersonaId } from '@/config/personas';
import { SITE } from '@/config/site';
import { isBoundId } from '@/math/bounds';
import { usePersona, useStore } from '@/store/useStore';

export function Providers({ children }: { children: ReactNode }) {
  const persona = usePersona();

  useEffect(() => {
    // Saved remix choices load after hydration so server and client HTML match.
    void Promise.resolve(useStore.persist.rehydrate()).then(() => {
      const params = new URLSearchParams(window.location.search); // shareable: ?persona=bayes&bound=vc
      const p = params.get('persona');
      const b = params.get('bound');
      if (isPersonaId(p)) useStore.getState().setPersona(p);
      if (b === 'default') useStore.getState().setBound(null);
      else if (isBoundId(b)) useStore.getState().setBound(b);
      startLive();
    });
  }, []);

  useEffect(() => {
    // The theme derives readable light/dark accents from this one value.
    document.documentElement.style.setProperty('--accent-base', persona.accent.base);
    document.title = `${persona.mascot} — Autonomous ${SITE.chain} Token Survival Agent`;
  }, [persona]);

  return children;
}
