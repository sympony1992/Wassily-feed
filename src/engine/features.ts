import type { TrainingRow } from './types';

export const LORE_DIMS = 15;

// #region stage:features
// 2 hour + 7 weekday + 1 holders + 3 text-shape + 15 hashed lore words = 28 = d
export const FEATURE_NAMES: string[] = [
  'hour_sin',
  'hour_cos',
  ...Array.from({ length: 7 }, (_, i) => `dow_${i}`),
  'holders_log',
  'lore_len',
  'lore_missing',
  'name_tokens',
  ...Array.from({ length: LORE_DIMS }, (_, i) => `lore_hash_${i + 1}`),
];

export type FeatureInput = Pick<TrainingRow, 'hour' | 'dow' | 'holders' | 'lore' | 'loreMissing' | 'name'>;

export function featurize(t: FeatureInput, out = new Float64Array(FEATURE_NAMES.length), o = 0): Float64Array {
  out.fill(0, o, o + FEATURE_NAMES.length);
  out[o] = Math.sin((2 * Math.PI * t.hour) / 24);
  out[o + 1] = Math.cos((2 * Math.PI * t.hour) / 24);
  out[o + 2 + t.dow] = 1;
  out[o + 9] = Math.log1p(t.holders);

  const words = t.lore.toLowerCase().match(/[a-z0-9']+/g) ?? [];
  out[o + 10] = words.length;
  out[o + 11] = t.loreMissing ? 1 : 0;
  out[o + 12] = t.name.trim().split(/\s+/).filter(Boolean).length;

  // Hashing trick: each word lands in one of 15 buckets with a ±1 sign.
  let norm = 0;
  for (const w of words) {
    const h = fnv1a(w);
    out[o + 13 + (h % LORE_DIMS)] += (h >>> 16) & 1 ? 1 : -1;
  }
  for (let i = 0; i < LORE_DIMS; i++) norm += out[o + 13 + i] ** 2;
  if (norm > 0) for (let i = 0; i < LORE_DIMS; i++) out[o + 13 + i] /= Math.sqrt(norm);
  return out;
}
// #endregion

export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Feature columns grouped into the families shown on the dashboard. */
export const FEATURE_GROUPS: { key: string; label: string; match: (name: string) => boolean }[] = [
  { key: 'holders_log', label: 'Holders at 48h (log scale)', match: (n) => n === 'holders_log' },
  { key: 'hour_cos', label: 'Launch hour · cosine of the 24h cycle', match: (n) => n === 'hour_cos' },
  { key: 'hour_sin', label: 'Launch hour · sine of the 24h cycle', match: (n) => n === 'hour_sin' },
  { key: 'dow', label: 'Day-of-week pattern', match: (n) => n.startsWith('dow_') },
  { key: 'lore_words', label: 'Lore wording (hashed bag of words)', match: (n) => n.startsWith('lore_hash_') },
  { key: 'lore_len', label: 'Lore length', match: (n) => n === 'lore_len' },
  { key: 'lore_missing', label: 'Lore missing', match: (n) => n === 'lore_missing' },
  { key: 'name_tokens', label: 'Words in the name', match: (n) => n === 'name_tokens' },
];
