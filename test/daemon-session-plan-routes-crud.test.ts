import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, writeFile, readFile, rm, access, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { useTempDir } from './test-tmpdir.js';
import { openDatabase } from '@eforge-build/monitor/db';
import { startServer, type WorkerTracker, type MonitorServer } from '@eforge-build/monitor/server';
import { API_ROUTES } from '@eforge-build/client';


import { setupProject, postJson as post, makeSessionPlanRaw, writeSessionPlanFile, makeLegacySessionPlanRaw, makeSessionPlanWithAc, createProfile } from './daemon-session-plan-routes-helpers.js';
const makeTempDir = useTempDir('eforge-session-plan-routes-');

let server: MonitorServer | undefined;

afterEach(async () => {
  await server?.stop();
  server = undefined;
});

// --- eforge:region daemon-session-plan-routes-crud-suite ---
describe('GET /api/session-plan/list', () => {
  it('returns empty list when no session plans exist', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);

    const db = openDatabase(resolve(tmpDir, 'monitor.db'));
    server = await startServer(db, 0, { strictPort: true, cwd: tmpDir });

    const res = await fetch(`http://localhost:${server.port}${API_ROUTES.sessionPlanList}`);
    expect(res.status).toBe(200);

    const data = await res.json() as { plans: unknown[] };
    expect(Array.isArray(data.plans)).toBe(true);
    expect(data.plans).toHaveLength(0);
  });

  it('returns active session plans with readiness summary', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);
    await writeSessionPlanFile(tmpDir, '2026-01-01-add-feature', makeSessionPlanRaw({ session: '2026-01-01-add-feature', topic: 'Add Feature' }));

    const db = openDatabase(resolve(tmpDir, 'monitor.db'));
    server = await startServer(db, 0, { strictPort: true, cwd: tmpDir });

    const res = await fetch(`http://localhost:${server.port}${API_ROUTES.sessionPlanList}`);
    expect(res.status).toBe(200);

    const data = await res.json() as {
      plans: Array<{ session: string; topic: string; status: string; path: string; ready: boolean; missingDimensions: string[] }>;
    };
    expect(data.plans).toHaveLength(1);
    expect(data.plans[0].session).toBe('2026-01-01-add-feature');
    expect(data.plans[0].topic).toBe('Add Feature');
    expect(data.plans[0].status).toBe('planning');
    expect(typeof data.plans[0].ready).toBe('boolean');
    expect(Array.isArray(data.plans[0].missingDimensions)).toBe(true);
  });

  it('excludes plans with status submitted or abandoned, includes ready', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);
    await writeSessionPlanFile(tmpDir, '2026-01-01-submitted', makeSessionPlanRaw({ session: '2026-01-01-submitted', status: 'submitted' }));
    await writeSessionPlanFile(tmpDir, '2026-01-02-abandoned', makeSessionPlanRaw({ session: '2026-01-02-abandoned', status: 'abandoned' }));
    await writeSessionPlanFile(tmpDir, '2026-01-03-active', makeSessionPlanRaw({ session: '2026-01-03-active', status: 'planning' }));
    await writeSessionPlanFile(tmpDir, '2026-01-04-ready', makeSessionPlanRaw({ session: '2026-01-04-ready', status: 'ready' }));

    const db = openDatabase(resolve(tmpDir, 'monitor.db'));
    server = await startServer(db, 0, { strictPort: true, cwd: tmpDir });

    const res = await fetch(`http://localhost:${server.port}${API_ROUTES.sessionPlanList}`);
    expect(res.status).toBe(200);

    const data = await res.json() as { plans: Array<{ session: string }> };
    const sessions = data.plans.map((p) => p.session);
    expect(sessions).toContain('2026-01-03-active');
    expect(sessions).toContain('2026-01-04-ready');
    expect(sessions).not.toContain('2026-01-01-submitted');
    expect(sessions).not.toContain('2026-01-02-abandoned');
  });

  it('includeSubmitted=true includes planning, ready, and submitted, excludes abandoned; returns eforge_session', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);
    await writeSessionPlanFile(tmpDir, '2026-01-01-planning', makeSessionPlanRaw({ session: '2026-01-01-planning', status: 'planning' }));
    await writeSessionPlanFile(tmpDir, '2026-01-02-ready', makeSessionPlanRaw({ session: '2026-01-02-ready', status: 'ready' }));
    await writeSessionPlanFile(tmpDir, '2026-01-03-submitted', makeSessionPlanRaw({ session: '2026-01-03-submitted', status: 'submitted', eforgeSession: 'run-xyz-456' }));
    await writeSessionPlanFile(tmpDir, '2026-01-04-abandoned', makeSessionPlanRaw({ session: '2026-01-04-abandoned', status: 'abandoned' }));
    const db = openDatabase(resolve(tmpDir, 'monitor.db'));
    server = await startServer(db, 0, { strictPort: true, cwd: tmpDir });
    const res = await fetch(`http://localhost:${server.port}${API_ROUTES.sessionPlanList}?includeSubmitted=true`);
    expect(res.status).toBe(200);
    const data = await res.json() as { plans: Array<{ session: string; eforge_session?: string }> };
    const sessions = data.plans.map((p) => p.session);
    expect(sessions).toContain('2026-01-01-planning');
    expect(sessions).toContain('2026-01-02-ready');
    expect(sessions).toContain('2026-01-03-submitted');
    expect(sessions).not.toContain('2026-01-04-abandoned');
    expect(data.plans.find((p) => p.session === '2026-01-03-submitted')?.eforge_session).toBe('run-xyz-456');
  });

  it('includeSubmitted=1 also includes submitted plans and excludes abandoned', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);
    await writeSessionPlanFile(tmpDir, '2026-01-01-planning', makeSessionPlanRaw({ session: '2026-01-01-planning', status: 'planning' }));
    await writeSessionPlanFile(tmpDir, '2026-01-02-submitted', makeSessionPlanRaw({ session: '2026-01-02-submitted', status: 'submitted' }));
    await writeSessionPlanFile(tmpDir, '2026-01-03-abandoned', makeSessionPlanRaw({ session: '2026-01-03-abandoned', status: 'abandoned' }));
    const db = openDatabase(resolve(tmpDir, 'monitor.db'));
    server = await startServer(db, 0, { strictPort: true, cwd: tmpDir });
    const res = await fetch(`http://localhost:${server.port}${API_ROUTES.sessionPlanList}?includeSubmitted=1`);
    expect(res.status).toBe(200);
    const data = await res.json() as { plans: Array<{ session: string }> };
    const sessions = data.plans.map((p) => p.session);
    expect(sessions).toContain('2026-01-01-planning');
    expect(sessions).toContain('2026-01-02-submitted');
    expect(sessions).not.toContain('2026-01-03-abandoned');
  });
});

