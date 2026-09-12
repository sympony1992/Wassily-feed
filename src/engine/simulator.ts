import { gaussian, hexString, pick, rngFromSeed, type Rng } from '@/math/stats';
import { SITE } from '@/config/site';
import { sanitizeLore } from './sanitize';
import type { Token, TrainingRow } from './types';

// A synthetic Robinhood Chain. The ground truth below is hidden from the model:
// it only ever sees launch hour, weekday, holders and lore — never price.

const ADJ = ['Velvet', 'Rusty', 'Lucky', 'Sleepy', 'Brave', 'Lazy', 'Spicy', 'Frozen', 'Electric', 'Paper', 'Hidden', 'Jolly', 'Grumpy', 'Turbo', 'Lunar', 'Solar', 'Pocket', 'Royal', 'Soggy', 'Clever'];
const NOUN = ['Otter', 'Walrus', 'Badger', 'Lobster', 'Penguin', 'Llama', 'Beaver', 'Gecko', 'Raccoon', 'Donkey', 'Parrot', 'Koala', 'Turtle', 'Falcon', 'Bison', 'Yak', 'Squid', 'Hedgehog', 'Ferret', 'Narwhal'];

const GOOD_WORDS = ['community', 'patient', 'builders', 'honest', 'quiet', 'survivor'];
const HYPE_WORDS = ['moon', 'pump', 'soon', 'lambo'];

const LORE = [
  'A {noun} that refused to leave the pool. The community kept feeding it.',
  'Launched by builders who forgot to write a roadmap.',
  'The {adj} {noun} does not chart. It waits, patient and unbothered.',
  'Nobody asked for a {noun}. Now there is an honest one.',
  'Straight to the moon, then probably back.',
  'Pump first, story later. The {noun} insists.',
  'A quiet {noun} with a loud wallet.',
  'Survivor of three rugs and one bad haircut.',
  'Soon. The {noun} has been saying soon since launch.',
  'Community owned, {noun} operated.',
  'Minted at dawn by someone who should have been asleep.',
  'The {adj} {noun} bought a lambo in a dream.',
  'Built slowly by patient builders and one {noun}.',
  'No team, no plan, one very {adj} {noun}.',
  'An honest {noun} in a dishonest liquidity pool.',
  'Deployed from a phone on a bus.',
  'The {noun} keeps a diary. Every entry says hold.',
  'Too {adj} to fail, too {noun} to explain.',
];

const HOUR_WEIGHTS = [0.5, 0.4, 0.35, 0.3, 0.3, 0.35, 0.5, 0.7, 0.8, 0.9, 1, 1.1, 1.3, 1.5, 1.6, 1.6, 1.5, 1.4, 1.3, 1.2, 1, 0.9, 0.7, 0.6];
const HUES = [38, 152, 268, 196, 12, 88, 320];
const DAY = 86_400_000;
const HOUR = 3_600_000;

const B0 = -1.05;
const DOW_EFFECT = [0.05, 0, 0.05, 0.1, 0.15, -0.15, -0.2];

function circularDistance(h: number, center: number) {
  const d = Math.abs(h - center) % 24;
  return Math.min(d, 24 - d);
}

function survivalLogit(holders: number, hour: number, dow: number, lore: string) {
  const zHolders = (Math.log(holders) - Math.log(288)) / 0.8;
  const hourEffect = 0.6 * Math.exp(-(circularDistance(hour, 14.5) ** 2) / (2 * 2.5 ** 2)) - (hour >= 2 && hour <= 5 ? 0.35 : 0) - 0.2;
  const words = lore.toLowerCase().match(/[a-z]+/g) ?? [];
  const good = words.filter((w) => GOOD_WORDS.includes(w)).length;
  const hype = words.filter((w) => HYPE_WORDS.includes(w)).length;
  const loreEffect = lore ? 0.35 * Math.min(2, good) - 0.25 * Math.min(1, hype) : -0.3;
  return B0 + 0.3 * zHolders + hourEffect + DOW_EFFECT[dow] + loreEffect;
}

export class Market {
  private rng: Rng;

  constructor(seed = 20_260_911) {
    this.rng = rngFromSeed(seed);
  }

