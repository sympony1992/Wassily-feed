import { useCallback, useEffect, useSyncExternalStore } from 'react';

export type ThemePref = 'system' | 'light' | 'dark';

const KEY = 'survival-agent:theme';
const listeners = new Set<() => void>();
const media = () => window.matchMedia('(prefers-color-scheme: dark)');

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'dark' || v === 'system' ? v : 'light';
  } catch {
    return 'light';
  }
}

export function applyTheme(pref: ThemePref = readPref()) {
  const dark = pref === 'dark' || (pref === 'system' && media().matches);
  document.documentElement.classList.toggle('dark', dark);
}

/** Light (default) / dark / follow-the-system, remembered per browser. layout.tsx applies it before first paint. */
export function useTheme() {
  const pref = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    readPref,
    () => 'light' as ThemePref,
  );

  const setPref = useCallback((next: ThemePref) => {
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* storage blocked: still apply for this session */
    }
    applyTheme(next);
    listeners.forEach((l) => l());
  }, []);

  useEffect(() => {
    if (pref !== 'system') return;
    const mq = media();
    const onChange = () => applyTheme('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [pref]);

  return { pref, setPref };
}
