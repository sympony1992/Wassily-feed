import type { PersonaId } from '@/config/personas';
import { Market, simulatedBlockNumber } from '@/engine/simulator';
import type { IdeaCycle } from '@/engine/types';
import type { Agent } from '../agent';

/** A synthetic market fed into the agent. Everything it produces is labelled as simulated. */
export function startSimulatedSource(agent: Agent, o: { seedTokens: number; arrivalMs: [number, number] }) {
  const market = new Market();
  for (const t of market.history(o.seedTokens, Date.now())) agent.upsert(t, false);

  let arrival: NodeJS.Timeout;
  const next = () => {
    const [lo, hi] = o.arrivalMs;
    arrival = setTimeout(() => {
      agent.upsert(market.arrival(Date.now()));
      next();
    }, lo + Math.random() * (hi - lo));
  };
  next();

  // Copycats sometimes deploy a fresh leader 20–70 s after it is published.
  const timers = new Set<NodeJS.Timeout>();
  const onCycle = (cycle: IdeaCycle, persona: PersonaId) => {
    if (Math.random() >= 0.4) return;
    const t = setTimeout(() => {
      timers.delete(t);
      const ledger = agent.ledgers[persona];
      const victim = cycle.candidates.slice(0, 3).find((c) => !ledger.stolen.has(c.name.toLowerCase()));
      if (!victim) return;
      const at = new Date();
      agent.emit('exclusion', ledger.recordTheft(cycle, victim, { mint: market.randomAddress(), deployer: market.randomAddress(), at, blockNumber: simulatedBlockNumber(at) }), persona);
    }, 20_000 + Math.random() * 50_000);
    timers.add(t);
  };
  agent.on('cycle', onCycle);

  return () => {
    clearTimeout(arrival);
    timers.forEach(clearTimeout);
    agent.off('cycle', onCycle);
  };
}
