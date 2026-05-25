/**
 * Integration tests for session-plan HTTP routes and enqueue auto-submit.
 *
 * Uses the in-process daemon harness (startServer) following the pattern
 * established in daemon-recovery.test.ts and playbook-api.test.ts.
 *
 * Covers:
 * - GET /api/session-plan/list
 * - GET /api/session-plan/show
 * - POST /api/session-plan/create
 * - POST /api/session-plan/set-section
 * - POST /api/session-plan/skip-dimension
 * - POST /api/session-plan/set-status
 * - POST /api/session-plan/select-dimensions
 * - GET /api/session-plan/readiness
 * - POST /api/session-plan/migrate-legacy
 * - Path-traversal rejection for all routes accepting a session param
 * - POST /api/enqueue auto-submit behavior for session-plan sources
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, writeFile, readFile, rm, access, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { useTempDir } from './test-tmpdir.js';
import { openDatabase } from '@eforge-build/monitor/db';
import { startServer, type WorkerTracker, type MonitorServer } from '@eforge-build/monitor/server';
import { API_ROUTES } from '@eforge-build/client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeTempDir = useTempDir('eforge-session-plan-routes-');

let server: MonitorServer | undefined;

afterEach(async () => {
  await server?.stop();
  server = undefined;
});

/** Set up a minimal eforge project with git. */
async function setupProject(tmpDir: string): Promise<void> {
  const gitOpts = { cwd: tmpDir };
  execFileSync('git', ['init', '-b', 'main'], gitOpts);
  execFileSync('git', ['config', 'user.email', 'test@example.com'], gitOpts);
  execFileSync('git', ['config', 'user.name', 'Test'], gitOpts);
  execFileSync('git', ['commit', '--allow-empty', '-m', 'chore: initial commit'], gitOpts);

  // Create eforge config directory
  const configDir = resolve(tmpDir, 'eforge');
  await mkdir(configDir, { recursive: true });
  await writeFile(resolve(configDir, 'config.yaml'), '', 'utf-8');
}

/** Build a valid session plan markdown string. */
function makeSessionPlanRaw(opts: {
  session?: string;
  topic?: string;
  status?: string;
  requiredDimensions?: string[];
  agentProfile?: string;
} = {}): string {
  const session = opts.session ?? '2026-01-01-add-feature';
  const topic = opts.topic ?? 'Add Feature';
  const status = opts.status ?? 'planning';
  const dims = opts.requiredDimensions ?? ['scope', 'acceptance-criteria'];
  const requiredDimsYaml =
    dims.length === 0 ? 'required_dimensions: []' : [`required_dimensions:`, ...dims.map((d) => `  - ${d}`)].join('\n');
  return [
    '---',
    `session: ${session}`,
    `topic: "${topic}"`,
    `status: ${status}`,
    'planning_type: feature',
    'planning_depth: focused',
    requiredDimsYaml,
    'optional_dimensions: []',
    'skipped_dimensions: []',
    'open_questions: []',
    'profile: null',
    ...(opts.agentProfile ? [`agent_profile: ${opts.agentProfile}`] : []),
    '---',
    '',
    `# ${topic}`,
    '',
  ].join('\n');
}

/** Build a session plan string with the legacy boolean dimensions shape. */
function makeLegacySessionPlanRaw(session = '2026-01-01-legacy-plan'): string {
  return [
    '---',
    `session: ${session}`,
    'topic: "Legacy Plan"',
    'status: planning',
    'planning_type: unknown',
    'planning_depth: focused',
    'required_dimensions: []',
    'optional_dimensions: []',
    'skipped_dimensions: []',
    'open_questions: []',
    'profile: null',
    'dimensions:',
    '  scope: true',
    '  code-impact: false',
    '  acceptance-criteria: true',
    '---',
    '',
    '# Legacy Plan',
    '',
  ].join('\n');
}

