import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, writeFile, readFile, rm, access, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { useTempDir } from './test-tmpdir.js';
import { openDatabase } from '@eforge-build/monitor/db';
import { startServer, type WorkerTracker, type MonitorServer } from '@eforge-build/monitor/server';
import { API_ROUTES } from '@eforge-build/client';


import { setupProject, postJson as post, validPlanningPlaybookRaw, validAutonomousPlaybookRaw } from './daemon-session-plan-routes-helpers.js';
const makeTempDir = useTempDir('eforge-session-plan-routes-');

let server: MonitorServer | undefined;

afterEach(async () => {
  await server?.stop();
  server = undefined;
});

describe('POST /api/session-plan/create-from-playbook', () => {
  it('seeds a session plan from a planning-mode playbook and returns session and path', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);

    const configDir = resolve(tmpDir, 'eforge');
    const playbooksDir = resolve(configDir, 'playbooks');
    await mkdir(playbooksDir, { recursive: true });
    await writeFile(resolve(playbooksDir, 'my-planning.md'), validPlanningPlaybookRaw(), 'utf-8');

    const db = openDatabase(resolve(tmpDir, 'monitor.db'));
    server = await startServer(db, 0, { strictPort: true, cwd: tmpDir });

    const res = await post(`http://localhost:${server.port}${API_ROUTES.sessionPlanCreateFromPlaybook}`, {
      playbook_name: 'my-planning',
    });
    expect(res.status).toBe(200);

    const data = await res.json() as { session: string; path: string };
    expect(typeof data.session).toBe('string');
    expect(data.session.length).toBeGreaterThan(0);
    expect(typeof data.path).toBe('string');

    // Verify the session plan file exists and contains seeded playbook content.
    await expect(access(data.path)).resolves.toBeUndefined();
    const planContent = await readFile(data.path, 'utf-8');
    expect(planContent).toContain('seeded_from_playbook:');
    expect(planContent).toContain('my-planning');
    expect(planContent).toContain('Plan with an agent');
    expect(planContent).toContain('## Goal');
    expect(planContent).toContain('Investigate and plan the feature.');
    expect(planContent).toContain('## Acceptance criteria');
    expect(planContent).toContain('- Plan identifies implementation steps.');
  });

  it('writes agent_profile inherited from the planning playbook profile without validating it', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);

    const configDir = resolve(tmpDir, 'eforge');
    const playbooksDir = resolve(configDir, 'playbooks');
    await mkdir(playbooksDir, { recursive: true });
    await writeFile(resolve(playbooksDir, 'my-planning.md'), validPlanningPlaybookRaw({ profile: 'missing-profile' }), 'utf-8');

    const db = openDatabase(resolve(tmpDir, 'monitor.db'));
    server = await startServer(db, 0, { strictPort: true, cwd: tmpDir });

    const res = await post(`http://localhost:${server.port}${API_ROUTES.sessionPlanCreateFromPlaybook}`, {
      playbook_name: 'my-planning',
    });
    expect(res.status).toBe(200);

    const data = await res.json() as { session: string; path: string };
    expect(typeof data.session).toBe('string');
    const planContent = await readFile(data.path, 'utf-8');
    expect(planContent).toContain('profile: null');
    expect(planContent).toContain('agent_profile: missing-profile');
  });

  it('returns 400 when the named playbook is autonomous (must use playbook/run instead)', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);

    const configDir = resolve(tmpDir, 'eforge');
    const playbooksDir = resolve(configDir, 'playbooks');
    await mkdir(playbooksDir, { recursive: true });
    await writeFile(resolve(playbooksDir, 'my-auto.md'), validAutonomousPlaybookRaw(), 'utf-8');

    const db = openDatabase(resolve(tmpDir, 'monitor.db'));
    server = await startServer(db, 0, { strictPort: true, cwd: tmpDir });

    const res = await post(`http://localhost:${server.port}${API_ROUTES.sessionPlanCreateFromPlaybook}`, {
      playbook_name: 'my-auto',
    });
    expect(res.status).toBe(400);

    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/playbook\/run/i);
  });

  it('returns 409 when the target session id already exists', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);

    const configDir = resolve(tmpDir, 'eforge');
    const playbooksDir = resolve(configDir, 'playbooks');
    await mkdir(playbooksDir, { recursive: true });
    await writeFile(resolve(playbooksDir, 'my-planning.md'), validPlanningPlaybookRaw(), 'utf-8');

    const db = openDatabase(resolve(tmpDir, 'monitor.db'));
    server = await startServer(db, 0, { strictPort: true, cwd: tmpDir });

    // First call creates the session plan
    const first = await post(`http://localhost:${server.port}${API_ROUTES.sessionPlanCreateFromPlaybook}`, {
      playbook_name: 'my-planning',
    });
    expect(first.status).toBe(200);
    const { session } = await first.json() as { session: string; path: string };

    // Second call with the same session id should return 409
    const second = await post(`http://localhost:${server.port}${API_ROUTES.sessionPlanCreateFromPlaybook}`, {
      playbook_name: 'my-planning',
      session,
    });
    expect(second.status).toBe(409);
  });

  it('returns 400 for path traversal in session parameter', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);

    const configDir = resolve(tmpDir, 'eforge');
    const playbooksDir = resolve(configDir, 'playbooks');
    await mkdir(playbooksDir, { recursive: true });
    await writeFile(resolve(playbooksDir, 'my-planning.md'), validPlanningPlaybookRaw(), 'utf-8');

    const db = openDatabase(resolve(tmpDir, 'monitor.db'));
    server = await startServer(db, 0, { strictPort: true, cwd: tmpDir });

    const res = await post(`http://localhost:${server.port}${API_ROUTES.sessionPlanCreateFromPlaybook}`, {
      playbook_name: 'my-planning',
      session: '../escape',
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 when the named playbook does not exist', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);

    const db = openDatabase(resolve(tmpDir, 'monitor.db'));
    server = await startServer(db, 0, { strictPort: true, cwd: tmpDir });

    const res = await post(`http://localhost:${server.port}${API_ROUTES.sessionPlanCreateFromPlaybook}`, {
      playbook_name: 'nonexistent',
    });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// AC quality gate — readiness route diagnostics and set-status rejection
// ---------------------------------------------------------------------------

/** Build a session plan raw with AC content in the body. */
function makeSessionPlanWithAc(session: string, acLines: string[]): string {
  const acContent = acLines.join('\n');
  return [
    '---',
    `session: ${session}`,
    'topic: "Test Plan"',
    'status: planning',
    'planning_type: feature',
    'planning_depth: focused',
    'required_dimensions:',
    '  - scope',
    '  - acceptance-criteria',
    'optional_dimensions: []',
    'skipped_dimensions: []',
    'open_questions: []',
    'profile: null',
    '---',
    '',
    '# Test Plan',
    '',
    '## Scope',
    '',
    'Real scope content for the test.',
    '',
    '## Acceptance Criteria',
    '',
    acContent,
    '',
  ].join('\n');
}

