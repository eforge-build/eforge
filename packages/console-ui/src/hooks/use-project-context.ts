import { useEffect, useState } from 'react';
import { API_ROUTES } from '@eforge-build/client/browser';
import type { ProjectContext } from '@eforge-build/client/browser';
import { fetchJson } from '@/lib/fetch-json';

/**
 * Fetch the daemon's project context once on mount. Used as a fallback source
 * for the header project label when no runs exist yet (fresh/idle daemon).
 * Tolerates older daemons that lack the route (404 -> null).
 */
export function useProjectContext(): ProjectContext | null {
  const [context, setContext] = useState<ProjectContext | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchJson<ProjectContext>(API_ROUTES.projectContext, { allowNotFound: true, signal: controller.signal })
      .then((data) => {
        if (data) setContext(data);
      })
      .catch(() => {
        // Project context is best-effort; leave the run-cwd fallback in place.
      });
    return () => controller.abort();
  }, []);

  return context;
}
