import type { ModelRun, Token } from '@/engine/types';
import { getRuntime } from '@/server/runtime';
import { modelJson, tokenJson } from '@/server/serialize';

export const dynamic = 'force-dynamic';

/** Server-Sent Events: {token, counters} on each token, {model, counters} on each retrain. */
export function GET(req: Request) {
  const { agent, config } = getRuntime();
  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (msg: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(msg)}\n\n`));
        } catch {
          cleanup();
        }
      };
      const onToken = (t: Token) => send({ token: tokenJson(t, config.chain), counters: agent.counters() });
      const onModel = (run: ModelRun) => send({ model: modelJson(run, agent.bound), counters: agent.counters() });
      const ping = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': ping\n\n'));
        } catch {
          cleanup();
        }
      }, 25_000);

      agent.on('token', onToken);
      agent.on('model', onModel);
      cleanup = () => {
        clearInterval(ping);
        agent.off('token', onToken);
        agent.off('model', onModel);
      };
      req.signal.addEventListener('abort', () => {
        cleanup();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });

      send({ hello: { source: config.source, chain: config.chain, persona: config.persona } });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
