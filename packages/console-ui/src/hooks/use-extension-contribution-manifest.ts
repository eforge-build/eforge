import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchExtensionContributionManifest, type ExtensionContributionManifestResponse } from '@eforge-build/client/browser';

export type ExtensionContributionManifestStatus = 'idle' | 'loading' | 'success' | 'error';

export interface ExtensionContributionManifestState {
  status: ExtensionContributionManifestStatus;
  data?: ExtensionContributionManifestResponse;
  error?: string;
  updatedAt?: number;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function useExtensionContributionManifest() {
  const [state, setState] = useState<ExtensionContributionManifestState>({ status: 'idle' });
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState((prev) => ({ status: 'loading', data: prev.data, updatedAt: prev.updatedAt }));

    fetchExtensionContributionManifest({ signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;
        setState({ status: 'success', data, updatedAt: Date.now() });
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setState((prev) => ({
          status: 'error',
          error: errorMessage(err),
          data: prev.data,
          updatedAt: prev.updatedAt,
        }));
      });
  }, []);

  useEffect(() => {
    refresh();
    return () => abortRef.current?.abort();
  }, [refresh]);

  return { ...state, refresh };
}
