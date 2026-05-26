import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/common/empty-state';
import type { ConsoleRouteId } from '@/lib/navigation';
import type { ConnectionStatus } from '@/lib/types';

const ROUTE_DESCRIPTIONS: Record<ConsoleRouteId, { title: string; description: string }> = {
  now: {
    title: 'Now',
    description:
      'Live dashboard showing current active builds, queue head, and daemon status.',
  },
  queue: {
    title: 'Queue',
    description: 'Inspect and manage the build queue.',
  },
  runs: {
    title: 'Runs',
    description: 'Browse completed and active build runs.',
  },
  system: {
    title: 'System',
    description: 'Daemon configuration, extensions, and runtime settings.',
  },
  activity: {
    title: 'Activity',
    description: 'Audit log and event stream for the daemon.',
  },
};

interface RoutePlaceholderProps {
  routeId: ConsoleRouteId;
  connectionStatus: ConnectionStatus;
}

export function RoutePlaceholder({ routeId, connectionStatus }: RoutePlaceholderProps) {
  const { title, description } = ROUTE_DESCRIPTIONS[routeId];

  let statusNote: string | undefined;
  if (connectionStatus === 'connecting') {
    statusNote = 'Connecting to daemon...';
  } else if (connectionStatus === 'disconnected') {
    statusNote = 'Disconnected — waiting for daemon.';
  }

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold text-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col items-center justify-center">
        <EmptyState
          title={statusNote ?? `${title} view`}
          description={statusNote ? description : `${description} Content will appear here once this view module is loaded.`}
        />
      </CardContent>
    </Card>
  );
}
