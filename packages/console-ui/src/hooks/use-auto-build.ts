import { useCallback, useRef, useState } from 'react';
import { API_ROUTES, pauseScheduler as pauseSchedulerRequest, resumeScheduler as resumeSchedulerRequest } from '@eforge-build/client/browser';
import type { AutoBuildState } from '@eforge-build/client/browser';
import { isAutoStartPaused } from '@/lib/auto-start';

async function requestAutoBuildEnabled(enabled: boolean): Promise<AutoBuildState> {
  const response = await fetch(API_ROUTES.autoBuildSet, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Auto-start request failed (${response.status}): ${text}`);
  }
  return response.json() as Promise<AutoBuildState>;
}

function desiredAutoBuildEnabled(autoBuildState: AutoBuildState): boolean {
  return (autoBuildState.desired ?? (autoBuildState.enabled ? 'enabled' : 'disabled')) === 'enabled';
}

async function setAutoStartEnabled(autoBuildState: AutoBuildState, enabled: boolean): Promise<AutoBuildState | null> {
  const desiredEnabled = desiredAutoBuildEnabled(autoBuildState);

  if (enabled) {
    if (desiredEnabled && isAutoStartPaused(autoBuildState)) return resumeSchedulerRequest();
    if (desiredEnabled && ['running', 'starting', 'restarting', undefined].includes(autoBuildState.mode)) return null;
    return requestAutoBuildEnabled(true);
  }

  if (desiredEnabled) return pauseSchedulerRequest();
  return null;
}

export function useAutoBuild(
  autoBuildState: AutoBuildState | null,
  onUpdate: (state: AutoBuildState | null) => void,
): {
  toggling: boolean;
  error: string | null;
  setEnabled: (enabled: boolean) => void;
} {
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const togglingRef = useRef(false);

  const setEnabled = useCallback((enabled: boolean) => {
    if (!autoBuildState || togglingRef.current) return;
    togglingRef.current = true;
    setToggling(true);
    setError(null);
    setAutoStartEnabled(autoBuildState, enabled)
      .then((newState) => {
        if (newState) onUpdate(newState);
        setError(null);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        togglingRef.current = false;
        setToggling(false);
      });
  }, [autoBuildState, onUpdate]);

  return { toggling, error, setEnabled };
}
