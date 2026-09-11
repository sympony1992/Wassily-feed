import { SITE } from '@/config/site';
import { useTypeOnce } from '@/hooks/useTyping';
import { highlight } from '@/lib/highlight';
import { useStore } from '@/store/useStore';
import { Badge, Card, CardHeader } from '../ui/primitives';

/** The generator's real source, as served by /api/ideas/generator from the running server. */
export function LiveSource() {
  const remote = useStore((s) => s.ideas.remoteSource);
  const { text, typing } = useTypeOnce(remote?.code ?? '', SITE.typing.source);

  return (
    <Card className="flex h-[32rem] flex-col">
      <CardHeader
        title="Generator source"
        description="src/engine/ideas.ts, served by the running server"
        action={remote && <Badge className="font-mono" title="sha256 of the displayed source">sha {remote.sha.slice(0, 8)}</Badge>}
      />
      <pre className="scrollbar-thin flex-1 overflow-y-auto rounded-b-xl bg-code p-4 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap text-code-fg">
        {remote ? highlight(text) : <span className="text-subtle">Loading the generator…</span>}
        {remote && typing && <span className="ml-0.5 inline-block h-[1em] w-[0.55em] bg-accent align-[-0.15em]" />}
      </pre>
    </Card>
  );
}
