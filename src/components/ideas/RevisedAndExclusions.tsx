import { Tabs } from '@base-ui/react/tabs';
import type { EliminatedItem, ExclusionItem } from '@/engine/types';
import { fmtInt, shortHex } from '@/lib/format';
import { Card } from '../ui/primitives';

const tabClass =
  'cursor-pointer border-b-2 border-transparent px-1 py-3 text-sm text-muted transition-colors duration-150 hover:text-fg aria-selected:border-accent aria-selected:font-medium aria-selected:text-fg focus-visible:outline-2 focus-visible:outline-accent';

export function RevisedAndExclusions({ eliminated, exclusions }: { eliminated: EliminatedItem[]; exclusions: ExclusionItem[] }) {
  return (
    <Card className="flex h-80 flex-col overflow-hidden">
      <Tabs.Root defaultValue="revised" className="flex min-h-0 flex-1 flex-col">
        <Tabs.List className="flex gap-5 border-b border-border px-5">
          <Tabs.Tab value="revised" className={tabClass}>
            Revised out <span className="font-mono text-xs text-subtle tabular-nums">{eliminated.length}</span>
          </Tabs.Tab>
          <Tabs.Tab value="theft" className={tabClass}>
            Theft record <span className="font-mono text-xs text-subtle tabular-nums">{exclusions.length}</span>
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="revised" className="scrollbar-thin min-h-0 flex-1 overflow-auto">
          {eliminated.length === 0 ? (
            <Empty text="No leader has lost rank 1 yet. Check back after the next cycle." />
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface">
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="px-5 py-2 font-normal">Candidate</th>
                  <th className="px-3 py-2 font-normal">Led</th>
                  <th className="px-5 py-2 text-right font-normal">Was → now</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {eliminated.map((e) => (
                  <tr key={`${e.name}-${e.ledCycle}`}>
                    <td className="max-w-0 px-5 py-2.5">
                      <div className="truncate font-medium text-fg">{e.name}</div>
                      <div className="truncate text-xs text-muted">{e.lore}</div>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs text-muted tabular-nums">
                      {e.ledCycle}
                      <div className="text-subtle">lost {e.demotedCycle}</div>
                    </td>
                    <td className="px-5 py-2.5 text-right font-mono text-xs whitespace-nowrap tabular-nums">
                      <span className="mr-1.5 text-subtle line-through">{e.peakScore.toFixed(4)}</span>
                      <span className="text-negative">{e.currentScore.toFixed(4)}</span>
                      <div className="text-subtle">{e.currentRank ? `now #${e.currentRank}` : 'not regenerated'}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Tabs.Panel>

        <Tabs.Panel value="theft" className="scrollbar-thin min-h-0 flex-1 overflow-auto">
          {exclusions.length === 0 ? (
            <Empty text="Nobody has deployed a published idea first. Ideas that are taken appear here with the time gap." />
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface">
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="px-5 py-2 font-normal">Taken name</th>
                  <th className="px-3 py-2 font-normal">Cycle</th>
                  <th className="px-3 py-2 font-normal">Deployer</th>
                  <th className="px-5 py-2 text-right font-normal">Gap</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {exclusions.map((x) => (
                  <tr key={`${x.name}-${x.deployedMint}`}>
                    <td className="max-w-0 px-5 py-2.5">
                      <div className="truncate font-medium text-fg">{x.name}</div>
                      <div className="font-mono text-xs text-muted tabular-nums">{x.blockNumber ? `block ${fmtInt(x.blockNumber)}` : 'block unknown'}</div>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs text-muted tabular-nums">{x.firstCycle}</td>
                    <td className="px-3 py-2.5 font-mono text-xs text-muted" title={x.deployer}>
                      {shortHex(x.deployer)}
                    </td>
                    <td className="px-5 py-2.5 text-right font-mono text-xs text-negative tabular-nums" title={`committed ${x.firstSeenAt}, deployed ${x.deployedAt}`}>
                      +{fmtInt(x.timeGapSeconds)}s
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Tabs.Panel>
      </Tabs.Root>
    </Card>
  );
}

const Empty = ({ text }: { text: string }) => <p className="p-5 text-sm text-pretty text-muted">{text}</p>;
