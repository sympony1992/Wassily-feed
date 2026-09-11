'use client';

import { ProofPanel } from '@/components/analytics/ProofPanel';
import { FeedCard } from '@/components/overview/FeedCard';
import { GatesCard, WeightsCard } from '@/components/overview/GatesCard';
import { HeroMedia } from '@/components/overview/HeroMedia';
import { JarCard } from '@/components/overview/JarCard';
import { KpiStrip } from '@/components/overview/KpiStrip';
import { PipelineCard } from '@/components/overview/PipelineCard';
import { AppShell } from '@/components/shell/AppShell';
import { Badge } from '@/components/ui/primitives';
import { SITE, fmtUsdK } from '@/config/site';
import type { TypingBlock } from '@/hooks/useTyping';
import { useLiveProof } from '@/hooks/useProof';
import { usePersona, useStore } from '@/store/useStore';

export function OverviewView({ blocks }: { blocks: TypingBlock[] }) {
  const persona = usePersona();
  const proof = useLiveProof();
  const model = useStore((s) => s.model);
  const warming = !model || model.n < 20;

  return (
    <AppShell
      title="Overview"
      description={`${persona.mascot} reads every ${SITE.chain} token that clears ${fmtUsdK(SITE.entryMc)} and only trusts what a provable floor allows.`}
      meta={<Badge tone={proof?.unlocked ? 'positive' : 'accent'}>{proof?.unlocked ? 'Phase 2 · launch unlocked' : warming ? 'Phase 0 · warming up' : 'Phase 1 · learning'}</Badge>}
    >
      <div className="space-y-4">
        <KpiStrip />

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          <div className="xl:col-span-7">
            <HeroMedia />
          </div>
          <div className="xl:col-span-5 [&>*]:h-full">
            <JarCard />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          <div className="xl:col-span-7 [&>*]:h-full">
            <FeedCard />
          </div>
          <div className="space-y-4 xl:col-span-5">
            <GatesCard />
            <WeightsCard />
          </div>
        </div>

        <ProofPanel />

        <PipelineCard blocks={blocks} title="Pipeline source" description="The code running on the server, typed out stage by stage. Opens to play, closes to pause." />
      </div>
    </AppShell>
  );
}
