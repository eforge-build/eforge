import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/common/empty-state';
import type { ConnectionStatus } from '@/lib/types';

const ROUTE_DESCRIPTIONS: Record<string, { title: string; description: string }> = {
  now: {
    title: 'Now',
    description:
      'Live dashboard showing current active builds, queue head, and daemon status.',
  },
  buildDetail: {
    title: 'Build Detail',
    description: 'Detailed view of a build session. Full view coming in a future update.',
  },
  system: {
    title: 'System',
    description: 'Daemon configuration, extensions, and runtime settings.',
  },
};

const FALLBACK_DESCRIPTION = { title: 'Loading', description: 'Content will appear shortly.' };

interface RoutePlaceholderProps {
  routeId: string;
  connectionStatus: ConnectionStatus;
}

export function RoutePlaceholder({ routeId, connectionStatus }: RoutePlaceholderProps) {
  const { title, description } = ROUTE_DESCRIPTIONS[routeId] ?? FALLBACK_DESCRIPTION;

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
