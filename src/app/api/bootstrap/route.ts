import { SITE } from '@/config/site';
import { binormalSample, bootstrapAucPercentile, rocAuc } from '@/math/auc';
import { rngFromSeed } from '@/math/stats';
import { json, query } from '@/server/http';

export const dynamic = 'force-dynamic';

const cache = new Map<string, number>();

/** Proof-panel sliders: Efron bootstrap on a binormal sample with the chosen n, survivors and AUC. */
export function GET(req: Request) {
  const q = query(req);
  const n = Math.round(Math.min(SITE.sliders.n.max, Math.max(SITE.sliders.n.min, q.num('n') ?? 0)));
  const nPos = Math.round(Math.min(n - 1, Math.max(1, q.num('npos') ?? 1)));
  const auc = Math.min(SITE.sliders.auc.max, Math.max(SITE.sliders.auc.min, q.num('auc') ?? 0.5));
  const key = `${n}:${nPos}:${auc.toFixed(3)}`;

  let lower = cache.get(key);
  if (lower == null) {
    const rng = rngFromSeed(n * 7919 + nPos * 31 + Math.round(auc * 1e4));
    const { labels, scores } = binormalSample(nPos, n - nPos, auc, rng);
    const shift = auc - rocAuc(labels, scores); // re-centre so the slider reads exactly what it says
    lower = bootstrapAucPercentile(labels, scores, rng, SITE.bootstrapResamples, 2.5) + shift;
    if (cache.size > 500) cache.clear();
    cache.set(key, lower);
  }
  return json({ n, n_pos: nPos, auc, boot_lower: lower }, { headers: { 'Cache-Control': 'public, max-age=3600' } });
}