/** Write a session plan file to the project's .eforge/session-plans/ directory. */
async function writeSessionPlanFile(tmpDir: string, session: string, content: string): Promise<string> {
  const dir = resolve(tmpDir, '.eforge', 'session-plans');
  await mkdir(dir, { recursive: true });
  const filePath = resolve(dir, `${session}.md`);
  await writeFile(filePath, content, 'utf-8');
  return filePath;
}

/** POST helper that sends JSON. */
async function post(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Stub WorkerTracker that records calls and returns predictable session IDs. */
function makeStubTracker(): { tracker: WorkerTracker; calls: Array<{ command: string; args: string[]; sessionId: string }> } {
  const calls: Array<{ command: string; args: string[]; sessionId: string }> = [];
  let counter = 0;

  const tracker: WorkerTracker = {
    spawnWorker(command: string, args: string[]): { sessionId: string; pid: number } {
      const sessionId = `stub-session-${++counter}`;
      calls.push({ command, args, sessionId });
      return { sessionId, pid: 10000 + counter };
    },
    cancelWorker(): boolean {
      return false;
    },
  };

  return { tracker, calls };
}

/** Create a minimal profile file in the project config profiles directory. */
async function createProfile(tmpDir: string, name: string): Promise<void> {
  const profilesDir = resolve(tmpDir, 'eforge', 'profiles');
  await mkdir(profilesDir, { recursive: true });
  await writeFile(resolve(profilesDir, `${name}.yaml`), '# test profile\n', 'utf-8');
}

// ---------------------------------------------------------------------------
// Route: GET /api/session-plan/list
// ---------------------------------------------------------------------------

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
    await writeSessionPlanFile(tmpDir, '2026-01-01-add-feature', makeSessionPlanRaw({
      session: '2026-01-01-add-feature',
      topic: 'Add Feature',
    }));

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

  it('excludes plans with status submitted or abandoned', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);
    await writeSessionPlanFile(tmpDir, '2026-01-01-submitted', makeSessionPlanRaw({
      session: '2026-01-01-submitted',
      status: 'submitted',
    }));
    await writeSessionPlanFile(tmpDir, '2026-01-02-abandoned', makeSessionPlanRaw({
      session: '2026-01-02-abandoned',
      status: 'abandoned',
    }));
    await writeSessionPlanFile(tmpDir, '2026-01-03-active', makeSessionPlanRaw({
      session: '2026-01-03-active',
      status: 'planning',
    }));

    const db = openDatabase(resolve(tmpDir, 'monitor.db'));
    server = await startServer(db, 0, { strictPort: true, cwd: tmpDir });

    const res = await fetch(`http://localhost:${server.port}${API_ROUTES.sessionPlanList}`);
    expect(res.status).toBe(200);

    const data = await res.json() as { plans: Array<{ session: string }> };
    expect(data.plans).toHaveLength(1);
    expect(data.plans[0].session).toBe('2026-01-03-active');
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
    await writeSessionPlanFile(tmpDir, '2026-01-01-add-feature', makeSessionPlanRaw({
      session: '2026-01-01-add-feature',
      topic: 'Add Feature',
    }));

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
    await writeSessionPlanFile(tmpDir, '2026-01-01-add-feature', makeSessionPlanRaw({
      session: '2026-01-01-add-feature',
    }));

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
    await writeSessionPlanFile(tmpDir, '2026-01-01-add-feature', makeSessionPlanRaw({
      session: '2026-01-01-add-feature',
    }));

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
    await writeSessionPlanFile(tmpDir, '2026-01-01-add-feature', makeSessionPlanRaw({
      session: '2026-01-01-add-feature',
    }));

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

describe('POST /api/session-plan/select-dimensions', () => {
  it('writes required_dimensions and optional_dimensions and returns readiness', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);
    await writeSessionPlanFile(tmpDir, '2026-01-01-add-feature', makeSessionPlanRaw({
      session: '2026-01-01-add-feature',
      requiredDimensions: [],
    }));

    const db = openDatabase(resolve(tmpDir, 'monitor.db'));
    server = await startServer(db, 0, { strictPort: true, cwd: tmpDir });

    const res = await post(`http://localhost:${server.port}${API_ROUTES.sessionPlanSelectDimensions}`, {
      session: '2026-01-01-add-feature',
      planning_type: 'bugfix',
      planning_depth: 'focused',
    });
    expect(res.status).toBe(200);

    const data = await res.json() as {
      session: string;
      required_dimensions: string[];
      optional_dimensions: string[];
      readiness: { missingDimensions: string[] };
    };
    expect(data.session).toBe('2026-01-01-add-feature');
    expect(Array.isArray(data.required_dimensions)).toBe(true);
    expect(data.required_dimensions.length).toBeGreaterThan(0);
    expect(Array.isArray(data.optional_dimensions)).toBe(true);
  });

  it('returns 400 for invalid session id', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);

    const db = openDatabase(resolve(tmpDir, 'monitor.db'));
    server = await startServer(db, 0, { strictPort: true, cwd: tmpDir });

    const res = await post(`http://localhost:${server.port}${API_ROUTES.sessionPlanSelectDimensions}`, {
      session: '../escape',
    });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Route: GET /api/session-plan/readiness
// ---------------------------------------------------------------------------

describe('GET /api/session-plan/readiness', () => {
  it('returns readiness detail without mutating the file', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);
    const content = makeSessionPlanRaw({
      session: '2026-01-01-add-feature',
      requiredDimensions: ['scope', 'acceptance-criteria'],
    });
    const filePath = await writeSessionPlanFile(tmpDir, '2026-01-01-add-feature', content);

    const db = openDatabase(resolve(tmpDir, 'monitor.db'));
    server = await startServer(db, 0, { strictPort: true, cwd: tmpDir });

    const res = await fetch(
      `http://localhost:${server.port}${API_ROUTES.sessionPlanReadiness}?session=2026-01-01-add-feature`,
    );
    expect(res.status).toBe(200);

    const data = await res.json() as {
      ready: boolean;
      missingDimensions: string[];
      coveredDimensions: string[];
      skippedDimensions: string[];
    };
    expect(typeof data.ready).toBe('boolean');
    expect(Array.isArray(data.missingDimensions)).toBe(true);
    expect(Array.isArray(data.coveredDimensions)).toBe(true);
    expect(Array.isArray(data.skippedDimensions)).toBe(true);

    // File must not have been modified
    const afterContent = await readFile(filePath, 'utf-8');
    expect(afterContent).toBe(content);
  });

  it('returns 400 for missing session param', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);

    const db = openDatabase(resolve(tmpDir, 'monitor.db'));
    server = await startServer(db, 0, { strictPort: true, cwd: tmpDir });

    const res = await fetch(`http://localhost:${server.port}${API_ROUTES.sessionPlanReadiness}`);
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid session id (path traversal attempt)', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);

    const db = openDatabase(resolve(tmpDir, 'monitor.db'));
    server = await startServer(db, 0, { strictPort: true, cwd: tmpDir });

    const res = await fetch(
      `http://localhost:${server.port}${API_ROUTES.sessionPlanReadiness}?session=${encodeURIComponent('../escape')}`,
    );
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Route: POST /api/session-plan/migrate-legacy
// ---------------------------------------------------------------------------

describe('POST /api/session-plan/migrate-legacy', () => {
  it('migrates a legacy boolean-dimensions plan and returns migrated: true', async () => {
    const session = '2026-01-01-legacy-plan';
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);
    await writeSessionPlanFile(tmpDir, session, makeLegacySessionPlanRaw(session));

    const db = openDatabase(resolve(tmpDir, 'monitor.db'));
    server = await startServer(db, 0, { strictPort: true, cwd: tmpDir });

    const res = await post(`http://localhost:${server.port}${API_ROUTES.sessionPlanMigrateLegacy}`, { session });
    expect(res.status).toBe(200);

    const data = await res.json() as { session: string; migrated: boolean };
    expect(data.session).toBe(session);
    expect(data.migrated).toBe(true);

    // File must have been rewritten without legacy dimensions field
    const filePath = resolve(tmpDir, '.eforge', 'session-plans', `${session}.md`);
    const content = await readFile(filePath, 'utf-8');
    expect(content).not.toMatch(/\ndimensions:/);
    expect(content).toContain('required_dimensions:');
  });

  it('returns migrated: false for a plan already on the new schema', async () => {
    const session = '2026-01-01-add-feature';
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);
    const rawContent = makeSessionPlanRaw({ session });
    await writeSessionPlanFile(tmpDir, session, rawContent);

    const db = openDatabase(resolve(tmpDir, 'monitor.db'));
    server = await startServer(db, 0, { strictPort: true, cwd: tmpDir });

    const res = await post(`http://localhost:${server.port}${API_ROUTES.sessionPlanMigrateLegacy}`, { session });
    expect(res.status).toBe(200);

    const data = await res.json() as { migrated: boolean };
    expect(data.migrated).toBe(false);
  });

  it('returns 400 for invalid session id', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);

    const db = openDatabase(resolve(tmpDir, 'monitor.db'));
    server = await startServer(db, 0, { strictPort: true, cwd: tmpDir });

    const res = await post(`http://localhost:${server.port}${API_ROUTES.sessionPlanMigrateLegacy}`, {
      session: '../escape',
    });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Path traversal — all mutating POST routes must reject invalid session ids
// ---------------------------------------------------------------------------

describe('path traversal rejection', () => {
  it('set-section returns 400 for traversal attempt', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);

    const db = openDatabase(resolve(tmpDir, 'monitor.db'));
    server = await startServer(db, 0, { strictPort: true, cwd: tmpDir });

    const res = await post(`http://localhost:${server.port}${API_ROUTES.sessionPlanSetSection}`, {
      session: '../etc/passwd',
      dimension: 'scope',
      content: 'malicious',
    });
    expect(res.status).toBe(400);
  });

  it('skip-dimension returns 400 for traversal attempt', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);

    const db = openDatabase(resolve(tmpDir, 'monitor.db'));
    server = await startServer(db, 0, { strictPort: true, cwd: tmpDir });

    const res = await post(`http://localhost:${server.port}${API_ROUTES.sessionPlanSkipDimension}`, {
      session: '../etc/passwd',
      dimension: 'scope',
      reason: 'test',
    });
    expect(res.status).toBe(400);
  });

  it('select-dimensions returns 400 for traversal attempt', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);

    const db = openDatabase(resolve(tmpDir, 'monitor.db'));
    server = await startServer(db, 0, { strictPort: true, cwd: tmpDir });

    const res = await post(`http://localhost:${server.port}${API_ROUTES.sessionPlanSelectDimensions}`, {
      session: '../etc/passwd',
    });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /api/enqueue — session-plan auto-submit behavior
