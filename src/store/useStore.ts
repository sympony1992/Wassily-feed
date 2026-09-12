import { create } from 'zustand';
import { PERSONA_BY_ID, isPersonaId, type PersonaId } from '@/config/personas';
import { SITE } from '@/config/site';
import { BOUND_BY_ID, isBoundId, type BoundId } from '@/math/bounds';
import type { EliminatedItem, ExclusionItem, IdeaCycle, LiftWord, ModelRun, Token } from '@/engine/types';

export interface SimParams {
  n: number;
  auc: number;
  d: number;
  posRate: number;
}

export interface Warmup {
  labelled: number;
  ready: number; // labelled and with a holder count: what the model trains on
  needed: number;
  pending: number;
  nextLabelAt: string | null; // when the oldest watched token reaches its 48h label
}

interface State {
  // One agent per deployment: the persona and its bound are fixed at build time, not picked by visitors.
  personaId: PersonaId;
  boundId: BoundId | null; // null → the persona's own formula

  // Live data from the server
  dataSource: 'connecting' | 'simulated' | 'live'; // 'connecting' until /api/state answers; only 'live' may be labelled LIVE
  connected: boolean;
  startedAt: string | null;
  feed: Token[];
  tally: { all: number; pass: number; stall: number };
  counters: { chain: number; dex: number; rpc: number };
  medianHolders: number;
  model: ModelRun | null;
  training: boolean;
  countdown: number;
  cycle: number;
  hourAll: number[];
  hourWin: number[];
  lift: LiftWord[];
  baseline: number;
  loreCorr: number;
  warmup: Warmup | null;
  backfill: { running: boolean; progress: number; since: string | null; checked: number } | null;

  ideas: {
    current: IdeaCycle | null;
    eliminated: EliminatedItem[];
    exclusions: ExclusionItem[];
    updatedAt: string | null;
    error: string | null;
    remoteSource: { code: string; sha: string } | null;
  };

  // Proof panel
  sim: SimParams & { touched: boolean; bootLower: number | null };

  setSim: (p: Partial<SimParams>) => void;
  syncSimWithModel: () => void;
  applyPreset: (p: Pick<SimParams, 'n' | 'auc' | 'd'>) => void;
  setSimBootLower: (v: number | null) => void;
}

export const useStore = create<State>()((set, get) => ({
  personaId: isPersonaId(SITE.defaultPersona) ? SITE.defaultPersona : 'hoeffding',
  boundId: isBoundId(SITE.defaultBound) ? SITE.defaultBound : null,

  dataSource: 'connecting',
  connected: false,
  startedAt: null,
  feed: [],
  tally: { all: 0, pass: 0, stall: 0 },
  counters: { chain: 0, dex: 0, rpc: 0 },
  medianHolders: 0,
  model: null,
  training: false,
  countdown: 0,
  cycle: 0,
  hourAll: new Array(24).fill(0),
  hourWin: new Array(24).fill(0),
  lift: [],
  baseline: 0,
  loreCorr: 0,
  warmup: null,
  backfill: null,

  ideas: { current: null, eliminated: [], exclusions: [], updatedAt: null, error: null, remoteSource: null },

  sim: { n: SITE.seedTokens, auc: 0.58, d: SITE.capacityD, posRate: 0.308, touched: false, bootLower: null },

  setSim: (p) => set((s) => ({ sim: { ...s.sim, ...p, touched: true, bootLower: null } })),
  applyPreset: (p) => set((s) => ({ sim: { ...s.sim, ...p, touched: true, bootLower: null } })),
  setSimBootLower: (bootLower) => set((s) => ({ sim: { ...s.sim, bootLower } })),
  syncSimWithModel: () => {
    const { model, tally, sim } = get();
    const n = model?.n || tally.all || sim.n;
    set({
      sim: {
        n: Math.max(SITE.sliders.n.min, n),
        auc: Math.max(SITE.sliders.auc.min, Math.min(SITE.sliders.auc.max, model?.auc ?? sim.auc)),
        d: model?.d ?? SITE.capacityD,
        posRate: model && model.n ? model.nPositive / model.n : sim.posRate,
        touched: true,
        bootLower: null,
      },
    });
  },
}));

export const usePersona = () => PERSONA_BY_ID[useStore((s) => s.personaId)];

export function useBound() {
  const personaId = useStore((s) => s.personaId);
  const boundId = useStore((s) => s.boundId);
  return BOUND_BY_ID[boundId ?? PERSONA_BY_ID[personaId].defaultBound];
}
