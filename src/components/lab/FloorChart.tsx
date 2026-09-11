import { useMemo, useRef, useState } from 'react';
import { SITE } from '@/config/site';
import { simInput } from '@/hooks/useProof';
import { fmtInt } from '@/lib/format';
import { BOUNDS, needsBootstrap, type BoundId } from '@/math/bounds';

const W = 720;
const H = 300;
const M = { l: 44, r: 118, t: 14, b: 30 };
const N_MIN = SITE.sliders.n.min;
const N_MAX = SITE.sliders.n.max;
const X_TICKS = [120, 500, 1000, 2500, 5000, 10000, 24000];

/** Proven floor vs sample size for every closed-form bound. The active one is highlighted; the table below is the legend. */
export function FloorChart({ auc, d, posRate, currentN, activeId }: { auc: number; d: number; posRate: number; currentN: number; activeId: BoundId }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const ns = useMemo(() => Array.from({ length: 64 }, (_, i) => Math.round(N_MIN * (N_MAX / N_MIN) ** (i / 63))), []);
  const series = useMemo(
    () =>
      BOUNDS.filter((b) => !needsBootstrap(b.id)).map((b) => ({
        id: b.id,
        short: b.short,
        floors: ns.map((n) => b.compute(simInput({ n, auc, d, posRate, bootLower: null })).floor),
      })),
    [ns, auc, d, posRate],
  );

  const yMin = 0.4;
  const yMax = Math.max(0.65, Math.ceil((auc + 0.01) * 20) / 20);
  const x = (n: number) => M.l + ((Math.log(n) - Math.log(N_MIN)) / (Math.log(N_MAX) - Math.log(N_MIN))) * (W - M.l - M.r);
  const y = (v: number) => M.t + (1 - (Math.min(yMax, Math.max(yMin, v)) - yMin) / (yMax - yMin)) * (H - M.t - M.b);
  const yTicks = Array.from({ length: Math.round((yMax - yMin) / 0.05) + 1 }, (_, i) => yMin + i * 0.05);
  const path = (floors: number[]) => floors.map((f, i) => `${i ? 'L' : 'M'}${x(ns[i]).toFixed(1)},${y(f).toFixed(1)}`).join('');

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const t = (((e.clientX - rect.left) / rect.width) * W - M.l) / (W - M.l - M.r);
    setHover(t < 0 || t > 1 ? null : Math.round(t * (ns.length - 1)));
  };

  const active = series.find((s) => s.id === activeId);
  const others = series.filter((s) => s.id !== activeId);

  return (
    <div className="relative">
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label="Proven floor against sample size for each bound">
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} stroke="var(--border)" />
            <text x={M.l - 8} y={y(t) + 3} textAnchor="end" fontSize="10" fill="var(--muted)" className="tabular-nums">
              {t.toFixed(2)}
            </text>
          </g>
        ))}
        {X_TICKS.map((t) => (
          <text key={t} x={x(t)} y={H - 10} textAnchor="middle" fontSize="10" fill="var(--muted)" className="tabular-nums">
            {t >= 1000 ? `${t / 1000}k` : t}
          </text>
        ))}
        <text x={W - M.r} y={H - 10} dx="6" fontSize="10" fill="var(--subtle)">
          n (log)
        </text>

        <line x1={M.l} x2={W - M.r} y1={y(SITE.aucTarget)} y2={y(SITE.aucTarget)} stroke="var(--positive)" strokeDasharray="5 4" />
        <text x={W - M.r + 6} y={y(SITE.aucTarget) + 3} fontSize="10" fill="var(--positive)">
          target {SITE.aucTarget.toFixed(2)}
        </text>
        <line x1={M.l} x2={W - M.r} y1={y(auc)} y2={y(auc)} stroke="var(--subtle)" strokeDasharray="2 4" />
        <text x={M.l + 6} y={y(auc) - 5} fontSize="10" fill="var(--muted)">
          measured {auc.toFixed(3)}
        </text>
        <line x1={x(currentN)} x2={x(currentN)} y1={M.t} y2={H - M.b} stroke="var(--border-strong)" strokeDasharray="3 3" />

        {others.map((s) => (
          <path key={s.id} d={path(s.floors)} fill="none" stroke="var(--border-strong)" strokeWidth="1.5" strokeLinejoin="round" />
        ))}
        {active && (
          <>
            <path d={path(active.floors)} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinejoin="round" />
            <text x={W - M.r + 6} y={y(active.floors[active.floors.length - 1]) + 14} fontSize="11" fontWeight="600" fill="var(--fg)">
              {active.short}
            </text>
          </>
        )}

        {hover != null && (
          <g>
            <line x1={x(ns[hover])} x2={x(ns[hover])} y1={M.t} y2={H - M.b} stroke="var(--muted)" strokeOpacity="0.5" />
            {series.map((s) => (
              <circle key={s.id} cx={x(ns[hover])} cy={y(s.floors[hover])} r={s.id === activeId ? 4.5 : 3} fill={s.id === activeId ? 'var(--accent)' : 'var(--subtle)'} stroke="var(--surface)" strokeWidth="2" />
            ))}
          </g>
        )}
      </svg>

      {hover != null && (
        <div
          className="pointer-events-none absolute top-2 z-10 min-w-44 rounded-lg border border-border bg-surface p-2.5 text-xs shadow-md"
          style={{ left: `${(x(ns[hover]) / W) * 100}%`, transform: hover > ns.length / 2 ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)' }}
        >
          <div className="mb-1 font-mono text-muted tabular-nums">n = {fmtInt(ns[hover])}</div>
          {[...series]
            .sort((a, b) => b.floors[hover] - a.floors[hover])
            .map((s) => (
              <div key={s.id} className={`flex justify-between gap-4 ${s.id === activeId ? 'font-semibold text-fg' : 'text-muted'}`}>
                <span>{s.short}</span>
                <span className="font-mono tabular-nums">{s.floors[hover].toFixed(3)}</span>
              </div>
            ))}
        </div>
      )}

      {needsBootstrap(activeId) && <p className="mt-2 text-xs text-subtle">Bootstrap floors need resampling at every n, so they appear in the table instead of as a curve.</p>}
    </div>
  );
}
