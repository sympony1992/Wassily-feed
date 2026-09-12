import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { SITE } from '@/config/site';
import type { Agent } from '../agent';
import { LAUNCH_TOPICS, NATIVE, TOPICS, WETH, decodeLaunch, type PoolLaunch } from '../chain/abi';
import { GeckoClient } from '../chain/gecko';
import { holdersAt } from '../chain/holders';
import { ponsPeaks, tradePrice } from '../chain/pons';
import { QuotePrices } from '../chain/prices';
import { RpcClient } from '../chain/rpc';
import { TokenInfoCache } from '../chain/tokens';
import { dexImageUrl } from './dexImage';

export interface BackfillProgress {
  running: boolean;
  progress: number; // share of the history's blocks already labelled, averaged over both passes
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
  curve?: string; // Pons bonding curve
  quote?: string; // what a Pons curve trades against
  creator?: string;
  nextScreenAt?: number;
  peakCap?: number; // best cap the live trade scan has seen, for the "watching" feed only
}

interface SavedState {
  version: 2;
  backfillFrom: number; // oldest block the backfill labels
  backfillTo: number; // newest block it labels (48h before the first start)
  backfillFromMs: number;
  backfillCursor: number; // Pons pass: every launch above this block has an outcome
  slowCursor: number; // other venues, which need GeckoTerminal and follow at its pace
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

interface HolderJob {
  token: string;
  fromBlock: number;
  windowEnd: number;
  tries: number;
}

const HOUR = 3_600_000;
const WINDOW_MS = SITE.holderSampleHours * HOUR;
const CHUNK = 30_000; // blocks per backfill step, about 50 minutes of chain time
const MINT_LOOKBACK = 900_000; // about a day of blocks before a DEX launch, where the supply is usually minted
const QUOTE_MIN_POOLS = 8; // a token paired in this many launches of one step is a quote asset, not a launch
const OLDER_TOKEN_MS = 6 * HOUR; // pairs older than the launch by this much mean an existing token found a new pool
const RETRAIN_AT = [20, 200, 1000, 2000]; // labelled counts that trigger an early retrain
const SLOW_LIVE_BATCH = 10;
const MATURED_PER_TICK = 400; // after a restart the backlog is labelled in slices, so every tick finishes and saves its place
const HOLDERS_PARALLEL = 3;
const LOGO_MAX_BACKLOG_MS = 10_000; // logos only decorate the feed: fetch them when GeckoTerminal is idle
const WATCH_SCAN_MAX_BLOCKS = 5_000;
const HUES = [38, 152, 268, 196, 12, 88, 320];

/** Uniform, restart-stable sample: a token is in or out depending on its address alone. */
const inSample = (token: string, rate: number) => rate >= 1 || parseInt(createHash('sha256').update(token).digest('hex').slice(0, 8), 16) / 0x1_0000_0000 < rate;
const hueOf = (token: string) => HUES[parseInt(token.slice(2, 4), 16) % HUES.length] ?? 38;

/**
 * Live Robinhood Chain ingest. Every pool launch is read from the chain and
 * each token's outcome is its peak market cap over its first 48 hours:
 * for Pons launchpad tokens straight from the curve's trade events, for other
 * venues from GeckoTerminal's hourly candles. Holders at 48h are replayed from
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
    slowQueued: 0,
    holdersQueued: 0,
    errors: 0,
    head: 0,
    lastTickAt: '',
    liveStage: '', // what the live tick is doing right now
    lastError: '',
    errorsByStage: {} as Record<string, number>,
    lastErrors: {} as Record<string, string>,
    cursors: { backfill: 0, slow: 0, live: 0, from: 0 },
    gecko: {} as GeckoClient['stats'],
  };
  private readonly rpc: RpcClient;
  private readonly gecko: GeckoClient;
  private readonly tokenInfo: TokenInfoCache;
  private readonly prices: QuotePrices;
  private state: SavedState | null = null;
  private readonly young = new Map<string, Candidate>();
  private readonly slowLive: Candidate[] = [];
  private readonly holderQueue: HolderJob[] = [];
  private readonly logoQueue: string[] = [];
  private readonly rejected = new Set<string>();
  private readonly quotes = new Set<string>([WETH, NATIVE]);
  private scannedTo = 0;
  private tradesScannedTo = 0;
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
    this.tokenInfo = new TokenInfoCache(this.rpc);
    this.prices = new QuotePrices(this.gecko, () => Math.floor(this.now() / 1000));
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
      void this.loop('backfill', () => this.backfillStep(), () => !!this.state && this.state.backfillCursor > this.state.backfillFrom);
      void this.loop('slow', () => (this.slowLive.length ? this.labelQueued() : this.slowStep()), () => this.slowLive.length > 0 || (!!this.state && this.state.slowCursor > this.state.backfillFrom));
      void this.loop('holders', () => this.holdersBatch(), () => this.holderQueue.length > 0);
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

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.save();
  }

  progress(): BackfillProgress | null {
    const s = this.state;
    if (!s || s.backfillTo <= s.backfillFrom) return null;
    const span = s.backfillTo - s.backfillFrom;
    const done = (s.backfillTo - s.backfillCursor + (s.backfillTo - s.slowCursor)) / (2 * span);
    return {
      running: s.backfillCursor > s.backfillFrom || s.slowCursor > s.backfillFrom,
      progress: Math.max(0, Math.min(1, done)),
      since: new Date(s.backfillFromMs).toISOString(),
      checked: this.stats.checked,
    };
  }

  /** Anchors block times and restores or creates the backfill plan. Public for tests. */
  async init() {
    const head = await this.rpc.blockNumber();
    const headSeconds = await this.rpc.timestamp(head);
    const probe = Math.max(1, head - 1_000_000);
    const perBlock = (headSeconds - (await this.rpc.timestamp(probe))) / Math.max(1, head - probe);
    this.anchor = { block: head, seconds: headSeconds, perBlock: perBlock > 0 ? perBlock : 0.1 };
    this.stats.head = head;
    this.tradesScannedTo = head;

    const saved = this.load();
    if (saved) {
      this.state = saved;
      saved.rejected.forEach((t) => this.rejected.add(t));
    } else {
      const nowSeconds = Math.floor(this.now() / 1000);
      const edge = await this.rpc.blockAt(nowSeconds - WINDOW_MS / 1000, head);
      const fromMs = this.now() - this.o.backfillDays * 24 * HOUR;
      const from = this.o.backfillDays > 0 ? await this.rpc.blockAt(Math.floor(fromMs / 1000), head) : edge;
      this.state = { version: 2, backfillFrom: from, backfillTo: edge - 1, backfillFromMs: fromMs, backfillCursor: edge - 1, slowCursor: edge - 1, liveFrom: edge - 1, rejected: [] };
      // Tokens the earlier DexScreener source was watching were measured another way and never labelled: start clean.
      for (const t of [...this.agent.tokens.values()]) if (t.status === 'pending') this.agent.remove(t.mint);
      this.save();
      this.o.log?.(`chain: labelling launches from block ${from} to ${edge - 1}, then following the head from ${edge}`);
    }
    // Holder counts that were still being replayed when the process stopped.
    for (const t of this.agent.tokens.values()) {
      if (t.status === 'pending' || !t.holdersMissing) continue;
      const launched = Date.parse(t.launchedAt);
      this.holderQueue.push({ token: t.mint.toLowerCase(), fromBlock: Math.max(0, this.blockFor(launched) - MINT_LOOKBACK), windowEnd: launched + WINDOW_MS, tries: 0 });
    }
    this.scannedTo = this.state.liveFrom;
  }

