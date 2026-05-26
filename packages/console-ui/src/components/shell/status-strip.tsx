import * as React from 'react';
import { cn } from '@/lib/utils';
import type { ConsoleProjectState } from '@/lib/project-state';
import { selectActiveSessionIds } from '@/lib/selectors';

interface StatusStripProps {
  projectState: ConsoleProjectState;
}

function formatTime(ts: number | null): string {
  if (ts === null) return '--';
  return new Date(ts).toLocaleTimeString();
}

export function StatusStrip({ projectState }: StatusStripProps) {
  const { connectionStatus, queue, runs, autoBuild, lastEventAt, lastSnapshotAt } = projectState;

  const activeBuilds = selectActiveSessionIds(runs).length;

  const queueCount = queue.length;

  const connectionLabel =
    connectionStatus === 'connected'
      ? 'Connected'
      : connectionStatus === 'connecting'
        ? 'Connecting...'
        : 'Disconnected';

  const connectionColor =
    connectionStatus === 'connected'
      ? 'text-[#67f553]'
      : connectionStatus === 'connecting'
        ? 'text-yellow'
        : 'text-red';

  return (
    <div
      className="flex items-center gap-4 px-3 py-1 border-t border-border text-xs text-muted-foreground"
      aria-label="connection and daemon status"
    >
      {/* Connection status */}
      <span className={cn('flex items-center gap-1', connectionColor)}>
        <span
          className={cn(
            'inline-block w-1.5 h-1.5 rounded-full',
            connectionStatus === 'connected' && 'bg-[#67f553]',
            connectionStatus === 'connecting' && 'bg-yellow',
            connectionStatus === 'disconnected' && 'bg-red',
          )}
          aria-hidden="true"
        />
        {connectionLabel}
      </span>

      <span className="text-border">|</span>

      {/* Queue count */}
      <span>
        Queue: <span className="text-foreground">{queueCount}</span>
      </span>

      {/* Active builds */}
      <span>
        Active: <span className="text-foreground">{activeBuilds}</span>
      </span>

      {/* Auto-build */}
      <span>
        Auto-build:{' '}
        <span
          className={cn(
            autoBuild?.enabled ? 'text-[#67f553]' : 'text-muted-foreground',
          )}
        >
          {autoBuild === null ? '--' : autoBuild.enabled ? 'on' : 'off'}
        </span>
      </span>

      {/* Last update */}
      <span className="ml-auto">
        Updated: <span className="text-foreground">{formatTime(lastEventAt ?? lastSnapshotAt)}</span>
      </span>
    </div>
  );
}
