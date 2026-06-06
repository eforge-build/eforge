import type { ConsoleWorkstationManifestEntry } from '@eforge-build/client/browser';

export function sortWorkstations(workstations: ConsoleWorkstationManifestEntry[]): ConsoleWorkstationManifestEntry[] {
  return [...workstations].sort((a, b) => {
    const title = a.title.localeCompare(b.title);
    if (title !== 0) return title;
    const extension = a.extensionName.localeCompare(b.extensionName);
    if (extension !== 0) return extension;
    return a.id.localeCompare(b.id);
  });
}

export function findWorkstationById(
  workstations: ConsoleWorkstationManifestEntry[],
  workstationId: string | null | undefined,
): ConsoleWorkstationManifestEntry | null {
  if (!workstationId) return null;
  return workstations.find((workstation) => workstation.id === workstationId) ?? null;
}

export function selectWorkstation(
  workstations: ConsoleWorkstationManifestEntry[],
  workstationId: string | null | undefined,
): ConsoleWorkstationManifestEntry | null {
  if (workstations.length === 0) return null;
  if (!workstationId) return workstations[0] ?? null;
  return findWorkstationById(workstations, workstationId);
}

export function resolveAllowedWorkstationAction(
  workstation: ConsoleWorkstationManifestEntry,
  actionId: string,
): string | null {
  if (!actionId.trim()) return null;
  if (workstation.allowedActions.includes(actionId)) return actionId;
  const effectiveId = `${workstation.extensionName}:${actionId}`;
  return workstation.allowedActions.includes(effectiveId) ? effectiveId : null;
}