  /** Runs `step` while there is work, idling when there is none and backing off after a failure. */
  private async loop(stage: string, step: () => Promise<void>, hasWork: () => boolean) {
    while (!this.stopped) {
      if (!hasWork()) {
        await this.wait(15_000);
        continue;
      }
      try {
        await step();
      } catch (err) {
        this.fail(stage, err);
        await this.wait(30_000);
      }
    }
  }

  /** Pons pass over one chunk of history, walking back from the newest block. Public for tests. */
  async backfillStep() {
    const s = this.state;
    if (!s || s.backfillCursor <= s.backfillFrom) return;
    const to = s.backfillCursor;
    const from = Math.max(s.backfillFrom, to - CHUNK + 1);
    const candidates = [...this.group(await this.launches(from, to, true)).values()].filter((c) => c.curve);
    await this.resolvePons(this.sampled(candidates), false);
    s.backfillCursor = from - 1;
    if (s.backfillCursor <= s.backfillFrom) this.o.log?.(`chain: Pons history labelled · ${this.agent.labelled().length} tokens so far`);
    this.save();
    this.retrainIfDue();
  }

  /** The same chunk for every other venue; it waits on GeckoTerminal, so it runs on its own. Public for tests. */
  async slowStep() {
    const s = this.state;
    if (!s || s.slowCursor <= s.backfillFrom) return;
    const to = s.slowCursor;
    const from = Math.max(s.backfillFrom, to - CHUNK + 1);
    const candidates = [...this.group(await this.launches(from, to, false)).values()].filter((c) => !c.curve);
    await this.resolveDex(this.sampled(candidates), false);
    s.slowCursor = from - 1;
    this.save();
    this.retrainIfDue();
  }