// ---------------------------------------------------------------------------

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

  it('enqueue still succeeds when session-plan file is removed before the write', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);

    const planSession = '2026-01-01-add-feature';
    const planContent = makeSessionPlanRaw({ session: planSession });
    const filePath = await writeSessionPlanFile(tmpDir, planSession, planContent);

    // Remove the file immediately after writing so the auto-submit write fails.
    await rm(filePath, { force: true });

    const { tracker } = makeStubTracker();
    const db = openDatabase(resolve(tmpDir, 'monitor.db'));
    server = await startServer(db, 0, { strictPort: true, cwd: tmpDir, workerTracker: tracker });

    const sourcePath = `.eforge/session-plans/${planSession}.md`;
    // The daemon tries to stat/readFile the path for prevalidation only — since
    // the file is gone, the stat fails and no prevalidation is attempted. Worker
    // receives the original path as-is. Then auto-submit tries to load the plan
    // — file is gone — logs and continues.
    const res = await post(`http://localhost:${server.port}${API_ROUTES.enqueue}`, {
      source: sourcePath,
    });
    // Response must succeed regardless of the auto-submit failure
    expect(res.status).toBe(200);

    const data = await res.json() as { sessionId: string };
    expect(typeof data.sessionId).toBe('string');
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

    // Verify the session plan file exists and contains seeded_from_playbook
    await expect(access(data.path)).resolves.toBeUndefined();
    const planContent = await readFile(data.path, 'utf-8');
    expect(planContent).toContain('seeded_from_playbook:');
    expect(planContent).toContain('my-planning');
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

