import { describe, expect, it } from 'vitest';
import { dexImageUrl } from './dexImage';

describe('dexImageUrl', () => {
  it('turns a bare boost image id into a CDN URL', () => {
    expect(dexImageUrl('U7yFWDqA11bogftV')).toBe('https://cdn.dexscreener.com/cms/images/U7yFWDqA11bogftV?width=128&height=128&fit=crop&quality=95&format=auto');
  });

  it('resizes full DexScreener CDN URLs', () => {
    expect(dexImageUrl('https://cdn.dexscreener.com/cms/images/Jf4_6MHA9Q0F5h5i?width=800&height=800&quality=95&format=auto')).toBe(
      'https://cdn.dexscreener.com/cms/images/Jf4_6MHA9Q0F5h5i?width=128&height=128&fit=crop&quality=95&format=auto',
    );
  });

  it('keeps other https logos and drops anything else', () => {
    expect(dexImageUrl('https://example.org/logo.png')).toBe('https://example.org/logo.png');
    expect(dexImageUrl('')).toBeUndefined();
    expect(dexImageUrl(undefined)).toBeUndefined();
    expect(dexImageUrl('javascript:alert(1)')).toBeUndefined();
  });
});
