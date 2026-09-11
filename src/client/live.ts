/* eslint-disable @typescript-eslint/no-explicit-any */
// Browser side of the single Next.js app: one snapshot from /api/state, then
// Server-Sent Events from /api/stream. Everything is same-origin.
import { SITE } from '@/config/site';
import type { EliminatedItem, ExclusionItem, IdeaCycle, ModelRun, Token, TokenStatus } from '@/engine/types';
import { useStore } from '@/store/useStore';

const set = useStore.setState;
const get = useStore.getState;
const HUES = [38, 152, 268, 196, 12, 88, 320];

let started = false;
let nextCycleAt = 0;

export function startLive() {
  if (started) return;
  started = true;
  void refreshState(true);
  connect();
  void refreshIdeas();
  setInterval(() => set({ countdown: nextCycleAt ? Math.max(0, Math.ceil((nextCycleAt - Date.now()) / 1000)) : 0 }), 1000);
  setInterval(() => void refreshState(false), 30_000);
  // A different persona writes with different words: fetch its idea cycle.
  useStore.subscribe((s, prev) => {
    if (s.personaId !== prev.personaId) void refreshIdeas();
  });
}

export async function fetchSyntheticBootstrap(n: number, nPos: number, auc: number): Promise<number> {
  const res = await fetch(`/api/bootstrap?n=${n}&npos=${nPos}&auc=${auc.toFixed(3)}`);
  const body = await res.json();
  return Number(body.boot_lower);
}

function mapToken(t: any): Token {
  const launchedAt = t.launched_at ?? new Date().toISOString();
  const d = new Date(launchedAt);
  const status: TokenStatus = t.status === 'passed' || t.status === 'pending' ? t.status : 'stalled';
  return {
    mint: t.mint,
    name: t.name || `${SITE.chain} Token`,
    symbol: t.symbol || String(t.mint ?? '').slice(2, 8).toUpperCase() || 'TKN',
    lore: t.lore ?? '',
    loreWithheld: !!t.lore_withheld,
    holders: t.holders ?? 0,
    holdersMissing: t.holders == null,
    peakMc: t.peak_mc ?? 0,
    status,
    hour: t.launch_hour ?? d.getUTCHours(),
    dow: (d.getUTCDay() + 6) % 7,
    launchedAt,
    deployer: t.creator ?? '',
    hue: HUES[Math.abs(hash(t.mint ?? t.name ?? '')) % HUES.length],
    logo: t.logo ?? undefined,
  };
}

function mapModel(m: any): ModelRun | null {
  if (!m || m.auc == null) return null;
  const rates: number[] = new Array(24).fill(0);
  Object.entries(m.hour_rates ?? {}).forEach(([h, v]) => (rates[Number(h)] = Number(v)));
  return {
    runId: m.id ?? 0,
    ranAt: m.ran_at ?? new Date().toISOString(),
    n: m.n ?? 0,
    nPositive: m.n_positive ?? 0,
    d: m.d ?? SITE.capacityD,
    auc: m.auc,
    aucStd: m.auc_std ?? 0,
    foldAucs: m.fold_aucs ?? [],
    timeSplitGap: m.time_split_gap ?? 0,
    bootLower: m.auc_boot_lower ?? m.auc,
    featureImportance: m.feature_importance ?? {},
    hourRates: rates,
    hourCounts: m.hour_counts ?? [],
    medianHolders: m.median_holders ?? 0,
    model: { weights: [], bias: 0, mu: [], sigma: [] },
    source: 'api',
  };
}

/** Until someone moves a slider, the proof panel mirrors the latest model. */
function setModel(model: ModelRun | null) {
  set({ model });
  if (!model || get().sim.touched) return;
  set((s) => ({
    sim: {
      ...s.sim,
      n: Math.max(SITE.sliders.n.min, model.n),
      auc: Math.max(SITE.sliders.auc.min, Math.min(SITE.sliders.auc.max, model.auc)),
      d: model.d,
      posRate: model.n ? model.nPositive / model.n : s.sim.posRate,
      bootLower: null,
    },
  }));
}

function applyCounters(c: any) {
  if (!c) return;
  const all = c.above_10k ?? 0;
  const pass = c.passed_30k ?? 0;
  const pending = c.pending ?? 0;
  set((s) => ({
    tally: { all, pass, stall: c.stalled ?? all - pass },
    counters: { chain: all + pending, dex: all + pending, rpc: all },
    medianHolders: c.median_holders ?? s.medianHolders,
  }));
}

