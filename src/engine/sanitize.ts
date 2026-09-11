// Lore arrives from strangers. It is cleaned before display but the token is
// always kept in the dataset — dropping flagged rows would bias the sample.

// Zero-width spaces/joiners, BOM, and bidi controls (built from code points so the source stays ASCII).
const INVISIBLE_RANGES: [number, number][] = [
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x2069],
  [0xfeff, 0xfeff],
];
const ZERO_WIDTH_AND_BIDI = new RegExp(
  `[${INVISIBLE_RANGES.map(([a, b]) => `${String.fromCodePoint(a)}-${String.fromCodePoint(b)}`).join('')}]`,
  'g',
);
const URLS = /https?:\/\/\S+|ipfs:\/\/\S+|www\.\S+/gi;

/** Extend this list for production; it only needs to catch what you refuse to display. */
export const BLOCKLIST = new Set(['fuck', 'shit', 'bitch']);

export interface SanitizedLore {
  display: string;
  withheld: boolean;
  reason: 'blocklist' | null;
}

export function sanitizeLore(raw: string | null | undefined): SanitizedLore {
  if (!raw || !raw.trim()) return { display: '', withheld: false, reason: null };
  const text = raw.replace(ZERO_WIDTH_AND_BIDI, '');
  const words = text.toLowerCase().match(/\w+/g) ?? [];
  if (words.some((w) => BLOCKLIST.has(w))) return { display: '', withheld: true, reason: 'blocklist' };
  return { display: text.replace(URLS, '').replace(/\s{2,}/g, ' ').trim().slice(0, 280).trim(), withheld: false, reason: null };
}
