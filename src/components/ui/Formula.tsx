import { useEffect, useState } from 'react';

type Katex = typeof import('katex')['default'];
let katexLoad: Promise<Katex> | null = null;

// KaTeX's renderer loads on first use; its stylesheet is imported once in the root layout.
const loadKatex = () => (katexLoad ??= import('katex').then((m) => m.default));

/** KaTeX render of our own constant formulas (never user input). */
export function Formula({ latex, display = true, className = '' }: { latex: string; display?: boolean; className?: string }) {
  const [html, setHtml] = useState<{ latex: string; html: string } | null>(null);

  useEffect(() => {
    let alive = true;
    void loadKatex().then((k) => {
      if (alive) setHtml({ latex, html: k.renderToString(latex, { displayMode: display, throwOnError: false, output: 'html' }) });
    });
    return () => {
      alive = false;
    };
  }, [latex, display]);

  if (!html || html.latex !== latex) return <div className={`h-12 animate-pulse rounded bg-white/5 ${className}`} aria-label="Loading formula" />;
  return <div className={className} dangerouslySetInnerHTML={{ __html: html.html }} />;
}
