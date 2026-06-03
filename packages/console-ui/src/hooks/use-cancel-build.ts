import { useCallback, useRef, useState } from 'react';
import { API_ROUTES, buildPath } from '@eforge-build/client/browser';

/**
 * POST the daemon's cancel endpoint for a session. Returns true on a 2xx
 * response. Silently returns false on network failure or a non-ok status — the
 * caller treats cancel as best-effort (the build either stops or the UI updates
 * on the next snapshot).
 */
async function postCancel(sessionId: string): Promise<boolean> {
  try {
    const res = await fetch(buildPath(API_ROUTES.cancel, { sessionId }), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    return res.ok;
  } catch {
    return false;
  }
}

export interface UseCancelBuildResult {
  cancelling: boolean;
  cancel: () => void;
}

/**
 * Imperative cancel action for a running build, guarded against concurrent
 * invocations. Confirmation is the caller's responsibility — see
 * `CancelBuildButton`, which gates this behind an `AlertDialog`.
 */
export function useCancelBuild(sessionId: string): UseCancelBuildResult {
  const [cancelling, setCancelling] = useState(false);
  const inFlightRef = useRef(false);

  const cancel = useCallback(() => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setCancelling(true);
    void postCancel(sessionId).finally(() => {
      inFlightRef.current = false;
      setCancelling(false);
    });
  }, [sessionId]);

  return { cancelling, cancel };
}
