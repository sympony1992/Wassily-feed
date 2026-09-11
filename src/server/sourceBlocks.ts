import { readFileSync } from 'node:fs';
import path from 'node:path';
import { SITE } from '@/config/site';
import type { TypingBlock } from '@/hooks/useTyping';
import { extractRegion } from '@/lib/regions';

// Read at build time by the pages: the terminals type the code that actually runs.
const read = (...parts: string[]) => readFileSync(path.join(process.cwd(), 'src', ...parts), 'utf8');

export function crtBlocks(): TypingBlock[] {
  const sanitize = read('engine', 'sanitize.ts');
  return [
    { stage: `ingest · ${SITE.chain.toLowerCase()}`, src: extractRegion(read('server', 'sources', 'dexscreener.ts'), 'ingest') },
    { stage: 'lore safety', src: sanitize.slice(sanitize.indexOf('export function sanitizeLore')).trim() },
    { stage: 'features', src: extractRegion(read('engine', 'features.ts'), 'features') },
    { stage: 'training', src: extractRegion(read('engine', 'model.ts'), 'training') },
    { stage: 'the jar', src: extractRegion(read('engine', 'proof.ts'), 'jar') },
  ];
}

export function consoleBlocks(): TypingBlock[] {
  return [
    { stage: 'ingest', src: extractRegion(read('server', 'sources', 'dexscreener.ts'), 'ingest') },
    { stage: 'features', src: extractRegion(read('engine', 'features.ts'), 'features') },
    { stage: 'training', src: extractRegion(read('engine', 'model.ts'), 'training') },
    { stage: 'evaluating', src: extractRegion(read('engine', 'trainer.ts'), 'evaluating') },
    { stage: 'conclusions', src: extractRegion(read('engine', 'findings.ts'), 'conclusions') },
  ];
}
