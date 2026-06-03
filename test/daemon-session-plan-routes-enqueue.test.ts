import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, writeFile, readFile, rm, access, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { useTempDir } from './test-tmpdir.js';
import { openDatabase } from '@eforge-build/monitor/db';
import { startServer, type WorkerTracker, type MonitorServer } from '@eforge-build/monitor/server';
import { API_ROUTES } from '@eforge-build/client';


import { setupProject, postJson as post, makeSessionPlanRaw, writeSessionPlanFile, makeStubTracker, createProfile } from './daemon-session-plan-routes-helpers.js';
const makeTempDir = useTempDir('eforge-session-plan-routes-');

let server: MonitorServer | undefined;

afterEach(async () => {
  await server?.stop();
  server = undefined;
});

describe('POST /api/enqueue — session-plan auto-submit', () => {
  it('marks session plan as submitted with spawned sessionId after enqueue', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);

    const planSession = '2026-01-01-add-feature';
    const planContent = makeSessionPlanRaw({ session: planSession });
    const filePath = await writeSessionPlanFile(tmpDir, planSession, planContent);

    const { tracker, calls } = makeStubTracker();
    const db = openDatabase(resolve(tmpDir, 'monitor.db'));
    server = await startServer(db, 0, { strictPort: true, cwd: tmpDir, workerTracker: tracker });

    const sourcePath = `.eforge/session-plans/${planSession}.md`;
    const res = await post(`http://localhost:${server.port}${API_ROUTES.enqueue}`, {
      source: sourcePath,
    });
    expect(res.status).toBe(200);

    const data = await res.json() as { sessionId: string };
    expect(typeof data.sessionId).toBe('string');

    // File must have been rewritten with status: submitted and the eforge_session
    const updated = await readFile(filePath, 'utf-8');
    expect(updated).toContain('status: submitted');
    expect(updated).toContain(`eforge_session: ${data.sessionId}`);

    // Worker must receive the original session-plan path, not normalized content.
    // Full preprocessing (including session-plan normalization and enrichers) is
    // done by the enqueue worker via preprocessBuildSource, not the daemon route.
    expect(calls[0]?.args[0]).toBe(sourcePath);
  });

  it('enqueue still succeeds when session-plan source is missing before request handling', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);

    const planSession = '2026-01-01-add-feature';
    const planContent = makeSessionPlanRaw({ session: planSession });
    const filePath = await writeSessionPlanFile(tmpDir, planSession, planContent);

    // Remove the file before the request so this covers missing-source handling.
    await rm(filePath, { force: true });

    const { tracker, calls } = makeStubTracker();
    const db = openDatabase(resolve(tmpDir, 'monitor.db'));
    server = await startServer(db, 0, { strictPort: true, cwd: tmpDir, workerTracker: tracker });

    const sourcePath = `.eforge/session-plans/${planSession}.md`;
    // The daemon tries to stat/readFile the path for prevalidation only — since
    // the file is gone, the stat fails and no prevalidation is attempted. Worker
    // receives the original path as-is.
    const res = await post(`http://localhost:${server.port}${API_ROUTES.enqueue}`, {
      source: sourcePath,
    });
    // Response must succeed and still spawn the worker with the original path.
    expect(res.status).toBe(200);

    const data = await res.json() as { sessionId: string };
    expect(typeof data.sessionId).toBe('string');
    expect(calls).toHaveLength(1);
  });

  it('passes inherited agent_profile to the worker as --profile when no request profile is provided', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);
    await createProfile(tmpDir, 'docs-heavy');

    const planSession = '2026-01-01-profiled-plan';
    await writeSessionPlanFile(tmpDir, planSession, makeSessionPlanRaw({
      session: planSession,
      agentProfile: 'docs-heavy',
    }));

    const { tracker, calls } = makeStubTracker();
    const db = openDatabase(resolve(tmpDir, 'monitor.db'));
    server = await startServer(db, 0, { strictPort: true, cwd: tmpDir, workerTracker: tracker });

    const sourcePath = `.eforge/session-plans/${planSession}.md`;
    const res = await post(`http://localhost:${server.port}${API_ROUTES.enqueue}`, { source: sourcePath });
    expect(res.status).toBe(200);

    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual([sourcePath, '--profile', 'docs-heavy']);
  });

  it('uses explicit request profile instead of inherited agent_profile when both are present', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);
    await createProfile(tmpDir, 'other');

    const planSession = '2026-01-01-profiled-plan';
    await writeSessionPlanFile(tmpDir, planSession, makeSessionPlanRaw({
      session: planSession,
      // Leave the inherited profile undefined in profile scopes so this test fails
      // if the daemon validates inherited agent_profile despite an explicit override.
      agentProfile: 'missing-inherited-profile',
    }));

    const { tracker, calls } = makeStubTracker();
    const db = openDatabase(resolve(tmpDir, 'monitor.db'));
    server = await startServer(db, 0, { strictPort: true, cwd: tmpDir, workerTracker: tracker });

    const sourcePath = `.eforge/session-plans/${planSession}.md`;
    const res = await post(`http://localhost:${server.port}${API_ROUTES.enqueue}`, {
      source: sourcePath,
      profile: 'other',
    });
    expect(res.status).toBe(200);

    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual([sourcePath, '--profile', 'other']);
  });

  it('returns 400 without spawning a worker when inherited agent_profile is missing', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);

    const planSession = '2026-01-01-missing-profile-plan';
    await writeSessionPlanFile(tmpDir, planSession, makeSessionPlanRaw({
      session: planSession,
      agentProfile: 'missing-profile',
    }));

    const { tracker, calls } = makeStubTracker();
    const db = openDatabase(resolve(tmpDir, 'monitor.db'));
    server = await startServer(db, 0, { strictPort: true, cwd: tmpDir, workerTracker: tracker });

    const sourcePath = `.eforge/session-plans/${planSession}.md`;
    const res = await post(`http://localhost:${server.port}${API_ROUTES.enqueue}`, { source: sourcePath });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('missing-profile');
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// POST /api/session-plan/create-from-playbook
// ---------------------------------------------------------------------------

/** Build a valid planning-mode playbook raw string. */
function validPlanningPlaybookRaw(opts: { name?: string; description?: string; profile?: string } = {}): string {
  const name = opts.name ?? 'my-planning';
  const description = opts.description ?? 'Plan the my-planning feature';
  return [
    '---',
    `name: ${name}`,
    `description: ${description}`,
    'scope: project-team',
    'mode: planning',
    ...(opts.profile ? [`profile: ${opts.profile}`] : []),
    '---',
    '',
    '## Goal',
    '',
    'Plan and implement the feature.',
    '',
    '## Acceptance criteria',
    '',
    'Feature works as expected.',
  ].join('\n');
}

/** Build a valid autonomous-mode playbook raw string. */
function validAutonomousPlaybookRaw(opts: { name?: string } = {}): string {
  const name = opts.name ?? 'my-auto';
  return [
    '---',
    `name: ${name}`,
    'description: Autonomous feature implementation',
    'scope: project-team',
    'mode: autonomous',
    '---',
    '',
    '## Goal',
    '',
    'Implement the feature autonomously.',
  ].join('\n');
}

