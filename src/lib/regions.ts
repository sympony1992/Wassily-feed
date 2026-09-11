/**
 * Pull a `// #region stage:<name>` … `// #endregion` block out of a raw source
 * file, so the terminals type the code that actually runs rather than a prop.
 */
export function extractRegion(source: string, name: string): string {
  const start = source.indexOf(`// #region stage:${name}`);
  if (start < 0) return `// region "${name}" not found`;
  const bodyStart = source.indexOf('\n', start) + 1;
  const end = source.indexOf('// #endregion', bodyStart);
  const body = source.slice(bodyStart, end < 0 ? undefined : end);
  const lines = body.replace(/\s+$/, '').split('\n');
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^ */)![0].length));
  return lines.map((l) => l.slice(indent)).join('\n');
}
