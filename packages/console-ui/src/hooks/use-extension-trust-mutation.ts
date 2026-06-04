/**
 * Shared trust mutation hook for Console extension surfaces.
 *
 * Calls the typed `trustSystemExtension` helper, tracks the single pending path,
 * and records per-path error and success messages. After a successful mutation
 * it invokes a caller-supplied refresh callback so the surface can reload the
 * authoritative extension data. State is keyed by extension path so the same
 * behavior can back both the System and Now surfaces.
 */
import { useCallback, useRef, useState } from 'react';
import { trustSystemExtension } from '@/views/system/system-fetches';

export interface UseExtensionTrustMutationResult {
  /** Path of the extension whose trust mutation is in flight, or null when idle. */
  pendingPath: string | null;
  /** Latest error message per extension path. */
  errors: Record<string, string>;
  /** Latest success/next-step message per extension path. */
  successes: Record<string, string>;
  /** Trust the extension at `path`. No-op while another mutation is in flight. */
  onTrust: (path: string) => void;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * @param onSuccess Invoked once after each successful trust mutation so the
 *   caller can refresh the underlying extension data.
 */
export function useExtensionTrustMutation(onSuccess?: () => void): UseExtensionTrustMutationResult {
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [successes, setSuccesses] = useState<Record<string, string>>({});
  const inFlightRef = useRef(false);

  const onTrust = useCallback(
    (path: string) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      setPendingPath(path);
      setErrors((prev) => {
        if (!(path in prev)) return prev;
        const next = { ...prev };
        delete next[path];
        return next;
      });
      setSuccesses((prev) => {
        if (!(path in prev)) return prev;
        const next = { ...prev };
        delete next[path];
        return next;
      });

      void trustSystemExtension(path)
        .then((response) => {
          setSuccesses((prev) => ({ ...prev, [path]: response.message }));
          onSuccess?.();
        })
        .catch((err) => {
          setSuccesses((prev) => {
            if (!(path in prev)) return prev;
            const next = { ...prev };
            delete next[path];
            return next;
          });
          setErrors((prev) => ({ ...prev, [path]: errorMessage(err) }));
        })
        .finally(() => {
          inFlightRef.current = false;
          setPendingPath(null);
        });
    },
    [onSuccess],
  );

  return { pendingPath, errors, successes, onTrust };
}
