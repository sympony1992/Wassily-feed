import { consoleBlocks } from '@/server/sourceBlocks';
import { ConsoleView } from '@/views/Console';

export default function ConsolePage() {
  return <ConsoleView blocks={consoleBlocks()} />;
}
