import type { ExtensionContributionManifestResponse } from '@eforge-build/client/browser';
import { useExtensionContributionManifest } from '@/hooks/use-extension-contribution-manifest';

export type WorkstationManifestStatus = 'idle' | 'loading' | 'success' | 'empty' | 'error';

export interface WorkstationManifestState {
  status: WorkstationManifestStatus;
  data?: ExtensionContributionManifestResponse;
  error?: string;
  updatedAt?: number;
}

export function useWorkstationManifest(): WorkstationManifestState & { refresh: () => void } {
  const manifest = useExtensionContributionManifest();
  const status: WorkstationManifestStatus = manifest.status === 'success' && (manifest.data?.consoleWorkstations.length ?? 0) === 0
    ? 'empty'
    : manifest.status;

  return { ...manifest, status };
}
