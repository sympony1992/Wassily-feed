import { Collapsible } from '@base-ui/react/collapsible';
import { useState } from 'react';
import { SITE } from '@/config/site';
import { useTypingCycle, type TypingBlock } from '@/hooks/useTyping';
import { highlight } from '@/lib/highlight';
import { IconChevronDown } from '../ui/Icons';
import { Badge, Card, CardHeader } from '../ui/primitives';

/** Types real excerpts of the running source. Collapsed = paused, so nothing loops off-screen. */
export function PipelineCard({ blocks, title, description, collapsible = true }: { blocks: TypingBlock[]; title: string; description: string; collapsible?: boolean }) {
  const [open, setOpen] = useState(!collapsible);
  const [paused, setPaused] = useState(false);
  const typing = useTypingCycle(blocks, collapsible ? SITE.typing.crt : SITE.typing.console, !open || paused);

  const body = (
    <pre className="scrollbar-thin h-72 overflow-hidden rounded-b-xl bg-code p-4 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap text-code-fg">
      {highlight(typing.text)}
      <span className="ml-0.5 inline-block h-[1em] w-[0.5em] bg-accent align-[-0.15em]" />
    </pre>
  );

  const stage = <Badge className="font-mono">{typing.stage}</Badge>;

  if (!collapsible) {
    return (
      <Card className="flex flex-col">
        <CardHeader
          title={title}
          description={description}
          action={
            <>
              {stage}
              <button type="button" onClick={() => setPaused((p) => !p)} aria-pressed={paused} className="cursor-pointer text-xs text-muted hover:text-fg">
                {paused ? 'Resume' : 'Pause'}
              </button>
            </>
          }
        />
        {body}
      </Card>
    );
  }

  return (
    <Card>
      <Collapsible.Root open={open} onOpenChange={(next) => setOpen(next)}>
        <Collapsible.Trigger className="group flex w-full cursor-pointer items-center justify-between gap-4 rounded-xl px-5 py-3.5 text-left focus-visible:outline-2 focus-visible:outline-accent">
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-fg">{title}</span>
            <span className="mt-0.5 block text-xs text-pretty text-muted">{description}</span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            {open && stage}
            <IconChevronDown className="size-4 text-muted group-data-[panel-open]:rotate-180" />
          </span>
        </Collapsible.Trigger>
        <Collapsible.Panel className="border-t border-border">{body}</Collapsible.Panel>
      </Collapsible.Root>
    </Card>
  );
}
