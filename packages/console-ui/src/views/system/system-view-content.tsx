/**
 * Presentational page component for the System configuration view.
 * Receives injected SystemSurfacesState — used directly by component tests.
 */
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { ActivityDrawer } from '@/components/activity/activity-drawer';
import { DaemonSection } from './daemon-section';
import { ConfigSection } from './config-section';
import { ProfilesSection } from './profiles-section';
import { ExtensionsSection } from './extensions-section';
import type { ExtensionManagementControls } from './use-extension-management-mutations';
import { ExtensionContributionsSection } from './extension-contributions-section';
import { ModelsSection } from './models-section';
import { StackArtifactsSection } from './stack-artifacts-section';
import { StackSyncSection } from './stack-sync-section';
import type { SystemSurfacesState } from './system-types';
import type { ConsoleProjectState } from '@/lib/project-state';

interface SystemViewContentProps {
  state: SystemSurfacesState;
  onRefresh: () => void;
  projectState?: ConsoleProjectState;
  extensionManagement?: ExtensionManagementControls;
}

function readActivityOpenParam(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('activity') === 'open';
}

export function SystemViewContent({ state, onRefresh, projectState, extensionManagement }: SystemViewContentProps) {
  // Activity is daemon-level event flow, so its log lives here on System rather
  // than the Now glance view. Same right-side drawer, opened from the header and
  // deep-linkable via `?activity=open`.
  const [activityOpen, setActivityOpen] = React.useState(() => readActivityOpenParam());
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    if (!activityOpen) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, [activityOpen]);

  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div>
          <h1 className="text-sm font-semibold text-foreground">System Configuration</h1>
          <p className="text-xs text-muted-foreground">
            Daemon health, configuration, extensions, and model catalog.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setActivityOpen(true)}
            aria-label="Open activity log"
          >
            Activity log →
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            aria-label="Refresh system data"
          >
            Refresh system data
          </Button>
        </div>
      </div>

      <div className="flex-1 p-4 space-y-4 overflow-auto">
        <DaemonSection
          health={state.daemon.health}
          version={state.daemon.version}
          projectContext={state.daemon.projectContext}
          projectState={projectState}
        />

        <ConfigSection
          show={state.config.show}
          validate={state.config.validate}
        />

        <ProfilesSection
          list={state.profiles.list}
          active={state.profiles.active}
        />

        <ExtensionsSection
          list={state.extensions.list}
          validate={state.extensions.validate}
          management={extensionManagement}
        />

        <ExtensionContributionsSection
          manifest={state.extensions.contributions}
        />


        <ModelsSection
          catalogs={state.models.catalogs}
        />

        <StackArtifactsSection
          layers={projectState?.stackLayers}
        />

        <StackSyncSection
          stackSync={projectState?.stackSync}
        />
      </div>

      <ActivityDrawer
        open={activityOpen}
        onClose={() => setActivityOpen(false)}
        activity={projectState?.recentActivity ?? []}
        now={now}
      />
    </div>
  );
}
