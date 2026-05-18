import { useState, useCallback, useRef } from 'react';
import { setAutoBuild, type AutoBuildState } from '@/lib/api';

/**
 * Writer-only hook for the auto-build toggle.
 *
 * The reader path — the current enabled/disabled state — is now owned by
 * `useDaemonEvents().daemonState.autoBuild`. This hook only fires the HTTP
 * mutation and tracks in-flight state to prevent double-clicks.
 *
 * After a successful call the caller's `onUpdate` is invoked with the new
 * state returned by the server, so the daemon-state slice can be updated
 * immediately without waiting for the next SSE event.
 */
export function useAutoBuild(
  autoBuildState: AutoBuildState | null,
  onUpdate: (state: AutoBuildState | null) => void,
): {
  toggling: boolean;
  setEnabled: (enabled: boolean) => void;
} {
  const [toggling, setToggling] = useState(false);
  const togglingRef = useRef(false);

  const setEnabled = useCallback((enabled: boolean) => {
    if (!autoBuildState || togglingRef.current) return;
    togglingRef.current = true;
    setToggling(true);
    setAutoBuild(enabled)
      .then((newState) => {
        if (newState) {
          onUpdate(newState);
        }
      })
      .catch(() => {
        // Server error — the daemon state will reflect reality on the next
        // snapshot or SSE event; no local rollback needed.
      })
      .finally(() => {
        togglingRef.current = false;
        setToggling(false);
      });
  }, [autoBuildState, onUpdate]);

  return { toggling, setEnabled };
}
