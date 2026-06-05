/**
 * System configuration route wrapper.
 * Receives shell project state, calls useSystemSurfaces(), and renders the System page.
 */
import * as React from 'react';
import { useSystemSurfaces } from './use-system-surfaces';
import { SystemViewContent } from './system-view-content';
import { useExtensionManagementMutations } from './use-extension-management-mutations';
import type { ConsoleProjectState } from '@/lib/project-state';

interface SystemConfigurationViewProps {
  projectState: ConsoleProjectState;
}

export function SystemConfigurationView({ projectState }: SystemConfigurationViewProps) {
  const { state, refresh } = useSystemSurfaces();
  const management = useExtensionManagementMutations(refresh);

  return (
    <SystemViewContent
      state={state}
      projectState={projectState}
      onRefresh={refresh}
      extensionManagement={management}
    />
  );
}