describe('GET /api/session-plan/readiness — AC quality diagnostics', () => {
  it('returns acDiagnostics when AC section contains a grouping label', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);
    const session = '2026-01-01-ac-grouping';
    await writeSessionPlanFile(tmpDir, session, makeSessionPlanWithAc(session, ['- Tests cover:']));

    const db = openDatabase(resolve(tmpDir, 'monitor.db'));
    server = await startServer(db, 0, { strictPort: true, cwd: tmpDir });

    const res = await fetch(
      `http://localhost:${server.port}${API_ROUTES.sessionPlanReadiness}?session=${session}`,
    );
    expect(res.status).toBe(200);

    const data = await res.json() as {
      ready: boolean;
      acDiagnostics?: Array<{ kind: string; message: string; suggestion: string }>;
    };
    expect(data.ready).toBe(false);
    expect(Array.isArray(data.acDiagnostics)).toBe(true);
    expect(data.acDiagnostics!.length).toBeGreaterThan(0);
    expect(data.acDiagnostics![0].kind).toBe('grouping-label');
  });

  it('returns ready: true with no acDiagnostics for valid command AC', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);
    const session = '2026-01-01-ac-valid';
    await writeSessionPlanFile(tmpDir, session, makeSessionPlanWithAc(session, ['- `pnpm type-check` exits 0.']));

    const db = openDatabase(resolve(tmpDir, 'monitor.db'));
    server = await startServer(db, 0, { strictPort: true, cwd: tmpDir });

    const res = await fetch(
      `http://localhost:${server.port}${API_ROUTES.sessionPlanReadiness}?session=${session}`,
    );
    expect(res.status).toBe(200);

    const data = await res.json() as {
      ready: boolean;
      acDiagnostics?: unknown;
    };
    expect(data.ready).toBe(true);
    expect(data.acDiagnostics).toBeUndefined();
  });
});

