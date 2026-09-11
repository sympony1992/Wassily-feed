import { readFileSync } from 'node:fs';
import path from 'node:path';
import { sha256Hex } from '@/math/sha256';
import { Agent } from './agent';
import { loadConfig, type ServerConfig } from './config';
import { Persistence } from './persist';
import { DexScreenerSource } from './sources/dexscreener';
import { startSimulatedSource } from './sources/simulated';

export interface Runtime {
  agent: Agent;
  config: ServerConfig;
  store: Persistence | null;
  startedAt: string;
  generator: { source: string; sha: string };
  ingestStats: () => unknown;
  stop: () => void;
}

// One agent per server process. Kept on globalThis so dev hot-reloads and every route share it.
const g = globalThis as typeof globalThis & { __survivalRuntime?: Runtime };

export function getRuntime(overrides: Partial<ServerConfig> = {}): Runtime {
  if (g.__survivalRuntime) return g.__survivalRuntime;

  const config: ServerConfig = { ...loadConfig(), ...overrides };
  const log = (m: string) => console.log(`[agent] ${m}`);
  const agent = new Agent(config.persona, config.bound, config.cycleSeconds);

  const store = config.persist ? new Persistence(config.dataDir) : null;
  const saved = store?.load();
  if (saved) {
    agent.restore(saved);
    log(`restored ${saved.tokens.length} tokens and ${saved.runs.length} model runs from ${config.dataDir}`);
  }
  if (store) agent.on('cycle', (cycle, persona) => store.appendCycle(cycle, persona));

  // The generator panel serves the file that actually runs, hashed.
  const source = readFileSync(path.join(process.cwd(), 'src', 'engine', 'ideas.ts'), 'utf8').trim();
  const generator = { source, sha: sha256Hex(source).slice(0, 12) };

  let stopSource = () => {};
  let ingestStats: () => unknown = () => null;
  if (config.source === 'simulated') {
    stopSource = startSimulatedSource(agent, config);
    if (!saved) agent.replayPrior(config.priorCycles);
  } else {
    const dex = new DexScreenerSource(agent, {
      api: config.dexscreenerApi,
      chain: config.chain,
      pollSeconds: config.pollSeconds,
      maxDiscoveryAgeHours: config.maxDiscoveryAgeHours,
      holdersApiUrl: config.holdersApiUrl,
      log,
    });
    dex.start();
    stopSource = () => dex.stop();
    ingestStats = () => dex.stats;
  }
  agent.start();

  const save = () => store?.save(agent.snapshot());
  const saveTimer = store ? setInterval(save, 30_000) : null;
  saveTimer?.unref();
  const onExit = () => save();
  process.once('SIGTERM', onExit);
  process.once('SIGINT', onExit);

  const rt: Runtime = {
    agent,
    config,
    store,
    startedAt: new Date().toISOString(),
    generator,
    ingestStats,
    stop: () => {
      stopSource();
      agent.stop();
      if (saveTimer) clearInterval(saveTimer);
      save();
      process.off('SIGTERM', onExit);
      process.off('SIGINT', onExit);
    },
  };
  g.__survivalRuntime = rt;
  log(`${config.source === 'dexscreener' ? `LIVE ${config.chain} via DexScreener` : 'simulated market'} · persona ${config.persona} · cycle ${config.cycleSeconds}s`);
  return rt;
}

export function stopRuntime() {
  g.__survivalRuntime?.stop();
  delete g.__survivalRuntime;
}
