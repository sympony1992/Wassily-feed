import { SITE } from '@/config/site';
import { sanitizeLore } from '@/engine/sanitize';
import type { Token } from '@/engine/types';
import type { Agent } from '../agent';
import { sampleHolders } from '../holders';
import { dexImageUrl } from './dexImage';

interface Profile {
  chainId?: string;
  tokenAddress?: string;
  description?: string;
  icon?: string;
}

interface Pair {
  chainId?: string;
  baseToken?: { address?: string; name?: string; symbol?: string };
  marketCap?: number;
  fdv?: number;
  pairCreatedAt?: number;
  info?: { imageUrl?: string };
}

export interface DexOptions {
  api: string;
  chain: string;
  pollSeconds: number;
  maxDiscoveryAgeHours: number;
  holdersApiUrl: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  log?: (msg: string) => void;
}

const HOUR = 3_600_000;
const HUES = [38, 152, 268, 196, 12, 88, 320];
const BATCH = 30; // DexScreener accepts up to 30 addresses per call

/**
 * Real ingest: discover new tokens on the chain from DexScreener profiles and
 * boosts, track each one's peak market cap, and label it once at 48 hours.
 * Only tokens seen within a few hours of launch are admitted — for anything
 * older, the peak before we started watching is unknowable.
 */
export class DexScreenerSource {
  readonly stats = { discovered: 0, tooOld: 0, belowEntry: 0, labelled: 0, errors: 0, lastTickAt: '' };
  private queue = new Map<string, { address: string; lore: string; icon?: string; seenAt: number }>();
  private timer: NodeJS.Timeout | null = null;
  private backoffUntil = 0;
  private stopped = false;

  constructor(
    private readonly agent: Agent,
    private readonly o: DexOptions,
  ) {}

  private now() {
    return this.o.now?.() ?? Date.now();
  }

  start() {
    const loop = async () => {
      await this.tick();
      if (!this.stopped) this.timer = setTimeout(loop, this.o.pollSeconds * 1000);
    };
    void loop();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  async tick() {
    if (this.now() < this.backoffUntil) return;
    try {
      await this.discover();
      await this.price();
      await this.label();
    } catch (err) {
      this.stats.errors++;
      this.o.log?.(`dexscreener: ${(err as Error).message}`);
    }
    this.stats.lastTickAt = new Date(this.now()).toISOString();
  }

  private async get<T>(path: string): Promise<T> {
    const res = await (this.o.fetchImpl ?? fetch)(`${this.o.api}${path}`, { headers: { accept: 'application/json' } });
    if (res.status === 429) {
      this.backoffUntil = this.now() + 60_000;
      throw new Error('rate limited; backing off for 60 s');
    }
    if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  private async discover() {
    const lists = await Promise.allSettled([this.get<Profile[]>('/token-profiles/latest/v1'), this.get<Profile[]>('/token-boosts/latest/v1')]);
    for (const list of lists) {
      if (list.status !== 'fulfilled' || !Array.isArray(list.value)) continue;
      for (const p of list.value) {
        if (p.chainId !== this.o.chain || !p.tokenAddress) continue;
        const key = p.tokenAddress.toLowerCase();
        if (this.agent.tokens.has(key) || this.queue.has(key)) continue;
        this.queue.set(key, { address: p.tokenAddress, lore: p.description ?? '', icon: p.icon, seenAt: this.now() });
      }
    }
  }

  private async price() {
    const pending = [...this.agent.tokens.values()].filter((t) => t.status === 'pending').map((t) => t.mint.toLowerCase());
    const watch = [...this.queue.keys(), ...pending];

    for (let i = 0; i < watch.length; i += BATCH) {
      const chunk = watch.slice(i, i + BATCH);
      const pairs = await this.get<Pair[]>(`/tokens/v1/${this.o.chain}/${chunk.join(',')}`);
      const best = new Map<string, { name: string; symbol: string; mc: number; created: number; image?: string }>();
      for (const p of Array.isArray(pairs) ? pairs : []) {
        const addr = p.baseToken?.address?.toLowerCase();
        if (!addr || !chunk.includes(addr)) continue;
        const prev = best.get(addr);
        best.set(addr, {
          name: prev?.name || p.baseToken?.name || '',
          symbol: prev?.symbol || p.baseToken?.symbol || '',
          mc: Math.max(prev?.mc ?? 0, p.marketCap ?? p.fdv ?? 0),
          created: Math.min(prev?.created ?? Infinity, p.pairCreatedAt ?? Infinity),
          image: prev?.image ?? p.info?.imageUrl,
        });
      }

      for (const [addr, b] of best) {
        const existing = this.agent.tokens.get(addr);
        if (existing) {
          // Peak, never current: a token that touched 25K and fell back still crossed the line.
          const peakMc = Math.max(existing.peakMc, Math.round(b.mc));
          // Teams often publish their logo after launch; pick it up on a later poll.
          const logo = existing.logo ?? dexImageUrl(b.image);
          if (peakMc !== existing.peakMc || logo !== existing.logo) this.agent.upsert({ ...existing, peakMc, logo }, false);
          continue;
        }
        const q = this.queue.get(addr);
        if (!q) continue;
        this.queue.delete(addr);
        if (!Number.isFinite(b.created) || this.now() - b.created > this.o.maxDiscoveryAgeHours * HOUR) {
          this.stats.tooOld++;
          continue;
        }
        const clean = sanitizeLore(q.lore);
        const launched = new Date(b.created);
        const token: Token = {
          mint: q.address,
          name: b.name || q.address.slice(0, 10),
          symbol: b.symbol || 'TKN',
          lore: clean.display,
          loreRaw: q.lore,
          loreWithheld: clean.withheld,
          holders: 0,
          holdersMissing: true,
          peakMc: Math.round(b.mc),
          status: 'pending',
          hour: launched.getUTCHours(),
          dow: (launched.getUTCDay() + 6) % 7,
          launchedAt: launched.toISOString(),
          deployer: '',
          hue: HUES[parseInt(addr.slice(2, 4), 16) % HUES.length] ?? 38,
          logo: dexImageUrl(q.icon) ?? dexImageUrl(b.image),
        };
        this.agent.upsert(token);
        this.stats.discovered++;
      }
    }

    // Addresses DexScreener never priced are dropped once they are too old to admit anyway.
    for (const [key, q] of this.queue) {
      if (this.now() - q.seenAt > this.o.maxDiscoveryAgeHours * HOUR) this.queue.delete(key);
    }
  }

  // #region stage:ingest
  private async label() {
    const due = [...this.agent.tokens.values()].filter(
      (t) => t.status === 'pending' && this.now() - Date.parse(t.launchedAt) >= SITE.holderSampleHours * HOUR,
    );
    for (const t of due) {
      if (t.peakMc < SITE.entryMc) {
        this.agent.remove(t.mint); // the gate: never cleared $10K, never enters the study
        this.stats.belowEntry++;
        continue;
      }
      const holders = await sampleHolders(this.o.holdersApiUrl, t.mint, this.o.fetchImpl); // once, at 48h
      this.agent.upsert({
        ...t,
        status: t.peakMc >= SITE.targetMc ? 'passed' : 'stalled',
        holders: holders ?? 0,
        holdersMissing: holders == null,
      });
      this.stats.labelled++;
    }
  }
  // #endregion
}