describe('POST /api/session-plan/set-status — AC quality gate', () => {
  it('rejects set-status: ready when AC section contains a grouping label', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);
    const session = '2026-01-01-ac-reject';
    await writeSessionPlanFile(tmpDir, session, makeSessionPlanWithAc(session, ['- Tests cover:']));

    const db = openDatabase(resolve(tmpDir, 'monitor.db'));
    server = await startServer(db, 0, { strictPort: true, cwd: tmpDir });

    const res = await post(`http://localhost:${server.port}${API_ROUTES.sessionPlanSetStatus}`, {
      session,
      status: 'ready',
    });
    expect(res.status).toBe(400);

    const data = await res.json() as { error: string; readiness: { acDiagnostics: unknown[] } };
    expect(data.error).toMatch(/acceptance criteria quality/i);
    expect(Array.isArray(data.readiness.acDiagnostics)).toBe(true);

    // Plan file status must NOT have been changed
    const filePath = resolve(tmpDir, '.eforge', 'session-plans', `${session}.md`);
    const content = await readFile(filePath, 'utf-8');
    expect(content).toContain('status: planning');
    expect(content).not.toContain('status: ready');
  });

  it('accepts set-status: ready when AC section has valid criteria', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);
    const session = '2026-01-01-ac-accept';
    await writeSessionPlanFile(tmpDir, session, makeSessionPlanWithAc(session, ['- `pnpm type-check` exits 0.']));

    const db = openDatabase(resolve(tmpDir, 'monitor.db'));
    server = await startServer(db, 0, { strictPort: true, cwd: tmpDir });

    const res = await post(`http://localhost:${server.port}${API_ROUTES.sessionPlanSetStatus}`, {
      session,
      status: 'ready',
    });
    expect(res.status).toBe(200);

    const filePath = resolve(tmpDir, '.eforge', 'session-plans', `${session}.md`);
    const content = await readFile(filePath, 'utf-8');
    expect(content).toContain('status: ready');
  });
});
