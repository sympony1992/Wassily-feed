const CDN = 'https://cdn.dexscreener.com/cms/images/';

// The CDN only serves preset sizes (64, 128, 800); any other width answers 422. 128 stays sharp on retina.
const sized = (id: string) => `${CDN}${id}?width=128&height=128&fit=crop&quality=95&format=auto`;

/**
 * The logo a token's team published on DexScreener, sized for the feed.
 * Profiles and pairs send full CDN URLs; boosts send only the image id.
 * Nothing is ever generated: a token without a published logo stays without one.
 */
export function dexImageUrl(value: string | null | undefined): string | undefined {
  const v = value?.trim();
  if (!v) return undefined;
  if (v.startsWith(CDN)) return sized(v.slice(CDN.length).split(/[?#]/)[0]);
  if (v.startsWith('https://')) return v;
  if (/^[\w-]{8,64}$/.test(v)) return sized(v);
  return undefined;
}