  /** Young non-Pons tokens that turned 48h. They need GeckoTerminal, so they queue here rather than stall the live tick. Public for tests. */
  async labelQueued() {
    while (this.slowLive.length && !this.stopped) {
      const batch = this.slowLive.slice(0, SLOW_LIVE_BATCH);
      await this.resolveDex(batch, true);
      this.slowLive.splice(0, batch.length);
      this.stats.slowQueued = this.slowLive.length;
      this.retrainIfDue();
    }
  }

  /** Follow the head: discover launches, label those that turned 48h, watch the rest. Public for tests. */
  async liveTick() {
    this.stats.liveStage = 'reading launches';
    const head = await this.rpc.blockNumber();
    this.stats.head = head;
    if (head > this.scannedTo) {
      for (const c of this.group(await this.launches(this.scannedTo + 1, head, true)).values()) {
        const known = this.young.get(c.token);
        if (!known) this.young.set(c.token, c);
        else c.pools.forEach((p) => known.pools.add(p));
      }
      this.scannedTo = head;
      this.anchor = { ...this.anchor, block: head, seconds: await this.rpc.timestamp(head) };
    }

    const now = this.now();
    const matured = [...this.young.values()].filter((c) => c.launchedAt + WINDOW_MS <= now).slice(0, MATURED_PER_TICK);
    if (matured.length) {
      this.stats.liveStage = `labelling ${matured.length} tokens that turned 48h`;
      await this.resolvePons(matured.filter((c) => c.curve), true);
      this.slowLive.push(...matured.filter((c) => !c.curve));
      matured.forEach((c) => this.young.delete(c.token));
      this.retrainIfDue();
    }
    this.stats.liveStage = 'following curve trades';
    await this.scanCurveTrades(head, now);
    this.stats.liveStage = 'updating the watch list';
    await this.watch(now);
    this.stats.liveStage = 'fetching logos';
    await this.fetchLogos(false);

    this.stats.slowQueued = this.slowLive.length;
    this.stats.holdersQueued = this.holderQueue.length;
    if (this.state) {
      const waiting = [...this.young.values(), ...this.slowLive].reduce((min, c) => Math.min(min, c.firstBlock), Infinity);
      this.state.liveFrom = Number.isFinite(waiting) ? waiting - 1 : this.scannedTo;
      this.save();
    }
    this.stats.lastTickAt = new Date(now).toISOString();
    this.stats.liveStage = 'idle';
  }

