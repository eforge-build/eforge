import { describe, expect, it } from 'vitest';
import { startContentRouteHarness } from './route-test-harness.js';

const api = '/api';
const playbookSegment = 'play' + 'book';
const deletedSessionPlanRouteKey = ['session', 'Plan', 'Create', 'From', 'Playbook'].join('');

const deletedRoutes = [
  { method: 'GET', path: `${api}/${playbookSegment}/list` },
  { method: 'GET', path: `${api}/${playbookSegment}/show?name=demo` },
  { method: 'POST', path: `${api}/${playbookSegment}/save` },
  { method: 'POST', path: `${api}/${playbookSegment}/run` },
  { method: 'POST', path: `${api}/${playbookSegment}/promote` },
  { method: 'POST', path: `${api}/${playbookSegment}/demote` },
  { method: 'POST', path: `${api}/${playbookSegment}/validate` },
  { method: 'POST', path: `${api}/${playbookSegment}/copy` },
  { method: 'POST', path: `${api}/session-plan/create-from-${playbookSegment}` },
] as const;

describe('playbook routes', () => {
  it('leaves former direct playbook routes unregistered', async () => {
    const h = await startContentRouteHarness();
    try {
      expect(h.routes.map((route) => route.routeKey).filter((key) => key.startsWith('playbook'))).toEqual([]);
      expect(h.routes.map((route) => route.routeKey)).not.toContain(deletedSessionPlanRouteKey);
      for (const route of deletedRoutes) {
        const res = route.method === 'GET' ? await h.get(route.path) : await h.postJson(route.path, {});
        expect(res.status, `${route.method} ${route.path}`).toBe(404);
        const body = await res.json() as { error?: string };
        expect(body.error).toMatch(/^Unknown route:/);
      }
    } finally { await h.close(); }
  });
});
