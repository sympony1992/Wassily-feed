'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { CalendarTab } from '@/components/trade/CalendarTab';
import { ConfirmDialog } from '@/components/trade/ConfirmDialog';
import { DisclaimerDialog } from '@/components/trade/DisclaimerDialog';
import { PaperCard } from '@/components/trade/PaperCard';
import { PortfolioTab } from '@/components/trade/PortfolioTab';
import { QuickBuySettings } from '@/components/trade/QuickBuySettings';
import { SignalsCard } from '@/components/trade/SignalsCard';
import { TradeToasts } from '@/components/trade/TradeToasts';
import { WalletControl } from '@/components/trade/WalletControl';
import { IconBot } from '@/components/ui/Icons';
import { Badge, Button, Card, CardHeader, StatusDot } from '@/components/ui/primitives';
import { quickBuy, restoreSession } from '@/client/tradeActions';
import type { SignalJson } from '@/client/trade';
import { BOT_DRAFT, QUICK_BUY } from '@/config/bot';
import { SITE, fmtUsdK } from '@/config/site';
import type { GateKey } from '@/engine/proof';
import { useLiveProof } from '@/hooks/useProof';
import { cn } from '@/lib/cn';
import { usePersona, useStore } from '@/store/useStore';
import { useTrade } from '@/store/useTrade';

type Tab = 'trade' | 'portfolio' | 'calendar';
const TABS: { id: Tab; label: string }[] = [
  { id: 'trade', label: 'Trade' },
  { id: 'portfolio', label: 'Portfolio' },
  { id: 'calendar', label: 'PnL Calendar' },
];

const pct = (v: number) => `${Math.round(v * 100)}%`;

const STEPS = [
  { title: 'Watch', body: `Pick up a token from the live ingest once its cap clears ${fmtUsdK(BOT_DRAFT.entryMc)}.` },
  { title: 'Score', body: `Run the latest model on it, with its holder count ${SITE.holderSampleHours}h after launch, for the chance it reaches ${fmtUsdK(BOT_DRAFT.takeProfitMc)}.` },
  { title: 'Safety lock', body: `Trade only while the jar reads 100%: all four validation gates pass and the proven floor is at least ${SITE.aucTarget.toFixed(2)}.` },
  { title: 'Size', body: `Stake $${BOT_DRAFT.minStakeUsd}–$${BOT_DRAFT.maxStakeUsd}, with at most ${BOT_DRAFT.maxOpenPositions} positions open and a $${BOT_DRAFT.dailyLossCapUsd} daily loss cap.` },
  { title: 'Exit', body: `Sell at +${QUICK_BUY.takeProfitPct * 100}%, a ${pct(QUICK_BUY.stopLossPct)} drop, or ${QUICK_BUY.timeStopHours}h after the buy, whichever comes first.` },
];

const RULES: [string, string][] = [
  ['Entry', `peak ${fmtUsdK(BOT_DRAFT.entryMc)}–${fmtUsdK(BOT_DRAFT.takeProfitMc)}`],
  ['Minimum score', BOT_DRAFT.minScore.toFixed(2)],
  ['Stake per trade', `$${QUICK_BUY.minUsd}–$${QUICK_BUY.maxUsd}`],
  ['Open positions', `≤ ${QUICK_BUY.maxOpenPositions}`],
  ['Daily loss cap', `$${QUICK_BUY.dailyLossCapUsd}`],
  ['Take profit', `+${QUICK_BUY.takeProfitPct * 100}%`],
  ['Stop loss', `−${pct(QUICK_BUY.stopLossPct)}`],
  ['Time stop', `${QUICK_BUY.timeStopHours}h after the buy`],
];

const GATE_NAMES: Record<GateKey, string> = { n_samples: 'sample size', n_positive: 'survivors', auc_std: 'fold σ', time_split: 'time-split gap' };

const FACTS = [
  { title: 'You sign every trade', body: 'Quick buy prices a swap and your own wallet asks you to confirm it. This site holds no keys and no funds, and it cannot move anything without you.' },
  { title: 'Where orders go', body: `KyberSwap routes each swap on ${SITE.chain}: through the Pons curve for launchpad tokens, or the DEX pools a token trades in.` },
  { title: 'What it costs', body: 'A network fee of a few cents, the pools’ own fees (a Pons curve takes 2%), and price movement up to your slippage setting.' },
  { title: 'Paper first', body: 'Every signal is also bought on paper at real quotes, so the record shows whether the signals would have made money before you risk any.' },
];

