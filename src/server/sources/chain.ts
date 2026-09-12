import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { SITE } from '@/config/site';
import type { Agent } from '../agent';
import { LAUNCH_TOPICS, NATIVE, WETH, decodeLaunch, type PoolLaunch } from '../chain/abi';
import { GeckoClient } from '../chain/gecko';
import { holdersAt } from '../chain/holders';
import { RpcClient } from '../chain/rpc';
import { dexImageUrl } from './dexImage';

export interface BackfillProgress {
  running: boolean;
  progress: number; // share of the history's blocks already labelled
  since: string | null; // how far back the backfill reaches
  checked: number; // tokens whose 48h outcome was looked up
}

export interface ChainOptions {
  rpcUrl: string;
  geckoApi: string;
  geckoPerMinute: number;
  dexscreenerApi: string;
  network: string;
  pollSeconds: number;
  backfillDays: number;
  backfillSample: number; // 0–1: share of past launches looked up, picked uniformly by address hash
  stateFile: string | null;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
}

interface Candidate {
  token: string;
  firstBlock: number;
  launchedAt: number; // ms, from the block of its first pool
  pools: Set<string>;
  curve?: string; // Pons bonding curve: GeckoTerminal lists it, DexScreener does not
  creator?: string;
  nextScreenAt?: number;
}

interface SavedState {
  version: 1;
  backfillFrom: number; // oldest block the backfill labels
  backfillTo: number; // newest block it labels (48h before the first start)
  backfillFromMs: number;
  backfillCursor: number; // every launch above this block (up to backfillTo) has an outcome
  liveFrom: number; // every launch at or below this block has an outcome
  rejected: string[]; // tokens that traded but stayed under the entry line
}

interface DexPair {
  pairAddress?: string;
  pairCreatedAt?: number;
  fdv?: number;
  marketCap?: number;
  liquidity?: { usd?: number };
  baseToken?: { address?: string; name?: string; symbol?: string };
  info?: { imageUrl?: string };
}

const HOUR = 3_600_000;
const WINDOW_MS = SITE.holderSampleHours * HOUR;
const CHUNK = 30_000; // blocks per backfill step, about 50 minutes of chain time
const MINT_LOOKBACK = 900_000; // about a day of blocks before the first pool, where the supply is usually minted
const QUOTE_MIN_POOLS = 8; // a token paired in this many launches of one step is a quote asset, not a launch
const OLDER_TOKEN_MS = 6 * HOUR; // pairs older than the launch by this much mean an existing token found a new pool
const RETRAIN_AT = [20, 200, 1000, 2000]; // labelled counts that trigger an early retrain
const SCREEN_BATCHES = 2; // screening calls per tick for young tokens, so labelling keeps most of the API budget
const SCREEN_MAX_BACKLOG_MS = 30_000; // screening only decorates the feed: skip it while labelling is queued
const HUES = [38, 152, 268, 196, 12, 88, 320];

/** Uniform, restart-stable sample: a token is in or out depending on its address alone. */
const inSample = (token: string, rate: number) => rate >= 1 || parseInt(createHash('sha256').update(token).digest('hex').slice(0, 8), 16) / 0x1_0000_0000 < rate;
const hueOf = (token: string) => HUES[parseInt(token.slice(2, 4), 16) % HUES.length] ?? 38;

/**
 * Live Robinhood Chain ingest. Every pool launch is read from the chain;
 * a token's outcome is its peak market cap over its first 48 hours, taken
 * from hourly candles, and its holder count at 48h is replayed from its
 * transfers. On first start past launches are labelled the same way, newest
 * first, so the study does not start empty.
 */
