import { useCallback, useRef, useState } from 'react';
import { API_ROUTES, pauseScheduler as pauseSchedulerRequest, resumeScheduler as resumeSchedulerRequest } from '@eforge-build/client/browser';
import type { AutoBuildState } from '@eforge-build/client/browser';

async function setAutoBuild(enabled: boolean): Promise<AutoBuildState | null> {
  try {
    const response = await fetch(API_ROUTES.autoBuildSet, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    if (!response.ok) return null;
    return response.json() as Promise<AutoBuildState>;
  } catch {
    return null;
  }
}

export function useAutoBuild(
  autoBuildState: AutoBuildState | null,
  onUpdate: (state: AutoBuildState | null) => void,
): {
  toggling: boolean;
  setEnabled: (enabled: boolean) => void;
  schedulerToggling: boolean;
  schedulerError: string | null;
  pauseScheduler: () => void;
  resumeScheduler: () => void;
} {
  const [toggling, setToggling] = useState(false);
  const [schedulerToggling, setSchedulerToggling] = useState(false);
  const [schedulerError, setSchedulerError] = useState<string | null>(null);
  const togglingRef = useRef(false);
  const schedulerTogglingRef = useRef(false);

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
      .finally(() => {
        togglingRef.current = false;
        setToggling(false);
      });
  }, [autoBuildState, onUpdate]);

  const runSchedulerMutation = useCallback((mutation: () => Promise<AutoBuildState>) => {
    if (!autoBuildState || schedulerTogglingRef.current || autoBuildState.desired !== 'enabled') return;
    schedulerTogglingRef.current = true;
    setSchedulerToggling(true);
    setSchedulerError(null);
    mutation()
      .then((newState) => {
        onUpdate(newState);
        setSchedulerError(null);
      })
      .catch((err) => {
        setSchedulerError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        schedulerTogglingRef.current = false;
        setSchedulerToggling(false);
      });
  }, [autoBuildState, onUpdate]);

  const pauseScheduler = useCallback(() => {
    runSchedulerMutation(() => pauseSchedulerRequest());
  }, [runSchedulerMutation]);

  const resumeScheduler = useCallback(() => {
    runSchedulerMutation(() => resumeSchedulerRequest());
  }, [runSchedulerMutation]);

  return { toggling, setEnabled, schedulerToggling, schedulerError, pauseScheduler, resumeScheduler };
}
