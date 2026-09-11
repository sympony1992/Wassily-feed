export const fmtInt = (v: number) => Math.round(v).toLocaleString('en-US');

/** $10.5K, $128K, $92.8M — one decimal below $100K and for millions. */
export const fmtMC = (v: number) =>
  v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `$${(v / 1000).toFixed(v >= 100_000 ? 0 : 1)}K` : `$${v.toFixed(0)}`;

export const pad2 = (v: number) => String(v).padStart(2, '0');

export function fmtUtcTime(iso?: string, fallbackHour?: number): string {
  if (iso) {
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())} UTC`;
  }
  return `${pad2(fallbackHour ?? 12)}:00 UTC`;
}

export function fmtUptime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${pad2(Math.floor(s / 3600))}:${pad2(Math.floor((s % 3600) / 60))}:${pad2(s % 60)}`;
}

export const shortHex = (hex: string, head = 6, tail = 4) => (hex.length > head + tail + 2 ? `${hex.slice(0, head)}…${hex.slice(-tail)}` : hex);

export const fmtSigned = (v: number, digits = 4) => (v < 0 ? v.toFixed(digits) : `+${v.toFixed(digits)}`);
