/**
 * Stack sync section — status and manual controls for the git-spice repo
 * sync + restack cycle.
 *
 * This lives under System rather than the Now dashboard because stack sync is
 * housekeeping (control plane), not build status: it runs automatically
 * after-build and on a schedule, and its normal outcomes (complete/skipped)
 * need no attention. The Now dashboard only escalates a conflict/failed sync
 * via the top alert strip; the full status detail and Sync now / Dry run
 * controls live here.
 */
import * as React from 'react';
import { selectNowStackSyncStatus } from '@/lib/selectors/now';
import type { ConsoleProjectState } from '@/lib/project-state';
import { StackSyncStatusCard } from './stack-sync-status-card';

interface StackSyncSectionProps {
  stackSync?: ConsoleProjectState['stackSync'];
}

export function StackSyncSection({ stackSync }: StackSyncSectionProps) {
  const model = React.useMemo(
    () => selectNowStackSyncStatus(stackSync ?? null),
    [stackSync],
  );
  return <StackSyncStatusCard sync={model} />;
}
