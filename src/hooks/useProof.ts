import { useEffect, useMemo, useRef, useState } from 'react';
import { SITE } from '@/config/site';
import { fetchSyntheticBootstrap } from '@/client/live';
import { evaluateModel } from '@/engine/proof';
import { BOUNDS, jarFraction, needsBootstrap, type BoundDef, type BoundInput } from '@/math/bounds';
import { useBound, useStore } from '@/store/useStore';

/** The live model judged by the currently selected bound. */
export function useLiveProof() {
  const model = useStore((s) => s.model);
  const bound = useBound();
  return useMemo(() => (model ? evaluateModel(model, bound) : null), [model, bound]);
}

export function simInput(sim: { n: number; auc: number; d: number; posRate: number; bootLower: number | null }): BoundInput {
  return {
    n: sim.n,
    nPos: Math.max(1, Math.min(sim.n - 1, Math.round(sim.n * sim.posRate))),
    auc: sim.auc,
    aucStd: 0,
    d: sim.d,
    delta: SITE.delta,
    bootLower: sim.bootLower,
  };
}

/** Proof-panel sliders judged by a bound; runs a synthetic bootstrap in the worker when needed. */
export function useSimProof(bound: BoundDef, forceBootstrap = false) {
  const sim = useStore((s) => s.sim);
  const setBoot = useStore((s) => s.setSimBootLower);
  const input = simInput(sim);
  const wants = forceBootstrap || needsBootstrap(bound.id);

  useEffect(() => {
    if (!wants || sim.bootLower != null) return;
    let alive = true;
    const t = setTimeout(() => {
      void fetchSyntheticBootstrap(input.n, input.nPos, input.auc).then((v) => alive && setBoot(v));
    }, 180);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [wants, input.n, input.nPos, input.auc, sim.bootLower, setBoot]);

  return useMemo(() => {
    const r = bound.compute(input);
    return {
      ...r,
      input,
      shownFloor: Math.max(SITE.aucFloor, r.floor),
      jar: jarFraction(r.floor, SITE.aucFloor, SITE.aucTarget),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bound, sim]);
}

/**
 * Smallest evidence that actually fills the jar under this bound: keep the
 * preset's AUC and d, grow n; if even the slider maximum cannot, raise AUC.
 */
export function fillTargetFor(bound: BoundDef, posRate: number, preset: { n: number; auc: number; d: number }) {
  const { min, max, step } = SITE.sliders.n;
  // Bootstrap floors are estimated with the Wilcoxon normal SE for the search.
  const judge = needsBootstrap(bound.id) ? BOUNDS.find((b) => b.id === 'wilcoxon')! : bound;
  const floorAt = (n: number, auc: number) => {
    const x = simInput({ n, auc, d: preset.d, posRate, bootLower: null });
    const f = judge.compute(x).floor;
    return bound.id === 'vc-bootstrap' ? Math.min(f, auc - BOUNDS[0].compute(x).epsilon) : f;
  };
  for (let auc = preset.auc; auc <= SITE.sliders.auc.max + 1e-9; auc += 0.005) {
    if (floorAt(max, auc) < SITE.aucTarget + 0.002) continue;
    let lo: number = min;
    let hi: number = max;
    while (hi - lo > step) {
      const mid = Math.round((lo + hi) / 2 / step) * step;
      if (floorAt(mid, auc) >= SITE.aucTarget + 0.002) hi = mid;
      else lo = mid;
    }
    return { n: hi, auc: Math.round(auc * 1000) / 1000, d: preset.d };
  }
  return { n: max, auc: SITE.sliders.auc.max, d: preset.d };
}

/** Arrivals per minute over a sliding window. */
export function useRatePerMinute(count: number, windowMs = 60_000) {
  const samples = useRef<[number, number][]>([]);
  const [rate, setRate] = useState(0);
  useEffect(() => {
    const now = Date.now();
    const last = samples.current[samples.current.length - 1];
    if (last && count - last[1] > 50) samples.current = []; // a snapshot load, not arrivals
    samples.current.push([now, count]);
    samples.current = samples.current.filter(([t]) => now - t <= windowMs);
    const [t0, c0] = samples.current[0];
    const dt = now - t0;
    setRate(dt > 5000 ? ((count - c0) / dt) * 60_000 : 0);
  }, [count, windowMs]);
  return rate;
}
