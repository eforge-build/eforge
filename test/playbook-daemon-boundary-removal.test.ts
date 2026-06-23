import { describe, expect, it } from 'vitest';
import { startContentRouteHarness } from '../packages/monitor/src/__tests__/route-test-harness.js';

const api = '/api';
const playbookSegment = 'play' + 'book';

const formerPlaybookRoutes: Array<{ method: 'GET' | 'POST'; path: string }> = [
  { method: 'GET', path: `${api}/${playbookSegment}/list` },
  { method: 'GET', path: `${api}/${playbookSegment}/show?name=demo` },
  { method: 'POST', path: `${api}/${playbookSegment}/save` },
  { method: 'POST', path: `${api}/${playbookSegment}/run` },
  { method: 'POST', path: `${api}/${playbookSegment}/promote` },
  { method: 'POST', path: `${api}/${playbookSegment}/demote` },
  { method: 'POST', path: `${api}/${playbookSegment}/validate` },
  { method: 'POST', path: `${api}/${playbookSegment}/copy` },
  { method: 'POST', path: `${api}/session-plan/create-from-${playbookSegment}` },
];

async function requestFormerRoute(harness: Awaited<ReturnType<typeof startContentRouteHarness>>, route: { method: 'GET' | 'POST'; path: string }): Promise<Response> {
  if (route.method === 'GET') return harness.get(route.path);
  return harness.postJson(route.path, {});
}

describe('playbook daemon boundary removal', () => {
  it('does not register direct playbook or create-from-playbook route keys', async () => {
    const harness = await startContentRouteHarness();
    try {
      const keys = harness.routes.map((route) => route.routeKey);
      expect(keys.filter((key) => key.startsWith('playbook'))).toEqual([]);
      expect(keys).not.toContain('sessionPlanCreateFromPlaybook');
      expect(keys).toEqual(expect.arrayContaining(['extensionContributionManifest', 'extensionActionInvoke']));
    } finally {
      await harness.close();
    }
  });

  it('returns the normal unknown-route body for former direct playbook endpoints', async () => {
    const harness = await startContentRouteHarness();
    try {
      for (const route of formerPlaybookRoutes) {
        const res = await requestFormerRoute(harness, route);
        expect(res.status, `${route.method} ${route.path}`).toBe(404);
        const body = await res.json() as { error?: string };
        const pathname = route.path.split('?')[0];
        expect(body.error, `${route.method} ${route.path}`).toBe(`Unknown route: ${route.method} ${pathname}`);
      }
    } finally {
      await harness.close();
    }
  });
});
