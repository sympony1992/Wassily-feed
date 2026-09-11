import type { LiftWord, Token } from './types';

const STOPWORDS = new Set(['a', 'an', 'and', 'the', 'of', 'in', 'on', 'to', 'it', 'is', 'was', 'with', 'by', 'for', 'one', 'no', 'not', 'that', 'this', 'has', 'been', 'who', 'at', 'from', 'then', 'too', 'very', 'since', 'there', 'now', 'every', 'keeps', 'says', 'does']);

export interface Findings {
  hourAll: number[];
  hourWin: number[];
  baseline: number;
  lift: LiftWord[];
  loreCorr: number;
}

// #region stage:conclusions
/** What the Console reports: survival by launch hour, lore words with lift, and lore-length correlation. */
export function computeFindings(labelled: readonly Token[]): Findings {
  const hourAll = new Array<number>(24).fill(0);
  const hourWin = new Array<number>(24).fill(0);
  const wordAll = new Map<string, number>();
  const wordWin = new Map<string, number>();
  let pass = 0;
  let sx = 0;
  let sxy = 0;
  let sxx = 0;

  for (const t of labelled) {
    const passed = t.status === 'passed';
    hourAll[t.hour]++;
    if (passed) {
      hourWin[t.hour]++;
      pass++;
    }
    const words = new Set((t.loreRaw ?? t.lore).toLowerCase().match(/[a-z]+/g) ?? []);
    for (const w of words) {
      wordAll.set(w, (wordAll.get(w) ?? 0) + 1);
      if (passed) wordWin.set(w, (wordWin.get(w) ?? 0) + 1);
    }
    const x = words.size;
    sx += x;
    sxx += x * x;
    if (passed) sxy += x;
  }

  const n = labelled.length;
  const baseline = n ? pass / n : 0;
  const lift = [...wordAll]
    .filter(([w, count]) => count >= 60 && !STOPWORDS.has(w))
    .map(([word, count]) => ({ word, n: count, lift: baseline ? (wordWin.get(word) ?? 0) / count / baseline : 0 }))
    .sort((a, b) => b.lift - a.lift)
    .slice(0, 6);

  // Point-biserial correlation between lore length and survival.
  const den = Math.sqrt((n * sxx - sx * sx) * (n * pass - pass * pass));
  const loreCorr = den ? (n * sxy - sx * pass) / den : 0;

  return { hourAll, hourWin, baseline, lift, loreCorr };
}
// #endregion