// ---------------------------------------------------------------------------
// Route: GET /api/session-plan/show
// ---------------------------------------------------------------------------


describe('GET /api/session-plan/show', () => {
  it('returns 400 when session param is missing', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);

    const db = openDatabase(resolve(tmpDir, 'monitor.db'));
    server = await startServer(db, 0, { strictPort: true, cwd: tmpDir });

    const res = await fetch(`http://localhost:${server.port}${API_ROUTES.sessionPlanShow}`);
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid session id format', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);

    const db = openDatabase(resolve(tmpDir, 'monitor.db'));
    server = await startServer(db, 0, { strictPort: true, cwd: tmpDir });

    const res = await fetch(`http://localhost:${server.port}${API_ROUTES.sessionPlanShow}?session=../escape`);
    expect(res.status).toBe(400);
  });

  it('returns 404 when session plan does not exist', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);

    const db = openDatabase(resolve(tmpDir, 'monitor.db'));
    server = await startServer(db, 0, { strictPort: true, cwd: tmpDir });

    const res = await fetch(`http://localhost:${server.port}${API_ROUTES.sessionPlanShow}?session=2026-01-01-nonexistent`);
    expect(res.status).toBe(404);
  });

  it('returns frontmatter, body, and readiness detail for existing plan', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);
    await writeSessionPlanFile(tmpDir, '2026-01-01-add-feature', makeSessionPlanRaw({ session: '2026-01-01-add-feature', topic: 'Add Feature' }));

    const db = openDatabase(resolve(tmpDir, 'monitor.db'));
    server = await startServer(db, 0, { strictPort: true, cwd: tmpDir });

    const res = await fetch(`http://localhost:${server.port}${API_ROUTES.sessionPlanShow}?session=2026-01-01-add-feature`);
    expect(res.status).toBe(200);

    const data = await res.json() as {
      plan: { session: string; topic: string; body: string };
      readiness: { ready: boolean; missingDimensions: string[]; coveredDimensions: string[]; skippedDimensions: string[] };
      path: string;
    };
    expect(data.plan.session).toBe('2026-01-01-add-feature');
    expect(data.plan.topic).toBe('Add Feature');
    expect(typeof data.plan.body).toBe('string');
    expect(typeof data.readiness.ready).toBe('boolean');
    expect(Array.isArray(data.readiness.missingDimensions)).toBe(true);
    expect(Array.isArray(data.readiness.coveredDimensions)).toBe(true);
    expect(Array.isArray(data.readiness.skippedDimensions)).toBe(true);
    expect(typeof data.path).toBe('string');
    expect(data.path.endsWith('.eforge/session-plans/2026-01-01-add-feature.md')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Route: POST /api/session-plan/create
// ---------------------------------------------------------------------------


describe('POST /api/session-plan/create', () => {
  it('returns 400 when session field is missing', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);

    const db = openDatabase(resolve(tmpDir, 'monitor.db'));
    server = await startServer(db, 0, { strictPort: true, cwd: tmpDir });

    const res = await post(`http://localhost:${server.port}${API_ROUTES.sessionPlanCreate}`, { topic: 'My Feature' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when topic field is missing', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);

    const db = openDatabase(resolve(tmpDir, 'monitor.db'));
    server = await startServer(db, 0, { strictPort: true, cwd: tmpDir });

    const res = await post(`http://localhost:${server.port}${API_ROUTES.sessionPlanCreate}`, { session: '2026-01-01-add-feature' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid session id format', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);

    const db = openDatabase(resolve(tmpDir, 'monitor.db'));
    server = await startServer(db, 0, { strictPort: true, cwd: tmpDir });

    const res = await post(`http://localhost:${server.port}${API_ROUTES.sessionPlanCreate}`, {
      session: '../escape',
      topic: 'Escape',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when agent_profile is not a string', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);

    const db = openDatabase(resolve(tmpDir, 'monitor.db'));
    server = await startServer(db, 0, { strictPort: true, cwd: tmpDir });

    const res = await post(`http://localhost:${server.port}${API_ROUTES.sessionPlanCreate}`, {
      session: '2026-01-01-profiled-plan',
      topic: 'Profiled Plan',
      agent_profile: 42,
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('agent_profile');
  });

  it('creates a session plan file and returns session + path', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);

    const db = openDatabase(resolve(tmpDir, 'monitor.db'));
    server = await startServer(db, 0, { strictPort: true, cwd: tmpDir });

    const res = await post(`http://localhost:${server.port}${API_ROUTES.sessionPlanCreate}`, {
      session: '2026-01-01-add-feature',
      topic: 'Add Feature',
    });
    expect(res.status).toBe(200);

    const data = await res.json() as { session: string; path: string };
    expect(data.session).toBe('2026-01-01-add-feature');
    expect(data.path).toContain('.eforge/session-plans/2026-01-01-add-feature.md');

    // File must exist on disk
    const content = await readFile(data.path, 'utf-8');
    expect(content).toContain('session: 2026-01-01-add-feature');
    expect(content).toContain('topic: Add Feature');
  });

  it('writes agent_profile without validating profile existence at draft creation time', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);

    const db = openDatabase(resolve(tmpDir, 'monitor.db'));
    server = await startServer(db, 0, { strictPort: true, cwd: tmpDir });

    const res = await post(`http://localhost:${server.port}${API_ROUTES.sessionPlanCreate}`, {
      session: '2026-01-01-profiled-plan',
      topic: 'Profiled Plan',
      agent_profile: 'missing-profile',
    });
    expect(res.status).toBe(200);

    const data = await res.json() as { session: string; path: string };
    expect(data.session).toBe('2026-01-01-profiled-plan');
    const content = await readFile(data.path, 'utf-8');
    expect(content).toContain('agent_profile: missing-profile');

    const showRes = await fetch(`http://localhost:${server.port}${API_ROUTES.sessionPlanShow}?session=2026-01-01-profiled-plan`);
    expect(showRes.status).toBe(200);
    const showData = await showRes.json() as { plan: { agent_profile?: string } };
    expect(showData.plan.agent_profile).toBe('missing-profile');
  });
});

// ---------------------------------------------------------------------------
// Route: POST /api/session-plan/set-section
// ---------------------------------------------------------------------------


describe('POST /api/session-plan/set-section', () => {
  it('updates a section and returns readiness detail', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);
    await writeSessionPlanFile(tmpDir, '2026-01-01-add-feature', makeSessionPlanRaw({ session: '2026-01-01-add-feature' }));

    const db = openDatabase(resolve(tmpDir, 'monitor.db'));
    server = await startServer(db, 0, { strictPort: true, cwd: tmpDir });

    const res = await post(`http://localhost:${server.port}${API_ROUTES.sessionPlanSetSection}`, {
      session: '2026-01-01-add-feature',
      dimension: 'scope',
      content: 'Implement the dark mode toggle.',
    });
    expect(res.status).toBe(200);

    const data = await res.json() as { session: string; readiness: { coveredDimensions: string[] } };
    expect(data.session).toBe('2026-01-01-add-feature');
    expect(data.readiness.coveredDimensions).toContain('scope');

    // File must be updated on disk
    const filePath = resolve(tmpDir, '.eforge', 'session-plans', '2026-01-01-add-feature.md');
    const content = await readFile(filePath, 'utf-8');
    expect(content).toContain('Implement the dark mode toggle.');
  });

  it('returns 400 for invalid session id', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);

    const db = openDatabase(resolve(tmpDir, 'monitor.db'));
    server = await startServer(db, 0, { strictPort: true, cwd: tmpDir });

    const res = await post(`http://localhost:${server.port}${API_ROUTES.sessionPlanSetSection}`, {
      session: '../escape',
      dimension: 'scope',
      content: 'Some content',
    });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Route: POST /api/session-plan/skip-dimension
// ---------------------------------------------------------------------------


describe('POST /api/session-plan/skip-dimension', () => {
  it('adds a skipped dimension entry and returns readiness', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);
    await writeSessionPlanFile(tmpDir, '2026-01-01-add-feature', makeSessionPlanRaw({
      session: '2026-01-01-add-feature',
      requiredDimensions: ['scope', 'acceptance-criteria'],
    }));

    const db = openDatabase(resolve(tmpDir, 'monitor.db'));
    server = await startServer(db, 0, { strictPort: true, cwd: tmpDir });

    const res = await post(`http://localhost:${server.port}${API_ROUTES.sessionPlanSkipDimension}`, {
      session: '2026-01-01-add-feature',
      dimension: 'scope',
      reason: 'Scope is well-understood from existing design docs.',
    });
    expect(res.status).toBe(200);

    const data = await res.json() as { session: string; readiness: { skippedDimensions: string[] } };
    expect(data.session).toBe('2026-01-01-add-feature');
    expect(data.readiness.skippedDimensions).toContain('scope');

    // File must be updated
    const filePath = resolve(tmpDir, '.eforge', 'session-plans', '2026-01-01-add-feature.md');
    const content = await readFile(filePath, 'utf-8');
    expect(content).toContain('Scope is well-understood');
  });

  it('returns 400 for invalid session id', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);

    const db = openDatabase(resolve(tmpDir, 'monitor.db'));
    server = await startServer(db, 0, { strictPort: true, cwd: tmpDir });

    const res = await post(`http://localhost:${server.port}${API_ROUTES.sessionPlanSkipDimension}`, {
      session: '../escape',
      dimension: 'scope',
      reason: 'N/A',
    });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Route: POST /api/session-plan/set-status
// ---------------------------------------------------------------------------


describe('POST /api/session-plan/set-status', () => {
  it('sets status to ready', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);
    await writeSessionPlanFile(tmpDir, '2026-01-01-add-feature', makeSessionPlanRaw({ session: '2026-01-01-add-feature' }));

    const db = openDatabase(resolve(tmpDir, 'monitor.db'));
    server = await startServer(db, 0, { strictPort: true, cwd: tmpDir });

    const res = await post(`http://localhost:${server.port}${API_ROUTES.sessionPlanSetStatus}`, {
      session: '2026-01-01-add-feature',
      status: 'ready',
    });
    expect(res.status).toBe(200);

    const filePath = resolve(tmpDir, '.eforge', 'session-plans', '2026-01-01-add-feature.md');
    const content = await readFile(filePath, 'utf-8');
    expect(content).toContain('status: ready');
  });

  it('returns 400 when status is submitted but eforge_session is missing', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);
    await writeSessionPlanFile(tmpDir, '2026-01-01-add-feature', makeSessionPlanRaw({ session: '2026-01-01-add-feature' }));

    const db = openDatabase(resolve(tmpDir, 'monitor.db'));
    server = await startServer(db, 0, { strictPort: true, cwd: tmpDir });

    const res = await post(`http://localhost:${server.port}${API_ROUTES.sessionPlanSetStatus}`, {
      session: '2026-01-01-add-feature',
      status: 'submitted',
    });
    expect(res.status).toBe(400);
  });

  it('sets status to submitted with eforge_session', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);
    await writeSessionPlanFile(tmpDir, '2026-01-01-add-feature', makeSessionPlanRaw({
      session: '2026-01-01-add-feature',
    }));

    const db = openDatabase(resolve(tmpDir, 'monitor.db'));
    server = await startServer(db, 0, { strictPort: true, cwd: tmpDir });

    const res = await post(`http://localhost:${server.port}${API_ROUTES.sessionPlanSetStatus}`, {
      session: '2026-01-01-add-feature',
      status: 'submitted',
      eforge_session: 'abc-123',
    });
    expect(res.status).toBe(200);

    const filePath = resolve(tmpDir, '.eforge', 'session-plans', '2026-01-01-add-feature.md');
    const content = await readFile(filePath, 'utf-8');
    expect(content).toContain('status: submitted');
    expect(content).toContain('eforge_session: abc-123');
  });

  it('returns 400 for invalid session id', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);

    const db = openDatabase(resolve(tmpDir, 'monitor.db'));
    server = await startServer(db, 0, { strictPort: true, cwd: tmpDir });

    const res = await post(`http://localhost:${server.port}${API_ROUTES.sessionPlanSetStatus}`, {
      session: '../escape',
      status: 'ready',
    });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Route: POST /api/session-plan/select-dimensions
// ---------------------------------------------------------------------------

// --- eforge:endregion daemon-session-plan-routes-crud-suite ---
