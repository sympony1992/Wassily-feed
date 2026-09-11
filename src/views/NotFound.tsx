'use client';

import Link from 'next/link';
import { AppShell } from '@/components/shell/AppShell';
import { buttonClass } from '@/components/ui/primitives';

export function NotFoundView() {
  return (
    <AppShell title="Page not found" description="This page was never committed to the log.">
      <Link href="/" className={buttonClass('primary', 'md')}>
        Back to Overview
      </Link>
    </AppShell>
  );
}
