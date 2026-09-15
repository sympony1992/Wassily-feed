'use client';

import { useState } from 'react';
import { QUICK_BUY } from '@/config/bot';
import { useTrade } from '@/store/useTrade';
import { Button, SectionLabel } from '../ui/primitives';

const SLIPPAGE_BPS = [50, 100, 300, 500, 1000, 1500];

/** Set once, buy many: the amount, slippage and whether to ask on this page first. Stored in this browser. */
export function QuickBuySettings() {
  const settings = useTrade((s) => s.settings);
  const setSettings = useTrade((s) => s.setSettings);
  const isPreset = (QUICK_BUY.presetsUsd as readonly number[]).includes(settings.amountUsd);
  const [custom, setCustom] = useState(isPreset ? '' : String(settings.amountUsd));

  const applyCustom = () => {
    const v = Number(custom);
    if (Number.isFinite(v) && v > 0) setSettings({ amountUsd: v });
  };

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
      <div className="min-w-0">
        <SectionLabel>Quick buy amount</SectionLabel>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {QUICK_BUY.presetsUsd.map((usd) => (
            <Button
              key={usd}
              size="sm"
              variant={settings.amountUsd === usd ? 'primary' : 'secondary'}
              aria-pressed={settings.amountUsd === usd}
              onClick={() => {
                setCustom('');
                setSettings({ amountUsd: usd });
              }}
            >
              ${usd}
            </Button>
          ))}
          <label className="flex h-8 items-center gap-1 rounded-lg border border-border bg-surface px-2 text-xs text-muted focus-within:outline-2 focus-within:outline-accent">
            <span>Custom $</span>
            <input
              inputMode="decimal"
              value={custom}
              onChange={(e) => setCustom(e.target.value.replace(/[^0-9.]/g, ''))}
              onBlur={applyCustom}
              onKeyDown={(e) => e.key === 'Enter' && applyCustom()}
              placeholder={`${QUICK_BUY.minUsd}–${QUICK_BUY.maxUsd}`}
              aria-label={`Custom amount in dollars, ${QUICK_BUY.minUsd} to ${QUICK_BUY.maxUsd}`}
              className="w-14 bg-transparent font-mono text-fg tabular-nums outline-none"
            />
          </label>
          <span className="font-mono text-xs text-subtle tabular-nums">now ${settings.amountUsd}</span>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <label className="text-xs text-muted">
          <span className="block font-medium">Slippage</span>
          <select
            value={settings.slippageBps}
            onChange={(e) => setSettings({ slippageBps: Number(e.target.value) })}
            className="mt-1.5 h-8 rounded-lg border border-border bg-surface px-2 font-mono text-xs text-fg tabular-nums"
          >
            {SLIPPAGE_BPS.map((bps) => (
              <option key={bps} value={bps}>
                {bps / 100}%
              </option>
            ))}
          </select>
        </label>
        <label className="flex h-8 cursor-pointer items-center gap-2 text-xs text-fg">
          <input type="checkbox" checked={settings.confirm} onChange={(e) => setSettings({ confirm: e.target.checked })} className="size-4 accent-[var(--color-accent)]" />
          Ask before opening the wallet
        </label>
      </div>
    </div>
  );
}
