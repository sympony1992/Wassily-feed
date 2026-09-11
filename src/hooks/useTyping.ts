import { useEffect, useState, useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(QUERY);
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}

export interface TypingBlock {
  stage: string;
  src: string;
}

/** Types each block a few characters per tick, holds, then moves to the next. */
export function useTypingCycle(blocks: TypingBlock[], opts: { chars: number; tickMs: number; holdMs: number }, paused = false) {
  const reduced = useReducedMotion();
  const [blockIdx, setBlockIdx] = useState(0);
  const [charIdx, setCharIdx] = useState(0);
  const block = blocks[blockIdx % blocks.length];
  const full = reduced || charIdx >= block.src.length;

  useEffect(() => {
    if (paused) return;
    if (!full) {
      const t = setTimeout(() => setCharIdx((c) => Math.min(c + opts.chars, block.src.length)), opts.tickMs);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => {
      setBlockIdx((b) => (b + 1) % blocks.length);
      setCharIdx(0);
    }, reduced ? opts.holdMs * 3 : opts.holdMs);
    return () => clearTimeout(t);
  }, [paused, full, charIdx, block.src.length, blocks.length, opts.chars, opts.tickMs, opts.holdMs, reduced]);

  return { stage: block.stage, text: full ? block.src : block.src.slice(0, charIdx), typing: !full };
}

/** Types a single source once; restarts when the source changes. */
export function useTypeOnce(src: string, opts: { chars: number; tickMs: number }) {
  const reduced = useReducedMotion();
  const [state, setState] = useState({ src, idx: 0 });
  const idx = state.src === src ? state.idx : 0;
  if (state.src !== src) setState({ src, idx: 0 });
  const done = reduced || idx >= src.length;

  useEffect(() => {
    if (done) return;
    const t = setTimeout(() => setState((s) => ({ src: s.src, idx: Math.min(s.idx + opts.chars, s.src.length) })), opts.tickMs);
    return () => clearTimeout(t);
  }, [done, idx, opts.chars, opts.tickMs]);

  return { text: done ? src : src.slice(0, idx), typing: !done };
}
