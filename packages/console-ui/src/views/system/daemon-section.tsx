/**
 * Daemon section — health PID, API version, eforge package version, project cwd, git remote,
 * and live telemetry (subscribers, uptime, scheduler limit) when project state is available.
 */
import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { SystemSection } from './system-section';
import type { Loadable, HealthResponse, VersionResponse, ProjectContext } from './system-types';
import type { ConsoleProjectState } from '@/lib/project-state';
import { selectNowStatusSummary } from '@/lib/selectors/now';
import { formatDuration } from '@/lib/format';

interface DaemonSectionProps {
  health: Loadable<HealthResponse>;
  version: Loadable<VersionResponse>;
  projectContext: Loadable<ProjectContext>;
  projectState?: ConsoleProjectState;
}

function LoadableValue<T>({
  loadable,
  render,
}: {
  loadable: Loadable<T>;
  render: (data: T) => React.ReactNode;
}) {
  if (loadable.status === 'idle' || loadable.status === 'loading') {
    return <span className="text-muted-foreground">Loading...</span>;
  }
  if (loadable.status === 'error') {
    if (loadable.data != null) {
      return (
        <>
          {render(loadable.data)}
          <span className="text-destructive text-xs ml-1" title={loadable.error}>(stale)</span>
        </>
      );
    }
    return <span className="text-destructive text-xs">{loadable.error}</span>;
  }
  if (loadable.data == null) {
    return <span className="text-muted-foreground">-</span>;
  }
  return <>{render(loadable.data)}</>;
}

export function DaemonSection({ health, version, projectContext, projectState }: DaemonSectionProps) {
  const isLoading =
    health.status === 'loading' ||
    version.status === 'loading' ||
    projectContext.status === 'loading';
  const firstError =
    health.status === 'error'
      ? health.error
      : version.status === 'error'
        ? version.error
        : projectContext.status === 'error'
          ? projectContext.error
          : undefined;

  const summary = projectState != null
    ? selectNowStatusSummary(projectState, {})
    : null;

  return (
    <SystemSection
      title="Daemon"
      description="Daemon health, version, and project context."
      loading={isLoading && health.status === 'idle'}
    >
      {firstError && health.status !== 'success' && version.status !== 'success' && projectContext.status !== 'success' && (
        <p className="text-xs text-destructive" role="alert">{firstError}</p>
      )}

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
        <dt className="text-muted-foreground font-medium">Status</dt>
        <dd>
          <LoadableValue
            loadable={health}
            render={(h) => (
              <Badge variant="secondary" className="text-xs">
                {h.status} (PID {h.pid})
              </Badge>
            )}
          />
        </dd>

        <dt className="text-muted-foreground font-medium">Daemon API version</dt>
        <dd>
          <LoadableValue loadable={version} render={(v) => <span>{v.version}</span>} />
        </dd>

        <dt className="text-muted-foreground font-medium">eforge version</dt>
        <dd>
          <LoadableValue
            loadable={version}
            render={(v) => <span>{v.eforgeVersion ?? '-'}</span>}
          />
        </dd>

        <dt className="text-muted-foreground font-medium">Project cwd</dt>
        <dd className="font-mono break-all">
          <LoadableValue
            loadable={projectContext}
            render={(c) => <span>{c.cwd ?? '-'}</span>}
          />
        </dd>

        <dt className="text-muted-foreground font-medium">Git remote</dt>
        <dd className="font-mono break-all">
          <LoadableValue
            loadable={projectContext}
            render={(c) => <span>{c.gitRemote ?? '-'}</span>}
          />
        </dd>

        {summary?.subscribers != null && (
          <>
            <dt className="text-muted-foreground font-medium">Subscribers</dt>
            <dd>{summary.subscribers}</dd>
          </>
        )}

        {summary?.uptimeMs != null && (
          <>
            <dt className="text-muted-foreground font-medium">Uptime</dt>
            <dd>{formatDuration(summary.uptimeMs)}</dd>
          </>
        )}

        {summary?.schedulerLimit != null && (
          <>
            <dt className="text-muted-foreground font-medium">Scheduler limit</dt>
            <dd>{summary.schedulerLimit}</dd>
          </>
        )}
      </dl>
    </SystemSection>
  );
}
