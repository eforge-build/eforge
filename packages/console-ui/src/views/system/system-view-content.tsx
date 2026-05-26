/**
 * Presentational page component for the System configuration view.
 * Receives injected SystemSurfacesState — used directly by component tests.
 */
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { DaemonSection } from './daemon-section';
import { ConfigSection } from './config-section';
import { ProfilesSection } from './profiles-section';
import { ExtensionsSection } from './extensions-section';
import { PlaybooksSection } from './playbooks-section';
import { SessionPlansSection } from './session-plans-section';
import { ModelsSection } from './models-section';
import type { SystemSurfacesState } from './system-types';

interface SystemViewContentProps {
  state: SystemSurfacesState;
  onRefresh: () => void;
}

export function SystemViewContent({ state, onRefresh }: SystemViewContentProps) {
  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div>
          <h1 className="text-sm font-semibold text-foreground">System Configuration</h1>
          <p className="text-xs text-muted-foreground">
            Daemon health, configuration, extensions, playbooks, session plans, and model catalog.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onRefresh}
          aria-label="Refresh system data"
        >
          Refresh system data
        </Button>
      </div>

      <div className="flex-1 p-4 space-y-4 overflow-auto">
        <DaemonSection
          health={state.daemon.health}
          version={state.daemon.version}
          projectContext={state.daemon.projectContext}
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
        />

        <PlaybooksSection
          list={state.playbooks.list}
        />

        <SessionPlansSection
          list={state.sessionPlans.list}
        />

        <ModelsSection
          catalogs={state.models.catalogs}
        />
      </div>
    </div>
  );
}
