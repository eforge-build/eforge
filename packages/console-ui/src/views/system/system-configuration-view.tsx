/**
 * System configuration route wrapper.
 * Receives shell project state, calls useSystemSurfaces(), and renders the System page.
 */
import * as React from 'react';
import { useSystemSurfaces } from './use-system-surfaces';
import { SystemViewContent } from './system-view-content';
import type { ConsoleProjectState } from '@/lib/project-state';

interface SystemConfigurationViewProps {
  projectState: ConsoleProjectState;
}

export function SystemConfigurationView({ projectState: _projectState }: SystemConfigurationViewProps) {
  const { state, refresh } = useSystemSurfaces();

  return <SystemViewContent state={state} onRefresh={refresh} />;
}
