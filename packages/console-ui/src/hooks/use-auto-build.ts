import { useCallback, useRef, useState } from 'react';
import { API_ROUTES } from '@eforge-build/client/browser';
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
      .finally(() => {
        togglingRef.current = false;
        setToggling(false);
      });
  }, [autoBuildState, onUpdate]);

  return { toggling, setEnabled };
}
