/**
 * System configuration route wrapper.
 * Receives shell project state, calls useSystemSurfaces(), and renders the System page.
 */
import * as React from 'react';
import { useSystemSurfaces } from './use-system-surfaces';
import { SystemViewContent } from './system-view-content';
import { useExtensionTrustMutation } from '@/hooks/use-extension-trust-mutation';
import type { ConsoleProjectState } from '@/lib/project-state';

interface SystemConfigurationViewProps {
  projectState: ConsoleProjectState;
}

export function SystemConfigurationView({ projectState }: SystemConfigurationViewProps) {
  const { state, refresh } = useSystemSurfaces();
  const trust = useExtensionTrustMutation(refresh);

  return (
    <SystemViewContent
      state={state}
      projectState={projectState}
      onRefresh={refresh}
      extensionTrust={trust}
    />
  );
}
