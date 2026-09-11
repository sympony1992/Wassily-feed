// Start the agent when the Next.js server boots, not on the first request.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return; // never ingest during `next build`
  const { getRuntime } = await import('./server/runtime');
  getRuntime();
}