  /** Tokens already labelled before the page opened, oldest first. */
  history(count: number, now: number): Token[] {
    const midnight = Math.floor(now / DAY) * DAY;
    const out: Token[] = [];
    for (let i = 0; i < count; i++) {
      const dayOffset = 2 + Math.floor(this.rng() * 10);
      const at = midnight - dayOffset * DAY + this.sampleHour() * HOUR + Math.floor(this.rng() * 60) * 60_000;
      out.push(this.make(Math.min(at, now - SITE.labelHours * HOUR)));
    }
    return out.sort((a, b) => Date.parse(a.launchedAt) - Date.parse(b.launchedAt));
  }

  /** A token reaching its 48h label right now. `name` lets a copycat deploy a published idea. */
  arrival(now: number, name?: string): Token {
    const midnight = Math.floor(now / DAY) * DAY;
    let at = midnight - 2 * DAY + this.sampleHour() * HOUR + Math.floor(this.rng() * 60) * 60_000;
    if (at > now - SITE.labelHours * HOUR) at -= DAY;
    return this.make(at, name);
  }

  randomAddress(): string {
    return `0x${hexString(this.rng, 40)}`;
  }

  chance(p: number): boolean {
    return this.rng() < p;
  }

  private sampleHour(): number {
    const total = HOUR_WEIGHTS.reduce((a, b) => a + b, 0);
    let r = this.rng() * total;
    for (let h = 0; h < 24; h++) {
      r -= HOUR_WEIGHTS[h];
      if (r <= 0) return h;
    }
    return 23;
  }

  private make(launchedAtMs: number, forcedName?: string): Token {
    const rng = this.rng;
    const date = new Date(launchedAtMs);
    const hour = date.getUTCHours();
    const dow = (date.getUTCDay() + 6) % 7;
    const adj = pick(rng, ADJ);
    const noun = pick(rng, NOUN);
    const name = forcedName ?? `${adj} ${noun}`;
    const symbol = forcedName
      ? forcedName.split(/\s+/).map((w) => w[0]).join('').toUpperCase().slice(0, 5) || 'TKN'
      : (adj[0] + noun.slice(0, 3)).toUpperCase();

    let raw = rng() < 0.08 ? '' : pick(rng, LORE).replaceAll('{adj}', adj.toLowerCase()).replaceAll('{noun}', noun.toLowerCase());
    if (raw && rng() < 0.03) raw += ' https://t.me/' + hexString(rng, 6);
    if (raw && rng() < 0.006) raw = raw.replace(/\.$/, ', holy shit.');
    const clean = sanitizeLore(raw);

    const holders = Math.max(12, Math.round(Math.exp(Math.log(288) + 0.8 * gaussian(rng))));
    const p = 1 / (1 + Math.exp(-survivalLogit(holders, hour, dow, raw)));
    const passed = rng() < p;
    const peakMc = passed
      ? Math.min(2_500_000, SITE.targetMc * Math.exp(Math.abs(gaussian(rng)) * 0.8))
      : SITE.entryMc + rng() * (SITE.targetMc - SITE.entryMc - 100);

    return {
      mint: `0x${hexString(rng, 40)}`,
      name,
      symbol,
      lore: clean.display,
      loreRaw: raw,
      loreWithheld: clean.withheld,
      holders,
      peakMc: Math.round(peakMc),
      status: passed ? 'passed' : 'stalled',
      hour,
      dow,
      launchedAt: date.toISOString(),
      deployer: `0x${hexString(rng, 40)}`,
      hue: pick(rng, HUES),
    };
  }
}

/** Plausible block height for simulated deployments (~4 blocks per second). */
export const simulatedBlockNumber = (at: Date) => 19_482_000 + Math.floor((at.getTime() - Date.UTC(2026, 8, 10)) / 250);

export function toTrainingRow(t: Token): TrainingRow {
  const lore = t.loreRaw ?? t.lore;
  return {
    name: t.name,
    lore,
    loreMissing: !lore.trim(),
    holders: t.holders,
    hour: t.hour,
    dow: t.dow,
    launchedAt: Date.parse(t.launchedAt),
    passed: t.status === 'passed' ? 1 : 0,
  };
}