export class ChainSource {
  readonly stats = {
    launches: 0,
    screened: 0,
    sampledOut: 0,
    checked: 0,
    labelled: 0,
    belowEntry: 0,
    neverTraded: 0,
    errors: 0,
    head: 0,
    lastTickAt: '',
    lastError: '',
    gecko: {} as GeckoClient['stats'],
  };
  private readonly rpc: RpcClient;
  private readonly gecko: GeckoClient;
  private state: SavedState | null = null;
  private readonly young = new Map<string, Candidate>();
  private readonly rejected = new Set<string>();
  private readonly quotes = new Set<string>([WETH, NATIVE]);
  private scannedTo = 0;
  private anchor = { block: 0, seconds: 0, perBlock: 0.1 };
  private trainedAt = 0;
  private dexNextAt = 0;
  private stopped = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly agent: Agent,
    private readonly o: ChainOptions,
  ) {
    this.rpc = new RpcClient(o.rpcUrl, { fetchImpl: o.fetchImpl, log: o.log });
    this.gecko = new GeckoClient({ network: o.network, api: o.geckoApi, perMinute: o.geckoPerMinute, fetchImpl: o.fetchImpl, sleep: o.sleep, now: o.now, log: o.log });
    this.stats.gecko = this.gecko.stats;
    this.trainedAt = agent.labelled().length;
  }

  private now() {
    return this.o.now?.() ?? Date.now();
  }

  private wait(ms: number) {
    return ms > 0 ? (this.o.sleep ?? ((t) => new Promise((resolve) => setTimeout(resolve, t))))(ms) : Promise.resolve();
  }

  start() {
    const boot = async () => {
      try {
        await this.init();
      } catch (err) {
        this.fail('start', err);
        if (!this.stopped) this.timer = setTimeout(boot, 60_000);
        return;
      }
      void this.backfillLoop();
      const tick = async () => {
        try {
          await this.liveTick();
        } catch (err) {
          this.fail('live', err);
        }
        if (!this.stopped) this.timer = setTimeout(tick, this.o.pollSeconds * 1000);
      };
      void tick();
    };
    void boot();
  }

  private fail(stage: string, err: unknown) {
    this.stats.errors++;
    this.stats.lastError = `${new Date(this.now()).toISOString()} ${stage}: ${(err as Error).message.slice(0, 200)}`;
    this.o.log?.(`chain ${stage}: ${(err as Error).message}`);
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.save();
  }

  progress(): BackfillProgress | null {
    const s = this.state;
    if (!s || s.backfillTo <= s.backfillFrom) return null;
    const done = (s.backfillTo - s.backfillCursor) / (s.backfillTo - s.backfillFrom);
    return { running: s.backfillCursor > s.backfillFrom, progress: Math.max(0, Math.min(1, done)), since: new Date(s.backfillFromMs).toISOString(), checked: this.stats.checked };
  }

  /** Anchors block times and restores or creates the backfill plan. Public for tests. */
  async init() {
    const head = await this.rpc.blockNumber();
    const headSeconds = await this.rpc.timestamp(head);
    const probe = Math.max(1, head - 1_000_000);
    const perBlock = (headSeconds - (await this.rpc.timestamp(probe))) / Math.max(1, head - probe);
    this.anchor = { block: head, seconds: headSeconds, perBlock: perBlock > 0 ? perBlock : 0.1 };
    this.stats.head = head;

    const saved = this.load();
    if (saved) {
      this.state = saved;
      saved.rejected.forEach((t) => this.rejected.add(t));
    } else {
      const nowSeconds = Math.floor(this.now() / 1000);
      const edge = await this.rpc.blockAt(nowSeconds - WINDOW_MS / 1000, head);
      const fromMs = this.now() - this.o.backfillDays * 24 * HOUR;
      const from = this.o.backfillDays > 0 ? await this.rpc.blockAt(Math.floor(fromMs / 1000), head) : edge;
      this.state = { version: 1, backfillFrom: from, backfillTo: edge - 1, backfillFromMs: fromMs, backfillCursor: edge - 1, liveFrom: edge - 1, rejected: [] };
      // Tokens the earlier DexScreener source was watching were measured another way and never labelled: start clean.
      for (const t of [...this.agent.tokens.values()]) if (t.status === 'pending') this.agent.remove(t.mint);
      this.save();
      this.o.log?.(`chain: labelling launches from block ${from} to ${edge - 1}, then following the head from ${edge}`);
    }
    this.scannedTo = this.state.liveFrom;
  }

  private async backfillLoop() {
    while (!this.stopped && this.state && this.state.backfillCursor > this.state.backfillFrom) {
      try {
        await this.backfillStep();
      } catch (err) {
        this.fail('backfill', err);
        await this.wait(30_000);
      }
    }
    if (!this.stopped && this.state && this.state.backfillTo > this.state.backfillFrom) this.o.log?.(`chain: backfill complete · ${this.agent.labelled().length} tokens labelled`);
  }

  /** Label one chunk of history, walking back from the newest block. Public for tests. */
  async backfillStep() {
    const s = this.state;
    if (!s || s.backfillCursor <= s.backfillFrom) return;
    const to = s.backfillCursor;
    const from = Math.max(s.backfillFrom, to - CHUNK + 1);
    const all = [...this.group(await this.launches(from, to)).values()];
    const picked = all.filter((c) => inSample(c.token, this.o.backfillSample));
    this.stats.sampledOut += all.length - picked.length;
    await this.resolve(picked, false);
    s.backfillCursor = from - 1;
    this.save();
    this.retrainIfDue();
  }

  /** Follow the head: discover launches, label those that turned 48h, watch the rest. Public for tests. */
  async liveTick() {
    const head = await this.rpc.blockNumber();
    this.stats.head = head;
    if (head > this.scannedTo) {
      for (const c of this.group(await this.launches(this.scannedTo + 1, head)).values()) {
        const known = this.young.get(c.token);
        if (!known) this.young.set(c.token, c);
        else c.pools.forEach((p) => known.pools.add(p));
      }
      this.scannedTo = head;
      this.anchor = { ...this.anchor, block: head, seconds: await this.rpc.timestamp(head) };
    }

    const now = this.now();
    const matured = [...this.young.values()].filter((c) => c.launchedAt + WINDOW_MS <= now);
    if (matured.length) {
      await this.resolve(matured, true);
      matured.forEach((c) => this.young.delete(c.token));
      this.retrainIfDue();
    }
    await this.watch(now);

    if (this.state) {
      const waiting = [...this.young.values()].reduce((min, c) => Math.min(min, c.firstBlock), Infinity);
      this.state.liveFrom = Number.isFinite(waiting) ? waiting - 1 : this.scannedTo;
      this.save();
    }
    this.stats.lastTickAt = new Date(now).toISOString();
  }

  private async launches(from: number, to: number): Promise<(PoolLaunch & { at: number })[]> {
    const logs = await this.rpc.getLogs({ fromBlock: from, toBlock: to, topics: [LAUNCH_TOPICS] });
    const [first, last] = await Promise.all([this.rpc.timestamp(from), this.rpc.timestamp(to)]);
    const at = (block: number) => (to === from ? first : first + ((block - from) * (last - first)) / (to - from)) * 1000;
    const out: (PoolLaunch & { at: number })[] = [];
    for (const log of logs) {
      const launch = decodeLaunch(log);
      if (launch) out.push({ ...launch, at: at(launch.block) });
    }
    this.stats.launches += out.length;
    return out;
  }

  /** One candidate per token launched against a quote asset (WETH, ETH, USDG, stock tokens). */
  private group(launches: (PoolLaunch & { at: number })[]): Map<string, Candidate> {
    const seen = new Map<string, number>();
    for (const l of launches) for (const t of [l.tokenA, l.tokenB]) seen.set(t, (seen.get(t) ?? 0) + 1);
    for (const [t, n] of seen) if (n >= QUOTE_MIN_POOLS) this.quotes.add(t);

    const out = new Map<string, Candidate>();
    for (const l of launches) {
      for (const [token, other] of [
        [l.tokenA, l.tokenB],
        [l.tokenB, l.tokenA],
      ]) {
        if (this.quotes.has(token) || !this.quotes.has(other)) continue;
        const c = out.get(token) ?? { token, firstBlock: l.block, launchedAt: l.at, pools: new Set<string>(), creator: l.creator };
        c.pools.add(l.pool);
        if (l.kind === 'pons') c.curve = l.pool;
        if (l.block < c.firstBlock) Object.assign(c, { firstBlock: l.block, launchedAt: l.at });
        out.set(token, c);
      }
    }
    return out;
  }

  // #region stage:ingest
  /** The 48h outcome of each candidate: peak market cap from hourly candles, holders replayed from transfers. */
  private async resolve(candidates: Candidate[], announce: boolean) {
    const open = candidates.filter((c) => !this.rejected.has(c.token) && !this.quotes.has(c.token) && (this.agent.tokens.get(c.token)?.status ?? 'pending') === 'pending');
    const pairs = await this.dexPairs(open.map((c) => c.token));

    for (const c of open) {
      if (this.stopped) return;
      const listed = pairs.get(c.token) ?? [];
      const firstPair = Math.min(...listed.map((p) => p.pairCreatedAt ?? Infinity));
      if (firstPair < c.launchedAt - OLDER_TOKEN_MS) {
        this.quotes.add(c.token); // an existing token found a new pool; it did not launch here
        continue;
      }
      const launchedAt = Math.min(c.launchedAt, firstPair);
      const windowEnd = launchedAt + WINDOW_MS;
      const pools = listed
        .filter((p) => p.pairAddress && (p.pairCreatedAt ?? 0) <= windowEnd)
        .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))
        .map((p) => p.pairAddress!.toLowerCase())
        .slice(0, 2);
      if (c.curve && !pools.includes(c.curve)) pools.push(c.curve); // bonding-curve trades happen before any DEX pool
      if (!pools.length) {
        this.stats.neverTraded++; // not listed anywhere: nobody traded it
        continue;
      }

      // A failed lookup throws, so the whole step is retried later rather than mislabelled.
      let peak: number | null = null;
      for (const pool of pools.slice(0, 3)) {
        const high = await this.gecko.peakPrice(pool, c.token, Math.floor(launchedAt / 1000), Math.floor(windowEnd / 1000));
        if (high != null) peak = Math.max(peak ?? 0, high);
      }
      this.stats.checked++;
      if (peak == null) {
        this.stats.neverTraded++;
        this.drop(c.token);
        continue;
      }

      const [meta] = await this.gecko.tokens([c.token]);
      const peakMc = peak * (meta?.supply ?? 0);
      if (!meta || !(peakMc >= SITE.entryMc)) {
        this.stats.belowEntry++;
        this.rejected.add(c.token);
        this.drop(c.token);
        continue;
      }

      const holders = await this.holders(c, windowEnd).catch(() => null);
      const at = new Date(launchedAt);
      const prior = this.agent.tokens.get(c.token);
      const pair = listed.find((p) => p.baseToken?.name);
      this.agent.upsert(
        {
          mint: c.token,
          name: meta.name || pair?.baseToken?.name || c.token.slice(0, 10),
          symbol: meta.symbol || pair?.baseToken?.symbol || 'TKN',
          lore: prior?.lore ?? '',
          loreRaw: '', // lore cannot be observed for past launches, so no token trains on it
          loreWithheld: false,
          holders: holders ?? 0,
          holdersMissing: holders == null,
          peakMc: Math.round(peakMc),
          status: peakMc >= SITE.targetMc ? 'passed' : 'stalled',
          hour: at.getUTCHours(),
          dow: (at.getUTCDay() + 6) % 7,
          launchedAt: at.toISOString(),
          deployer: c.creator ?? '',
          hue: hueOf(c.token),
          logo: dexImageUrl(listed.find((p) => p.info?.imageUrl)?.info?.imageUrl) ?? prior?.logo ?? meta.imageUrl,
        },
        announce,
      );
      this.stats.labelled++;
    }
  }
  // #endregion

  /** Young tokens that already cleared the entry line are shown as "watching" until their 48h label. */
  private async watch(now: number) {
    const due = [...this.young.values()]
      .filter((c) => now - c.launchedAt >= 30 * 60_000 && now >= (c.nextScreenAt ?? 0))
      .sort((a, b) => b.launchedAt - a.launchedAt);
    const busy = this.gecko.backlogMs() > SCREEN_MAX_BACKLOG_MS;
    const curves = busy ? [] : due.filter((c) => c.curve).slice(0, SCREEN_BATCHES * 30);
    const others = due.filter((c) => !c.curve).slice(0, SCREEN_BATCHES * 30);
    [...curves, ...others].forEach((c) => (c.nextScreenAt = now + Math.max(HOUR, (now - c.launchedAt) / 2)));

    const pending = [...this.agent.tokens.values()].filter((t) => t.status === 'pending').map((t) => t.mint.toLowerCase());
    const pendingCurves = busy ? [] : pending.map((t) => this.young.get(t)).filter((c): c is Candidate => !!c?.curve).slice(0, SCREEN_BATCHES * 30);
    const seen = new Map<string, { cap: number; name?: string; symbol?: string; logo?: string }>();

    // Bonding curves are on GeckoTerminal only.
    const curveOwners = new Map([...curves, ...pendingCurves].map((c) => [c.curve!, c.token]));
    for (const p of await this.gecko.pools([...curveOwners.keys()])) {
      const token = curveOwners.get(p.address);
      if (token) seen.set(token, { cap: Math.max(seen.get(token)?.cap ?? 0, p.fdvUsd), name: p.name.split(' / ')[0] });
    }
    // DEX pools, including graduated curves, come from DexScreener.
    for (const [token, listed] of await this.dexPairs([...new Set([...others.map((c) => c.token), ...pending])])) {
      const pair = listed.find((p) => p.baseToken?.name) ?? listed[0];
      const prev = seen.get(token);
      seen.set(token, {
        cap: Math.max(prev?.cap ?? 0, ...listed.map((p) => p.fdv ?? p.marketCap ?? 0)),
        name: pair?.baseToken?.name ?? prev?.name,
        symbol: pair?.baseToken?.symbol,
        logo: dexImageUrl(listed.find((p) => p.info?.imageUrl)?.info?.imageUrl),
      });
    }

    for (const [token, s] of seen) {
      const existing = this.agent.tokens.get(token);
      if (existing) {
        if (existing.status === 'pending' && s.cap > existing.peakMc) this.agent.upsert({ ...existing, peakMc: Math.round(s.cap), logo: existing.logo ?? s.logo }, false);
        continue;
      }
      const c = this.young.get(token);
      if (!c || s.cap < SITE.entryMc) continue;
      const at = new Date(c.launchedAt);
      this.agent.upsert({
        mint: token,
        name: s.name || token.slice(0, 10),
        symbol: s.symbol || 'TKN',
        lore: '',
        loreRaw: '',
        loreWithheld: false,
        holders: 0,
        holdersMissing: true,
        peakMc: Math.round(s.cap),
        status: 'pending',
        hour: at.getUTCHours(),
        dow: (at.getUTCDay() + 6) % 7,
        launchedAt: at.toISOString(),
        deployer: c.creator ?? '',
        hue: hueOf(token),
        logo: s.logo,
      });
    }
  }

  private drop(token: string) {
    if (this.agent.tokens.get(token)?.status === 'pending') this.agent.remove(token);
  }

  private async holders(c: Candidate, windowEnd: number): Promise<number> {
    const end = Math.min(this.stats.head || this.anchor.block, this.blockFor(windowEnd));
    return holdersAt(this.rpc, c.token, Math.max(0, c.firstBlock - MINT_LOOKBACK), end);
  }

  private blockFor(ms: number) {
    return Math.max(0, Math.round(this.anchor.block - (this.anchor.seconds - ms / 1000) / this.anchor.perBlock));
  }

  private async dexPairs(tokens: string[]): Promise<Map<string, DexPair[]>> {
    const out = new Map<string, DexPair[]>();
    for (let i = 0; i < tokens.length && !this.stopped; i += 30) {
      const chunk = tokens.slice(i, i + 30);
      const body = await this.dexGet<DexPair[]>(`/tokens/v1/${this.o.network}/${chunk.join(',')}`);
      for (const p of Array.isArray(body) ? body : []) {
        const base = p.baseToken?.address?.toLowerCase();
        if (base && chunk.includes(base)) out.set(base, [...(out.get(base) ?? []), p]);
      }
      this.stats.screened += chunk.length;
    }
    return out;
  }

  private async dexGet<T>(path: string): Promise<T | null> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const at = Math.max(this.now(), this.dexNextAt);
      this.dexNextAt = at + 250; // DexScreener allows 300 requests a minute on this endpoint
      await this.wait(at - this.now());
      try {
        const res = await (this.o.fetchImpl ?? fetch)(`${this.o.dexscreenerApi}${path}`, { headers: { accept: 'application/json' } });
        if (res.status === 429) {
          this.dexNextAt = this.now() + 60_000;
          continue;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as T;
      } catch (err) {
        this.o.log?.(`dexscreener ${path.slice(0, 40)}: ${(err as Error).message}`);
        this.dexNextAt = this.now() + 5_000 * (attempt + 1);
      }
    }
    throw new Error(`dexscreener unavailable for ${path.slice(0, 40)}`); // "unlisted" must never be inferred from a failed call
  }

  private retrainIfDue() {
    const n = this.agent.labelled().length;
    if (RETRAIN_AT.some((mark) => this.trainedAt < mark && n >= mark)) {
      this.trainedAt = n;
      this.agent.runCycle();
    }
  }

  private load(): SavedState | null {
    if (!this.o.stateFile || !existsSync(this.o.stateFile)) return null;
    try {
      const s = JSON.parse(readFileSync(this.o.stateFile, 'utf8')) as SavedState;
      return s.version === 1 ? s : null;
    } catch {
      return null;
    }
  }

  private save() {
    if (!this.o.stateFile || !this.state) return;
    this.state.rejected = [...this.rejected];
    const tmp = `${this.o.stateFile}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state));
    renameSync(tmp, this.o.stateFile);
  }
}
