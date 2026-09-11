/** Small helpers shared by the route handlers. */

export const noStore = { 'Cache-Control': 'no-store' };
export const ideasCache = { 'Cache-Control': 'public, max-age=30' };

export function json(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return Response.json(body, { status: init.status ?? 200, headers: { ...noStore, ...init.headers } });
}

export function query(req: Request) {
  const params = new URL(req.url).searchParams;
  return {
    get: (k: string) => params.get(k),
    num: (k: string) => (params.has(k) && Number.isFinite(Number(params.get(k))) ? Number(params.get(k)) : undefined),
  };
}
