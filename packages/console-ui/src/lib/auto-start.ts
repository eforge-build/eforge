import type { AutoBuildState } from '@eforge-build/client/browser';

export function isAutoStartPaused(autoBuild: AutoBuildState | null | undefined): boolean {
  return autoBuild?.scheduler?.paused === true || autoBuild?.mode === 'paused';
}

export function isAutoStartActive(autoBuild: AutoBuildState | null | undefined): boolean | null {
  if (!autoBuild) return null;
  const desired = autoBuild.desired ?? (autoBuild.enabled ? 'enabled' : 'disabled');
  if (desired !== 'enabled') return false;
  if (isAutoStartPaused(autoBuild)) return false;
  return autoBuild.mode !== 'disabled' && autoBuild.mode !== 'stopping' && autoBuild.mode !== 'faulted';
}
