import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { API_ROUTES, buildPath } from '@eforge-build/client';
import { buildPlansResponse } from '../projections/plans.js';
import { startControlRouteHarness, type ControlRouteHarness } from './routes-control-harness.js';

let harness: ControlRouteHarness | undefined;
afterEach(async () => { await harness?.close(); harness = undefined; });

const timestamp = '2026-01-01T00:00:00.000Z';

describe('run detail route acceptance coverage', () => {
  it('serves plans through the shared plans projection and resolves run ids to sessions', async () => {
    harness = await startControlRouteHarness();
    await mkdir(join(harness.cwd, 'eforge', 'plans', 'set'), { recursive: true });
    await writeFile(join(harness.cwd, 'eforge', 'plans', 'set', 'orchestration.yaml'), [
      'plans:',
      '  - id: plan-1',
      '    build: [implement, test-cycle]',
      '    review:',
      '      strategy: parallel',
      '      perspectives: [code]',
      '      maxRounds: 1',
      '      evaluatorStrictness: standard',
      '',
    ].join('\n'));
    harness.db.insertRun({ id: 'run-1', sessionId: 'session-1', planSet: 'set', command: 'compile', status: 'completed', startedAt: timestamp, cwd: harness.cwd });
    harness.db.insertEvent({
      runId: 'run-1',
      type: 'planning:complete',
      data: JSON.stringify({ type: 'planning:complete', timestamp, plans: [{ id: 'plan-1', name: 'Plan 1', body: '# Plan 1', dependsOn: [] }] }),
      timestamp,
    });

    const res = await harness.get(buildPath(API_ROUTES.plans, { runId: 'run-1' }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(await buildPlansResponse({ db: harness.db, sessionId: 'session-1', planOutputDir: harness.context.planOutputDir }));
  });

  it('supports both bulk and single-file diff projection responses', async () => {
    harness = await startControlRouteHarness();
    harness.db.insertRun({ id: 'run-1', sessionId: 'session-1', planSet: 'set', command: 'build', status: 'completed', startedAt: timestamp, cwd: harness.cwd });
    harness.db.insertFileDiffs('run-1', 'plan-1', [{ path: 'a.ts', diff: 'diff --git a/a.ts b/a.ts' }], timestamp);

    const bulk = await harness.get(buildPath(API_ROUTES.diff, { sessionId: 'run-1', planId: 'plan-1' }));
    expect(bulk.status).toBe(200);
    expect(await bulk.json()).toEqual({ files: [{ path: 'a.ts', diff: 'diff --git a/a.ts b/a.ts' }] });

    const single = await harness.get(`${buildPath(API_ROUTES.diff, { sessionId: 'run-1', planId: 'plan-1' })}?file=a.ts`);
    expect(single.status).toBe(200);
    expect(await single.json()).toEqual({ diff: 'diff --git a/a.ts b/a.ts' });
  });
});