export function BotView() {
  const persona = usePersona();
  const model = useStore((s) => s.model);
  const proof = useLiveProof();
  const [tab, setTab] = useState<Tab>('trade');
  const init = useTrade((s) => s.init);
  const wallet = useTrade((s) => s.wallet);
  const disclaimerAt = useTrade((s) => s.disclaimerAt);
  const acceptDisclaimer = useTrade((s) => s.acceptDisclaimer);
  const toast = useTrade((s) => s.toast);
  const [awaiting, setAwaiting] = useState<SignalJson | null>(null); // a buy held until the disclaimer is accepted
  const warming = !model || model.n < 20;

  useEffect(() => {
    init();
    void restoreSession();
  }, [init]);

  const onQuickBuy = (signal: SignalJson) => {
    if (!wallet) return void toast({ tone: 'negative', title: 'Connect a wallet first.' });
    if (!disclaimerAt) return setAwaiting(signal);
    void quickBuy(signal);
  };

  return (
    <AppShell
      title="Trade Bot"
      description={`Buy the tokens ${persona.mascot} would buy, straight from the feed. ${persona.mascot} screens and scores; you decide, and your wallet signs.`}
      meta={<Badge tone="accent">Beta</Badge>}
    >
      <div className="space-y-4">
        <div role="note" className="flex items-start gap-3 rounded-xl border border-dashed border-accent bg-accent-soft px-4 py-3">
          <IconBot className="mt-0.5 size-5 shrink-0 text-accent" />
          <p className="min-w-0 text-sm text-pretty text-muted">
            <span className="font-semibold text-fg">{persona.mascot} is a mascot, not a financial adviser. It measures survival, not price.</span> Quick buy is manual: nothing is traded
            automatically, every trade is signed in your own wallet, and you can lose everything you put in.
          </p>
        </div>

        <div role="tablist" aria-label="Trade Bot" className="flex gap-1 border-b border-border">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`panel-${t.id}`}
              onClick={() => setTab(t.id)}
              className={cn(
                '-mb-px cursor-pointer border-b-2 px-3 py-2 text-sm font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-accent',
                tab === t.id ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
          {tab === 'trade' && (
            <div className="space-y-4">
              <Card>
                <CardHeader
                  title="Quick buy"
                  description="Connect once per session, set an amount once, then buy with one click. Your wallet confirms each trade."
                  action={<WalletControl />}
                />
                <div className="space-y-4 px-5 py-4">
                  <QuickBuySettings />
                  <div className="flex items-center gap-2 border-t border-border pt-3 text-sm text-fg">
                    <StatusDot tone={proof?.unlocked ? 'positive' : 'neutral'} />
                    <span className="min-w-0 text-pretty">
                      Safety lock {proof?.unlocked ? 'open: quick buy is allowed' : 'closed: every quick buy button is disabled'}
                      <span className="text-muted">
                        {warming ? ' · model warming up' : proof ? ` · jar ${pct(proof.jar)}${proof.blockedBy ? `, blocked by ${GATE_NAMES[proof.blockedBy]}` : ''}` : ''}
                      </span>
                    </span>
                  </div>
                </div>
              </Card>

              <SignalsCard onQuickBuy={onQuickBuy} />
              <PaperCard />

              <Card className="overflow-hidden">
                <CardHeader title="How quick buy works" description="What happens when you click" />
                <ul className="grid grid-cols-1 gap-px bg-border sm:grid-cols-2 xl:grid-cols-4">
                  {FACTS.map((f) => (
                    <li key={f.title} className="bg-surface px-5 py-4">
                      <div className="text-sm font-medium text-fg">{f.title}</div>
                      <p className="mt-1 text-xs text-pretty text-muted">{f.body}</p>
                    </li>
                  ))}
                </ul>
              </Card>

              <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
                <Card className="xl:col-span-7">
                  <CardHeader title="Automated bot" description="Phase 3: the same rules, run by Wassily itself" action={<Badge tone="accent">Coming soon</Badge>} />
                  <ol className="divide-y divide-border">
                    {STEPS.map((s, i) => (
                      <li key={s.title} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-3 px-5 py-3">
                        <span className="flex size-7 items-center justify-center rounded-full border border-border font-mono text-xs text-muted tabular-nums">{i + 1}</span>
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-fg">{s.title}</div>
                          <p className="mt-0.5 text-xs text-pretty text-muted">{s.body}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                </Card>
                <Card className="flex flex-col xl:col-span-5">
                  <CardHeader title="Rules" description="Quick buy limits today, the automated bot's rules later" action={<Badge>draft</Badge>} />
                  <dl className="divide-y divide-border">
                    {RULES.map(([term, value]) => (
                      <div key={term} className="flex items-center justify-between gap-3 px-5 py-2">
                        <dt className="text-sm text-muted">{term}</dt>
                        <dd className="font-mono text-xs text-fg tabular-nums">{value}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="mt-auto border-t border-border px-5 py-4">
                    <Button variant="primary" className="w-full" disabled title="Coming soon">
                      Start automated bot · coming soon
                    </Button>
                  </div>
                </Card>
              </div>
            </div>
          )}
          {tab === 'portfolio' && <PortfolioTab />}
          {tab === 'calendar' && <CalendarTab />}
        </div>
      </div>

      <DisclaimerDialog
        open={!!awaiting}
        onClose={() => setAwaiting(null)}
        onAccept={() => {
          acceptDisclaimer();
          const signal = awaiting;
          setAwaiting(null);
          if (signal) void quickBuy(signal);
        }}
      />
      <ConfirmDialog />
      <TradeToasts />
    </AppShell>
  );
}