  private async launches(from: number, to: number, count: boolean): Promise<(PoolLaunch & { at: number })[]> {
    const logs = await this.rpc.getLogs({ fromBlock: from, toBlock: to, topics: [LAUNCH_TOPICS] });
    const [first, last] = await Promise.all([this.rpc.timestamp(from), this.rpc.timestamp(to)]);
    const at = (block: number) => (to === from ? first : first + ((block - from) * (last - first)) / (to - from)) * 1000;
    const out: (PoolLaunch & { at: number })[] = [];
    for (const log of logs) {
      const launch = decodeLaunch(log);
      if (launch) out.push({ ...launch, at: at(launch.block) });
    }
    if (count) this.stats.launches += out.length;
    return out;
  }

  /** One candidate per launched token: Pons launches, and DEX pools opened against a quote asset (WETH, ETH, USDG, stock tokens). */
  private group(launches: (PoolLaunch & { at: number })[]): Map<string, Candidate> {
    const seen = new Map<string, number>();
    for (const l of launches) {
      if (l.kind === 'pons') this.quotes.add(l.tokenB);
      else for (const t of [l.tokenA, l.tokenB]) seen.set(t, (seen.get(t) ?? 0) + 1);
    }
    for (const [t, n] of seen) if (n >= QUOTE_MIN_POOLS) this.quotes.add(t);

    const out = new Map<string, Candidate>();
    const add = (l: PoolLaunch & { at: number }, token: string) => {
      const c = out.get(token) ?? { token, firstBlock: l.block, launchedAt: l.at, pools: new Set<string>(), creator: l.creator };
      c.pools.add(l.pool);
      if (l.kind === 'pons') Object.assign(c, { curve: l.pool, quote: l.tokenB, creator: l.creator });
      if (l.block < c.firstBlock) Object.assign(c, { firstBlock: l.block, launchedAt: l.at });
      out.set(token, c);
    };
    for (const l of launches) {
      if (l.kind === 'pons') {
        if (!this.quotes.has(l.tokenA)) add(l, l.tokenA);
        continue;
      }
      if (!this.quotes.has(l.tokenA) && this.quotes.has(l.tokenB)) add(l, l.tokenA);
      if (!this.quotes.has(l.tokenB) && this.quotes.has(l.tokenA)) add(l, l.tokenB);
    }
    return out;
  }

  private sampled(candidates: Candidate[]) {
    const picked = candidates.filter((c) => inSample(c.token, this.o.backfillSample));
    this.stats.sampledOut += candidates.length - picked.length;
    return picked;
  }

  private open(candidates: Candidate[]) {
    return candidates.filter((c) => !this.rejected.has(c.token) && !this.quotes.has(c.token) && (this.agent.tokens.get(c.token)?.status ?? 'pending') === 'pending');
  }

  // #region stage:ingest
  /** Pons launches: the 48h peak comes straight from the curve's trades on-chain. */
  private async resolvePons(candidates: Candidate[], announce: boolean) {
    const open = this.open(candidates).filter((c) => c.curve);
    if (!open.length) return;
    const peaks = await ponsPeaks(
      this.rpc,
      this.prices,
      this.tokenInfo,
      open.map((c) => ({ token: c.token, curve: c.curve!, quote: c.quote ?? WETH, firstBlock: c.firstBlock })),
      { windowBlocks: this.windowBlocks(), head: this.stats.head || this.anchor.block, secondsAt: (block) => this.secondsAt(block) },
    );

    for (const c of open) {
      if (this.stopped) return;
      this.stats.checked++;
      const peak = peaks.get(c.token);
      const info = peak?.trades ? await this.tokenInfo.get(c.token) : null; // an untraded curve costs no further calls
      if (!peak?.trades || !info) {
        this.stats.neverTraded++;
        this.drop(c.token);
        continue;
      }
      let cap = peak.peakPrice * info.supply;
      // Graduated inside the window: trading moved to a DEX pool, which only matters if the curve did not settle the label.
      if (cap < SITE.targetMc) {
        for (const pool of [...c.pools].filter((p) => p !== c.curve).slice(0, 2)) {
          const high = await this.gecko.peakPrice(pool, c.token, Math.floor(c.launchedAt / 1000), Math.floor((c.launchedAt + WINDOW_MS) / 1000));
          if (high != null) cap = Math.max(cap, high * info.supply);
        }
      }
      await this.finish(c, c.launchedAt, cap, undefined, undefined, undefined, announce);
    }
  }

