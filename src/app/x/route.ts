import { SITE } from '@/config/site';

export const dynamic = 'force-dynamic';

export function GET(req: Request) {
  return Response.redirect(SITE.xUrl || new URL('/', req.url).toString(), 307);
}
