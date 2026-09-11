import { crtBlocks } from '@/server/sourceBlocks';
import { OverviewView } from '@/views/Overview';

export default function OverviewPage() {
  return <OverviewView blocks={crtBlocks()} />;
}
