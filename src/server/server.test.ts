/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as bootstrapRoute from '@/app/api/bootstrap/route';
import * as datasetRoute from '@/app/api/dataset.csv/route';
import * as healthRoute from '@/app/api/health/route';
import * as currentRoute from '@/app/api/ideas/current/route';
import * as cycleRoute from '@/app/api/ideas/cycle/[id]/route';
import * as eliminatedRoute from '@/app/api/ideas/eliminated/route';
import * as generatorRoute from '@/app/api/ideas/generator/route';
import * as methodologyRoute from '@/app/api/methodology.json/route';
import * as stateRoute from '@/app/api/state/route';
import * as streamRoute from '@/app/api/stream/route';
import * as githubRoute from '@/app/github/route';
import { PERSONA_BY_ID } from '@/config/personas';
import { SITE } from '@/config/site';
import { sha256Fields, sha256Hex } from '@/math/sha256';
import { Agent } from './agent';
import { loadConfig } from './config';
import { getRuntime, stopRuntime } from './runtime';
import { DexScreenerSource } from './sources/dexscreener';

const req = (path: string) => new Request(`http://localhost${path}`);
const body = async (res: Response) => (await res.json()) as Record<string, any>;

describe('Next.js route handlers (simulated source)', () => {
  beforeAll(() => {
    getRuntime({ ...loadConfig({}), seedTokens: 600, arrivalMs: [40, 80], cycleSeconds: 3600, priorCycles: 2, persist: false });
  }, 60_000);

  afterAll(() => stopRuntime());

  it('GET /api/state keeps the original contract plus warm-up and findings', async () => {
    const s = await body(stateRoute.GET());
    expect(s.source).toBe('simulated');
    expect(s.counters.above_10k).toBeGreaterThanOrEqual(600);
    expect(s.counters.passed_30k + s.counters.stalled).toBe(s.counters.above_10k);
    expect(Object.keys(s.latest_model.gates)).toEqual(['n_samples', 'n_positive', 'auc_std', 'time_split']);
    expect(s.latest_model.blocked_by).toBe('n_samples'); // 600 < 2,000
    expect(s.warmup).toMatchObject({ needed: SITE.gates.nSamplesMin });
    expect(s.findings.hour_counts).toHaveLength(24);
    expect(typeof s.started_at).toBe('string');
    expect(s.tokens[0]).toMatchObject({ chain: 'robinhood', mint: expect.stringMatching(/^0x/) });
  });

  it('GET /api/health', async () => {
    const h = await body(healthRoute.GET());
    expect(h.ok).toBe(true);
    expect(h.tokens).toBeGreaterThanOrEqual(600);
  });

  it('serves a verifiable cycle per persona', async () => {
    for (const id of ['hoeffding', 'bayes'] as const) {
      const c = await body(currentRoute.GET(req(`/api/ideas/current?persona=${id}`)));
      expect(c.persona).toBe(id);
      expect(c.candidates).toHaveLength(SITE.candidatesPerCycle);
      const top = c.candidates[0];
      expect(top.commitment).toBe(sha256Fields([top.name, top.lore, String(top.hour), String(c.run_id)]));
      // The persona's own vocabulary
      expect(c.candidates.every((x: any) => PERSONA_BY_ID[id].ideas.names.some((n) => x.name.startsWith(n)))).toBe(true);

      const byId = await cycleRoute.GET(req(`/api/ideas/cycle/${c.cycle_id}?persona=${id}`), { params: Promise.resolve({ id: String(c.cycle_id) }) });
      expect((await body(byId)).cycle_id).toBe(c.cycle_id);
    }
    const elim = await body(eliminatedRoute.GET(req('/api/ideas/eliminated?persona=bayes')));
    expect(Array.isArray(elim)).toBe(true);
  });

  it('serves the generator file that actually runs', async () => {
    const g = await body(generatorRoute.GET());
    const onDisk = readFileSync('src/engine/ideas.ts', 'utf8').trim();
    expect(g.source).toBe(onDisk);
    expect(g.generator_sha).toBe(sha256Hex(onDisk).slice(0, 12));
  });

  it('exports dataset.csv and methodology.json', async () => {
    const csv = await datasetRoute.GET().text();
    expect((csv.charCodeAt(0) === 0xfeff ? csv.slice(1) : csv).split('\r\n')[0]).toContain('mint,name,symbol');
    const m = await body(methodologyRoute.GET());
    expect(m.data_source).toContain('simulated');
    expect(m.capacity_d).toBe(28);
  });

  it('bootstraps the proof-panel sliders on the server', async () => {
    const b = await body(bootstrapRoute.GET(req('/api/bootstrap?n=2000&npos=600&auc=0.62')));
    expect(b.boot_lower).toBeLessThan(0.62);
    expect(b.boot_lower).toBeGreaterThan(0.57);
  });

  it('streams hello and new tokens over Server-Sent Events', async () => {
    const res = streamRoute.GET(req('/api/stream'));
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (!buf.includes('"token"')) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value);
    }
    await reader.cancel();
    expect(buf).toContain('"hello"');
    expect(buf).toContain('"token"');
  });

  it('redirects /github home when no URL is configured', () => {
    const res = githubRoute.GET(req('/github'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(SITE.githubUrl || 'http://localhost/');
  });
});

