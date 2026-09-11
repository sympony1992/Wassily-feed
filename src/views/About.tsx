'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { Formula } from '@/components/ui/Formula';
import { IconDownload, IconFileCode, IconWarning } from '@/components/ui/Icons';
import { Card, CardHeader, buttonClass } from '@/components/ui/primitives';
import { SITE, fmtUsdK } from '@/config/site';
import { saveFile } from '@/lib/download';
import { fmtInt } from '@/lib/format';
import { useBound, usePersona, useStore } from '@/store/useStore';

export function AboutView() {
  const persona = usePersona();
  const bound = useBound();
  const live = useStore((s) => s.dataSource) === 'live';
  const labelled = useStore((s) => s.tally.all);
  const [method, setMethod] = useState<string | null>(null);
  const [showMethod, setShowMethod] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleMethod = async () => {
    if (showMethod) return setShowMethod(false);
    setShowMethod(true);
    if (method) return;
    try {
      const res = await fetch('/api/methodology.json', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMethod(JSON.stringify(await res.json(), null, 2));
      setError(null);
    } catch (err) {
      setError(`Could not load methodology.json (${(err as Error).message}). Try again.`);
    }
  };

  return (
    <AppShell title="About" description="Methodology, the maths behind the jar, and the data to check it yourself.">
      <div className="max-w-3xl space-y-6">
        <div className="flex gap-3 rounded-xl border border-accent/30 bg-accent-soft px-4 py-4" role="note">
          <IconWarning className="mt-0.5 size-4 text-fg" />
          <div className="text-sm text-fg">
            <h2 className="font-semibold">What {persona.mascot} is not</h2>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-pretty text-muted">
              <li>
                It <b className="text-fg">does not predict price</b>. It estimates whether a token that already reached {fmtUsdK(SITE.entryMc)} goes on to reach {fmtUsdK(SITE.targetMc)}.
              </li>
              <li>
                It <b className="text-fg">has no edge that guarantees returns</b>. A handful of features cannot forecast a market.
              </li>
              <li>
                The jar <b className="text-fg">is not decoration</b>. If the model is weak, the jar stays empty and the site names the gate that blocks it.
              </li>
            </ul>
          </div>
        </div>

        <Section title={`1. ${persona.origin.title}`}>{persona.origin.body}</Section>
        <Section title={`2. Why it fits ${SITE.chain}`}>{persona.fit}</Section>
        <Section title={`3. What ${persona.mascot} measures`}>
          Every token on {SITE.chain} DEX pools that reaches <b className="text-fg">${fmtInt(SITE.entryMc)} peak market cap</b> joins the study. {persona.mascot} records whether it reaches{' '}
          <b className="text-fg">${fmtInt(SITE.targetMc)} peak market cap</b>, using four feature families: launch hour (sine and cosine), day of week, a holder count sampled once at{' '}
          {SITE.holderSampleHours} hours, and the lore text (length, a missing flag, words in the name, and a 15-bucket hashed bag of words). That makes d = {SITE.capacityD}. Nothing derived from price,
          volume or liquidity is ever a feature.
        </Section>

        <Card>
          <CardHeader title="4. Why the jar fills slowly" description={`${bound.name} · ${bound.credit}, ${bound.year}`} />
          <div className="space-y-4 px-5 py-4 text-sm text-pretty text-muted">
            <p>A model can look good by luck on a small sample, so the jar is driven by a proven floor, the cross-validated AUC minus a penalty ε, never by the raw score.</p>
            <div className="overflow-x-auto rounded-lg border border-border bg-surface-2 px-3 py-3 text-fg">
              <Formula latex={bound.latex} />
            </div>
            <p>{bound.summary}</p>
            <p>
              Jar = <code className="font-mono text-fg">clamp((floor − {SITE.aucFloor}) / ({SITE.aucTarget} − {SITE.aucFloor}), 0, 1)</code>, capped at {SITE.gates.jarCapWhenBlocked * 100}% until
              all four gates pass: n ≥ {fmtInt(SITE.gates.nSamplesMin)}, n₊ ≥ {fmtInt(SITE.gates.nPositiveMin)}, fold σ &lt; {SITE.gates.aucStdMax}, and a time-split gap ≤{' '}
              {SITE.gates.timeSplitGapMax}. For the VC bound, d = {SITE.capacityD} is a chosen capacity parameter (the feature count), not a derived VC dimension.
            </p>
            <Link href="/lab" className="inline-block font-medium text-accent hover:underline">
              Compare all nine formulas in the Formula Lab
            </Link>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="5. Check the work"
            description={live ? `Real ${SITE.chain} tokens collected by this server` : 'This server is running the simulated market'}
          />
          <div className="space-y-4 px-5 py-4">
            <p className="text-sm text-pretty text-muted">Download every labelled token, rerun the model, and check whether the jar is honest.</p>
            <div className="flex flex-wrap gap-2">
              <a href="/api/dataset.csv" download className={buttonClass('primary', 'md')}>
                <IconDownload className="size-4" /> Download dataset.csv ({fmtInt(labelled)} rows)
              </a>
              <button type="button" onClick={toggleMethod} aria-expanded={showMethod} className={buttonClass('secondary', 'md')}>
                <IconFileCode className="size-4" /> {showMethod ? 'Hide' : 'View'} methodology.json
              </button>
              {showMethod && method && (
                <button type="button" onClick={() => saveFile('methodology.json', method, 'application/json')} className={buttonClass('ghost', 'md')}>
                  Save file
                </button>
              )}
            </div>
            {showMethod && error && <p className="text-sm text-negative">{error}</p>}
            {showMethod && method && <pre className="scrollbar-thin max-h-96 overflow-auto rounded-lg bg-code p-4 font-mono text-xs leading-relaxed text-code-fg">{method}</pre>}
          </div>
        </Card>
      </div>
    </AppShell>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold text-balance text-fg">{title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-pretty text-muted">{children}</p>
    </section>
  );
}