  /** Other venues: DexScreener says where a token trades, GeckoTerminal's hourly candles give the 48h peak. */
  private async resolveDex(candidates: Candidate[], announce: boolean) {
    const open = this.open(candidates).filter((c) => !c.curve);
    if (!open.length) return;
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
      if (!pools.length) {
        this.stats.neverTraded++; // not listed anywhere: nobody traded it
        continue;
      }

      // A failed lookup throws, so the whole step is retried later rather than mislabelled.
      let peak: number | null = null;
      for (const pool of pools) {
        const high = await this.gecko.peakPrice(pool, c.token, Math.floor(launchedAt / 1000), Math.floor(windowEnd / 1000));
        if (high != null) peak = Math.max(peak ?? 0, high);
      }
      this.stats.checked++;
      const info = peak == null ? null : await this.tokenInfo.get(c.token);
      if (peak == null || !info) {
        this.stats.neverTraded++;
        this.drop(c.token);
        continue;
      }
      const pair = listed.find((p) => p.baseToken?.name);
      const logo = dexImageUrl(listed.find((p) => p.info?.imageUrl)?.info?.imageUrl);
      await this.finish(c, launchedAt, peak * info.supply, pair?.baseToken?.name, pair?.baseToken?.symbol, logo, announce);
    }
  }

  /** The label: under the entry line leaves the study, $30K or more passed, otherwise stalled. */
  private async finish(c: Candidate, launchedAt: number, cap: number, fallbackName: string | undefined, fallbackSymbol: string | undefined, logo: string | undefined, announce: boolean) {
    if (!(cap >= SITE.entryMc)) {
      this.stats.belowEntry++;
      this.rejected.add(c.token);
      this.drop(c.token);
      return;
    }
    const label = await this.tokenInfo.label(c.token).catch(() => null); // names only for labelled tokens
    const at = new Date(launchedAt);
    const prior = this.agent.tokens.get(c.token);
    this.agent.upsert(
      {
        mint: c.token,
        name: label?.name || fallbackName || prior?.name || c.token.slice(0, 10),
        symbol: label?.symbol || fallbackSymbol || prior?.symbol || 'TKN',
        lore: prior?.lore ?? '',
        loreRaw: '', // lore cannot be observed for past launches, so no token trains on it
        loreWithheld: false,
        holders: 0,
        holdersMissing: true, // replayed from transfers in the background
        peakMc: Math.round(cap),
        status: cap >= SITE.targetMc ? 'passed' : 'stalled',
        hour: at.getUTCHours(),
        dow: (at.getUTCDay() + 6) % 7,
        launchedAt: at.toISOString(),
        deployer: c.creator ?? '',
        hue: hueOf(c.token),
        logo: logo ?? prior?.logo,
      },
      announce,
    );
    this.stats.labelled++;
    this.holderQueue.push({ token: c.token, fromBlock: Math.max(0, c.curve ? c.firstBlock : c.firstBlock - MINT_LOOKBACK), windowEnd: launchedAt + WINDOW_MS, tries: 0 });
    if (!logo && !prior?.logo) this.logoQueue.push(c.token);
  }
  // #endregion

  /** Holder counts at 48h, replayed from transfers a few tokens at a time. */
  private async holdersBatch() {
    const batch = this.holderQueue.splice(0, HOLDERS_PARALLEL);
    await Promise.all(
      batch.map(async (job) => {
        try {
          const end = Math.min(this.stats.head || this.anchor.block, this.blockFor(job.windowEnd));
          const holders = await holdersAt(this.rpc, job.token, job.fromBlock, end);
          const t = this.agent.tokens.get(job.token);
          if (t && t.status !== 'pending') this.agent.upsert({ ...t, holders, holdersMissing: false }, false);
        } catch (err) {
          if (++job.tries < 3) this.holderQueue.push(job);
          else this.o.log?.(`chain holders ${job.token}: ${(err as Error).message}`);
        }
      }),
    );
    this.stats.holdersQueued = this.holderQueue.length;
  }

  /** Public for tests. */
  async drainHolders() {
    while (this.holderQueue.length) await this.holdersBatch();
  }

  /** Real logos from GeckoTerminal for tokens DexScreener did not provide one for. */
  private async fetchLogos(force: boolean) {
    if (!this.logoQueue.length || (!force && this.gecko.backlogMs() > LOGO_MAX_BACKLOG_MS)) return;
    const batch = this.logoQueue.splice(0, 30);
    try {
      for (const meta of await this.gecko.tokens(batch)) {
        const t = this.agent.tokens.get(meta.address);
        if (t && !t.logo && meta.imageUrl) this.agent.upsert({ ...t, logo: meta.imageUrl }, false);
      }
    } catch {
      this.logoQueue.push(...batch); // try again on a quieter tick
    }
  }

  /** Public for tests. */
  async drainLogos() {
    while (this.logoQueue.length) await this.fetchLogos(true);
  }

  /** Follow new Pons trades as blocks arrive, so young curves can show as "watching". Labels never use this scan. */
  private async scanCurveTrades(head: number, now: number) {
    if (head <= this.tradesScannedTo) return;
    const from = Math.max(this.tradesScannedTo + 1, head - WATCH_SCAN_MAX_BLOCKS);
    const logs = await this.rpc.getLogs({ fromBlock: from, toBlock: head, topics: [TOPICS.ponsTrade] });
    this.tradesScannedTo = head;
    const owners = new Map<string, Candidate>();
    for (const c of this.young.values()) if (c.curve) owners.set(c.curve, c);
    const seconds = Math.floor(now / 1000);
    for (const log of logs) {
      const c = owners.get(log.address.toLowerCase());
      if (!c) continue;
      const quote = c.quote ?? WETH;
      const [info, quoteInfo] = await Promise.all([this.tokenInfo.get(c.token), quote === WETH ? null : this.tokenInfo.get(quote)]);
      const price = info ? tradePrice(log.data, quote === WETH ? 18 : (quoteInfo?.decimals ?? 18), info.decimals) : null;
      if (price == null || !info) continue;
      c.peakCap = Math.max(c.peakCap ?? 0, price * (await this.prices.usdAt(quote, seconds)) * info.supply);
    }
  }

  /** Young tokens that already cleared the entry line are shown as "watching" until their 48h label. */
  private async watch(now: number) {
    for (const c of this.young.values()) {
      if (!c.curve || !c.peakCap) continue;
      const existing = this.agent.tokens.get(c.token);
      if (existing) {
        if (existing.status === 'pending' && c.peakCap > existing.peakMc) this.agent.upsert({ ...existing, peakMc: Math.round(c.peakCap) }, false);
      } else if (c.peakCap >= SITE.entryMc) {
        const label = await this.tokenInfo.label(c.token).catch(() => null);
        this.showPending(c, c.peakCap, label?.name, label?.symbol, undefined);
      }
    }

    // Other venues come from DexScreener, 30 tokens a call.
    const due = [...this.young.values()].filter((c) => !c.curve && now - c.launchedAt >= 30 * 60_000 && now >= (c.nextScreenAt ?? 0)).slice(0, 600);
    due.forEach((c) => (c.nextScreenAt = now + Math.max(HOUR, (now - c.launchedAt) / 2)));
    const pending = [...this.agent.tokens.values()].filter((t) => t.status === 'pending' && !this.young.get(t.mint.toLowerCase())?.curve).map((t) => t.mint.toLowerCase());
    const lookup = [...new Set([...due.map((c) => c.token), ...pending])];
    if (!lookup.length) return;
    for (const [token, listed] of await this.dexPairs(lookup)) {
      const cap = Math.max(...listed.map((p) => p.fdv ?? p.marketCap ?? 0));
      const existing = this.agent.tokens.get(token);
      if (existing) {
        if (existing.status === 'pending' && cap > existing.peakMc) this.agent.upsert({ ...existing, peakMc: Math.round(cap) }, false);
        continue;
      }
      const c = this.young.get(token);
      if (!c || cap < SITE.entryMc) continue;
      const pair = listed.find((p) => p.baseToken?.name) ?? listed[0];
      this.showPending(c, cap, pair?.baseToken?.name, pair?.baseToken?.symbol, dexImageUrl(listed.find((p) => p.info?.imageUrl)?.info?.imageUrl));
    }
  }

  private showPending(c: Candidate, cap: number, name: string | undefined, symbol: string | undefined, logo: string | undefined) {
    const at = new Date(c.launchedAt);
    this.agent.upsert({
      mint: c.token,
      name: name || c.token.slice(0, 10),
      symbol: symbol || 'TKN',
      lore: '',
      loreRaw: '',
      loreWithheld: false,
      holders: 0,
      holdersMissing: true,
      peakMc: Math.round(cap),
      status: 'pending',
      hour: at.getUTCHours(),
      dow: (at.getUTCDay() + 6) % 7,
      launchedAt: at.toISOString(),
      deployer: c.creator ?? '',
      hue: hueOf(c.token),
      logo,
    });
    if (!logo) this.logoQueue.push(c.token);
  }

  private drop(token: string) {
    if (this.agent.tokens.get(token)?.status === 'pending') this.agent.remove(token);
  }

  private windowBlocks() {
    return Math.round(WINDOW_MS / 1000 / this.anchor.perBlock);
  }

  private secondsAt(block: number) {
    return this.anchor.seconds - (this.anchor.block - block) * this.anchor.perBlock;
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

  private fail(stage: string, err: unknown) {
    const message = String((err as Error)?.message ?? err).slice(0, 200);
    // The first frames of the stack say which call failed; Railway logs are not always at hand.
    const where = String((err as Error)?.stack ?? '')
      .split('\n')
      .slice(1, 4)
      .map((line) => line.trim().replace(/^at /, '').replace(/\(?(?:file:\/\/)?\/app\//, '('))
      .join(' ← ');
    this.stats.errors++;
    this.stats.errorsByStage[stage] = (this.stats.errorsByStage[stage] ?? 0) + 1;
    this.stats.lastErrors[stage] = `${new Date(this.now()).toISOString()} ${message}${where ? ` @ ${where}` : ''}`;
    this.stats.lastError = `${new Date(this.now()).toISOString()} ${stage}: ${message}`;
    this.o.log?.(`chain ${stage}: ${message}`);
  }

  private load(): SavedState | null {
    if (!this.o.stateFile || !existsSync(this.o.stateFile)) return null;
    try {
      const s = JSON.parse(readFileSync(this.o.stateFile, 'utf8')) as SavedState | (Omit<SavedState, 'version' | 'slowCursor'> & { version: 1 });
      if (s.version === 2) return s;
      if (s.version === 1) return { ...s, version: 2, slowCursor: s.backfillCursor };
      return null;
    } catch {
      return null;
    }
  }

  private save() {
    if (!this.state) return;
    this.stats.cursors = { backfill: this.state.backfillCursor, slow: this.state.slowCursor, live: this.state.liveFrom, from: this.state.backfillFrom };
    if (!this.o.stateFile) return;
    this.state.rejected = [...this.rejected];
    const tmp = `${this.o.stateFile}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state));
    renameSync(tmp, this.o.stateFile);
  }
}