describe('DexScreener source (mocked network)', () => {
  const HOUR = 3_600_000;
  const addr = '0xAbC0000000000000000000000000000000000001';
  const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { 'content-type': 'application/json' } });

  function setup(createdAgoHours: number) {
    const clock = { now: Date.UTC(2026, 8, 12, 12), mc: 12_000 };
    const created = clock.now - createdAgoHours * HOUR;
    const fetchImpl = (async (input: string | URL | Request) => {
      const u = String(input);
      if (u.endsWith('/token-profiles/latest/v1'))
        return json([
          { chainId: 'robinhood', tokenAddress: addr, description: 'A patient community token https://spam.example/x' },
          { chainId: 'solana', tokenAddress: 'So11111111111111111111111111111111111111112' },
        ]);
      if (u.endsWith('/token-boosts/latest/v1')) return json([]);
      if (u.includes('/tokens/v1/robinhood/'))
        return json([{ chainId: 'robinhood', baseToken: { address: addr, name: 'Patient Otter', symbol: 'POTR' }, marketCap: clock.mc, pairCreatedAt: created }]);
      if (u.includes('explorer')) return json({ holders_count: '321' });
      return new Response('not found', { status: 404 });
    }) as typeof fetch;
    const agent = new Agent('hoeffding', null, 3600);
    const source = new DexScreenerSource(agent, {
      api: 'https://api.dexscreener.com',
      chain: 'robinhood',
      pollSeconds: 60,
      maxDiscoveryAgeHours: 6,
      holdersApiUrl: 'https://explorer.example/api/v2/tokens/{address}',
      fetchImpl,
      now: () => clock.now,
    });
    return { clock, created, agent, source };
  }

  it('discovers, keeps the peak cap, labels once at 48h, and reports warm-up', async () => {
    const { clock, created, agent, source } = setup(2);
    const key = addr.toLowerCase();

    await source.tick();
    expect(agent.tokens.size).toBe(1); // the Solana profile is ignored
    expect(agent.tokens.get(key)).toMatchObject({ status: 'pending', name: 'Patient Otter', holdersMissing: true });
    expect(agent.tokens.get(key)!.lore).not.toContain('http');
    expect(agent.warmup()).toMatchObject({ labelled: 0, pending: 1, next_label_at: new Date(created + 48 * HOUR).toISOString() });

    clock.mc = 45_000;
    clock.now += HOUR;
    await source.tick();
    clock.mc = 9_000;
    clock.now += HOUR;
    await source.tick();
    expect(agent.tokens.get(key)!.peakMc).toBe(45_000); // peak, never current

    clock.now = created + 49 * HOUR;
    await source.tick();
    expect(agent.tokens.get(key)).toMatchObject({ status: 'passed', holders: 321, holdersMissing: false });
    expect(agent.labelled()).toHaveLength(1);
    expect(agent.warmup()).toMatchObject({ labelled: 1, pending: 0, next_label_at: null });
  });

  it('refuses tokens first seen too long after launch', async () => {
    const { agent, source } = setup(30);
    await source.tick();
    expect(agent.tokens.size).toBe(0);
    expect(source.stats.tooOld).toBe(1);
  });

  it('restores snapshots written by the earlier single-ledger server', () => {
    const { agent } = setup(2);
    const token = { mint: addr, name: 'Old Token', symbol: 'OLD', lore: '', loreWithheld: false, holders: 0, holdersMissing: true, peakMc: 15_000, status: 'pending', hour: 1, dow: 0, launchedAt: new Date().toISOString(), deployer: '', hue: 38 } as const;
    agent.restore({ version: 1, runId: 500, tokens: [{ ...token }], runs: [], ledger: { nextCycleId: 2000, cycles: [], eliminated: [], exclusions: [], stolen: [] } });
    expect(agent.tokens.size).toBe(1);
    expect(agent.snapshot().version).toBe(2);
  });
});
