'use client';

import { IdeasSection } from '@/components/ideas/IdeasSection';
import { AppShell } from '@/components/shell/AppShell';
import { Badge } from '@/components/ui/primitives';
import { SITE } from '@/config/site';
import { usePersona } from '@/store/useStore';

export function BrainView() {
  const persona = usePersona();
  return (
    <AppShell
      title="Brain · idea generation"
      description={`Each cycle ${persona.mascot} writes ${SITE.candidatesPerCycle} candidate tokens (a name, a line of lore and a launch hour) and scores them with that cycle's model. Nothing is held back, the leader included, and every candidate carries the hash it was committed under.`}
      meta={<Badge tone="accent">Phase 1.5</Badge>}
    >
      <IdeasSection />
    </AppShell>
  );
}
