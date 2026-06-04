/**
 * useExtensionTrustList — Now-focused extension list reader.
 *
 * The Now dashboard surfaces untrusted/changed project-team extensions in the
 * Needs attention strip. Extension state is a REST read (GET /api/extensions/list)
 * rather than part of the SSE snapshot, so this hook fetches it on mount and
 * exposes a `refresh` callback the dashboard invokes after a successful trust
 * mutation. Stale data is preserved across transient fetch errors so a momentary
 * blip does not flush the warnings; the next refresh reconciles against the
 * authoritative daemon state.
 */
import * as React from 'react';
import type { ExtensionEntry } from '@eforge-build/client/browser';
import { fetchSystemExtensionList } from '@/views/system/system-fetches';

export interface UseExtensionTrustListResult {
  /** Current extension entries, or the last good list across transient errors. */
  extensions: ExtensionEntry[];
  /** Latest fetch error message, or null when the last fetch succeeded. */
  error: string | null;
  /** True while a fetch is in flight. */
  loading: boolean;
  /** Re-fetch the extension list (used after a trust mutation succeeds). */
  refresh: () => void;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function useExtensionTrustList(): UseExtensionTrustListResult {
  const [extensions, setExtensions] = React.useState<ExtensionEntry[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const abortRef = React.useRef<AbortController | null>(null);

  const refresh = React.useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;
    setLoading(true);

    fetchSystemExtensionList(signal)
      .then((data) => {
        if (signal.aborted) return;
        setExtensions(data.extensions);
        setError(null);
        setLoading(false);
      })
      .catch((err) => {
        if (signal.aborted) return;
        // Keep the last good list; surface the error for diagnostics.
        setError(errorMessage(err));
        setLoading(false);
      });
  }, []);

  React.useEffect(() => {
    refresh();
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, [refresh]);

  return { extensions, error, loading, refresh };
}
