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

// --- eforge:region daemon-session-plan-routes-readiness-suite ---
describe('POST /api/session-plan/select-dimensions', () => {
  it('writes required_dimensions and optional_dimensions and returns readiness', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);
    const filePath = await writeSessionPlanFile(tmpDir, '2026-01-01-add-feature', makeSessionPlanRaw({
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

    const persisted = await readFile(filePath, 'utf-8');
    expect(persisted).toContain('planning_type: bugfix');
    expect(persisted).toContain('planning_depth: focused');
    expect(persisted).toContain('required_dimensions:');
    for (const dimension of data.required_dimensions) {
      expect(persisted).toContain(`  - ${dimension}`);
    }
    expect(persisted).toContain('optional_dimensions: []');
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

  it('returns manual-only acDiagnostics for manual-only AC', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);
    const session = '2026-01-01-ac-manual-only';
    await writeSessionPlanFile(tmpDir, session, makeSessionPlanWithAc(session, ['- Manually verify dashboard rendering in the browser.']));

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
    expect(data.acDiagnostics?.[0].kind).toBe('manual-only');
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
// --- eforge:endregion daemon-session-plan-routes-readiness-suite ---
