import { SITE } from '@/config/site';
import { simInput } from '@/hooks/useProof';
import { cn } from '@/lib/cn';
import { fmtInt } from '@/lib/format';
import type { BoundDef } from '@/math/bounds';
import { useStore } from '@/store/useStore';

interface RowProps {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  display: string;
  onChange: (v: number) => void;
  note?: string;
}

function SliderRow({ id, label, min, max, step, value, display, onChange, note }: RowProps) {
  return (
    <div className={cn('grid grid-cols-[minmax(0,9rem)_1fr_4rem] items-center gap-3', note && 'opacity-60')}>
      <label htmlFor={id} className="text-sm text-fg">
        {label}
        {note && <span className="block text-xs text-subtle">{note}</span>}
      </label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full" />
      <output htmlFor={id} className="text-right font-mono text-sm text-fg tabular-nums">
        {display}
      </output>
    </div>
  );
}

/** n, AUC, d and survivor share. Inputs a formula ignores are dimmed and labelled. */
export function SimControls({ bound, showAll = false }: { bound: BoundDef; showAll?: boolean }) {
  const sim = useStore((s) => s.sim);
  const setSim = useStore((s) => s.setSim);
  const uses = (k: 'd' | 'nPos') => bound.uses.includes(k) || (k === 'nPos' && bound.uses.includes('bootstrap'));
  const nPos = simInput(sim).nPos;
  const s = SITE.sliders;

  return (
    <div className="flex flex-col gap-3">
      <SliderRow id="sim-n" label="Tokens sampled" {...s.n} value={sim.n} display={fmtInt(sim.n)} onChange={(n) => setSim({ n })} />
      <SliderRow id="sim-auc" label="Measured AUC" {...s.auc} value={sim.auc} display={sim.auc.toFixed(3)} onChange={(auc) => setSim({ auc })} />
      <SliderRow id="sim-d" label="Model capacity d" {...s.d} value={sim.d} display={String(sim.d)} onChange={(d) => setSim({ d })} note={uses('d') ? undefined : `unused by ${bound.short}`} />
      {(uses('nPos') || showAll) && (
        <SliderRow
          id="sim-pos"
          label="Survivor share"
          {...s.posRate}
          value={sim.posRate}
          display={`${(sim.posRate * 100).toFixed(1)}%`}
          onChange={(posRate) => setSim({ posRate })}
          note={uses('nPos') ? undefined : `unused by ${bound.short}`}
        />
      )}
      {(uses('nPos') || showAll) && (
        <div className="text-right font-mono text-xs text-subtle tabular-nums">
          n₊ {fmtInt(nPos)} · n₋ {fmtInt(sim.n - nPos)}
        </div>
      )}
    </div>
  );
}
