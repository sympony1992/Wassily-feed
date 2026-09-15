import { readFileSync } from 'node:fs';
import path from 'node:path';
import { sha256Hex } from '@/math/sha256';
import { Agent } from './agent';
import { loadConfig, type ServerConfig } from './config';
import { Persistence } from './persist';
import { ChainSource, type BackfillProgress } from './sources/chain';
import { startSimulatedSource } from './sources/simulated';
import { KyberClient } from './trade/kyber';
import { PaperTrader } from './trade/paper';
import { TradeService } from './trade/service';

export interface Runtime {
  agent: Agent;
  config: ServerConfig;
  store: Persistence | null;
  startedAt: string;
  generator: { source: string; sha: string };
  ingestStats: () => unknown;
  backfill: () => BackfillProgress | null;
  trade: TradeService;
  paper: PaperTrader | null;
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
  let backfill: () => BackfillProgress | null = () => null;
  if (config.source === 'simulated') {
    stopSource = startSimulatedSource(agent, config);
    if (!saved) agent.replayPrior(config.priorCycles);
  } else {
    const chain = new ChainSource(agent, {
      rpcUrl: config.rpcUrl,
      geckoApi: config.geckoApi,
      geckoPerMinute: config.geckoPerMinute,
      dexscreenerApi: config.dexscreenerApi,
      network: config.chain,
      pollSeconds: config.pollSeconds,
      backfillDays: config.backfillDays,
      backfillSample: config.backfillSample,
      stateFile: store ? path.join(config.dataDir, 'chain.json') : null,
      log,
    });
    chain.start();
    stopSource = () => chain.stop();
    ingestStats = () => chain.stats;
    backfill = () => chain.progress();
  }
  agent.start();

  // Quick buy prices routes and builds unsigned swaps for the user's wallet; paper trading tracks every active signal.
  const kyber = new KyberClient({ api: config.kyberApi, chain: config.chain, clientId: config.kyberClientId });
  const trade = new TradeService(agent, { live: config.source === 'chain', enabled: config.quickBuy, kyber, geckoApi: config.geckoApi, network: config.chain });
  const paper =
    config.source === 'chain' && config.paperTrading ? new PaperTrader(trade, kyber, { file: store ? path.join(config.dataDir, 'paper.json') : null, log }) : null;
  paper?.start();
  trade.startMarketChecks(); // live only: a buy button needs a market that can be bought and sold back

  const save = () => store?.save(agent.snapshot());
  const saveTimer = store ? setInterval(save, 30_000) : null;
  saveTimer?.unref();
  const onExit = () => {
    save();
    paper?.stop();
  };
  process.once('SIGTERM', onExit);
  process.once('SIGINT', onExit);

  const rt: Runtime = {
    agent,
    config,
    store,
    startedAt: new Date().toISOString(),
    generator,
    ingestStats,
    backfill,
    trade,
    paper,
    stop: () => {
      stopSource();
      agent.stop();
      paper?.stop();
      if (saveTimer) clearInterval(saveTimer);
      save();
      process.off('SIGTERM', onExit);
      process.off('SIGINT', onExit);
    },
  };
  g.__survivalRuntime = rt;
  log(`${config.source === 'chain' ? `LIVE ${config.chain} from ${config.rpcUrl}` : 'simulated market'} · persona ${config.persona} · cycle ${config.cycleSeconds}s`);
  return rt;
}

export function stopRuntime() {
  g.__survivalRuntime?.stop();
  delete g.__survivalRuntime;
}
