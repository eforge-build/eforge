import type { ConsoleWorkstationManifestEntry } from '@eforge-build/client/browser';

export type SrcDocWorkstationManifestEntry = Extract<ConsoleWorkstationManifestEntry, { srcDoc: string }>;
export type FrameBundleWorkstationManifestEntry = Extract<ConsoleWorkstationManifestEntry, { frameBundle: unknown }>;

export function isFrameBundleWorkstation(
  workstation: ConsoleWorkstationManifestEntry,
): workstation is FrameBundleWorkstationManifestEntry {
  return 'frameBundle' in workstation;
}

export function isSrcDocWorkstation(
  workstation: ConsoleWorkstationManifestEntry,
): workstation is SrcDocWorkstationManifestEntry {
  return 'srcDoc' in workstation;
}