async function refreshState(includeFeed: boolean) {
  try {
    const res = await fetch('/api/state', { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    nextCycleAt = Date.parse(data.next_cycle_at) || 0;
    const f = data.findings ?? {};
    const w = data.warmup;
    set({
      dataSource: data.source === 'dexscreener' ? 'live' : 'simulated',
      startedAt: data.started_at ?? null,
      cycle: data.cycle_number ?? 0,
      hourAll: f.hour_counts ?? new Array(24).fill(0),
      hourWin: f.hour_wins ?? new Array(24).fill(0),
      lift: f.lift ?? [],
      baseline: f.baseline ?? 0,
      loreCorr: f.lore_corr ?? 0,
      warmup: w ? { labelled: w.labelled, needed: w.needed, pending: w.pending, nextLabelAt: w.next_label_at } : null,
      ...(includeFeed ? { feed: (data.tokens ?? []).map(mapToken).slice(0, SITE.consoleFeedCap) } : {}),
    });
    applyCounters(data.counters);
    setModel(mapModel(data.latest_model));
  } catch (err) {
    set({ connected: false });
    console.warn('/api/state unavailable', err);
  }
}

function connect() {
  const es = new EventSource('/api/stream');
  es.onopen = () => set({ connected: true });
  es.onerror = () => set({ connected: false }); // EventSource reconnects on its own
  es.onmessage = (e) => {
    let payload: any;
    try {
      payload = JSON.parse(e.data);
    } catch {
      return;
    }
    if (payload.token && !document.hidden) {
      const t = mapToken(payload.token);
      set((s) => ({ feed: [t, ...s.feed.filter((x) => x.mint !== t.mint)].slice(0, SITE.consoleFeedCap) }));
    }
    if (payload.counters) applyCounters(payload.counters);
    if (payload.model) {
      setModel(mapModel(payload.model));
      void refreshIdeas();
      void refreshState(false);
    }
  };
}

export async function refreshIdeas() {
  const persona = get().personaId;
  const getJson = (p: string) => fetch(p, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${p} → ${r.status}`))));
  const [cur, elim, excl, gen] = await Promise.allSettled([
    getJson(`/api/ideas/current?persona=${persona}`),
    getJson(`/api/ideas/eliminated?persona=${persona}`),
    getJson(`/api/ideas/exclusions?persona=${persona}`),
    getJson('/api/ideas/generator'),
  ]);
  if (get().personaId !== persona) return; // switched again while loading

  set((s) => {
    const ideas = { ...s.ideas };
    if (cur.status === 'fulfilled' && cur.value?.candidates) {
      const c = cur.value;
      ideas.current = {
        cycleId: c.cycle_id,
        runId: c.run_id,
        startedAt: c.started_at,
        seed: c.seed ?? '',
        medianHolders: c.median_holders ?? 0,
        dow: c.dow ?? 0,
        nGenerated: c.n_generated ?? c.candidates.length,
        nRejected: c.n_rejected ?? 0,
        nExcluded: c.n_excluded ?? 0,
        ruleHits: c.rule_hits ?? {},
        model: { auc: c.model?.auc ?? 0.5, floor: c.model?.proven_floor ?? 0.5 },
        candidates: c.candidates.map((x: any) => ({
          rank: x.rank,
          name: x.name,
          lore: x.lore,
          hour: x.hour,
          score: Number(x.score),
          commitment: x.commitment,
          committedAt: x.committed_at ?? '',
        })),
      } satisfies IdeaCycle;
      ideas.updatedAt = new Date().toISOString();
      ideas.error = null;
    } else {
      ideas.error = cur.status === 'rejected' ? String(cur.reason) : 'no cycle yet';
    }
    if (elim.status === 'fulfilled') {
      ideas.eliminated = elim.value.map(
        (e: any): EliminatedItem => ({
          name: e.name,
          lore: e.lore,
          ledCycle: e.led_cycle,
          peakScore: e.peak_score,
          currentScore: e.current_score,
          currentRank: e.current_rank ?? null,
          demotedCycle: e.demoted_cycle ?? 0,
        }),
      );
    }
    if (excl.status === 'fulfilled') {
      ideas.exclusions = excl.value.map(
        (x: any): ExclusionItem => ({
          name: x.name,
          firstCycle: x.first_cycle,
          firstSeenAt: x.first_seen_at,
          deployedMint: x.deployed_mint,
          deployer: x.deployer,
          deployedAt: x.deployed_at ?? '',
          blockNumber: x.block_number,
          timeGapSeconds: x.time_gap_seconds,
        }),
      );
    }
    if (gen.status === 'fulfilled' && gen.value.source) {
      ideas.remoteSource = { code: gen.value.source, sha: gen.value.generator_sha ?? '' };
    }
    return { ideas };
  });
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
