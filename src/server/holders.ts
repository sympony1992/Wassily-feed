/**
 * One holder count per token, taken once at the 48h label. `template` is an
 * explorer URL containing "{address}" — Blockscout v2 returns `holders_count`.
 * Returns null when unavailable; the trainer then imputes the median.
 */
export async function sampleHolders(template: string, address: string, fetchImpl: typeof fetch = fetch): Promise<number | null> {
  if (!template) return null;
  try {
    const res = await fetchImpl(template.replace('{address}', address), { headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    const body = (await res.json()) as Record<string, unknown>;
    const raw = body.holders_count ?? body.holder_count ?? body.holders;
    const n = Number(raw);
    return raw != null && Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}
