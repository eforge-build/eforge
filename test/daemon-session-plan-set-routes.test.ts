/**
 * Integration tests for the read-only session plan-set HTTP routes.
 *
 * Uses the in-process daemon harness (startServer) following the pattern in
 * daemon-session-plan-routes.test.ts.
 *
 * Covers:
 * - GET /api/session-plan-set/list (fields, submitted/abandoned filtering)
 * - GET /api/session-plan-set/show (anchor content, no raw child markdown)
 * - GET /api/session-plan-set/validate (missing-anchor diagnostic)
 * - 400 (missing/unsafe planSetId) and 404 (unknown plan set)
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { useTempDir } from './test-tmpdir.js';
import { openDatabase } from '@eforge-build/monitor/db';
import { startServer, type MonitorServer } from '@eforge-build/monitor/server';
import { API_ROUTES } from '@eforge-build/client';

const makeTempDir = useTempDir('eforge-daemon-plan-set-routes-');

let server: MonitorServer | undefined;

afterEach(async () => {
  await server?.stop();
  server = undefined;
});

const CHILD_BODY_SENTINEL = 'SENTINEL_RAW_CHILD_MARKDOWN_BODY';

interface SetupChild {
  id: string;
  file: string;
  dependsOn?: string[];
  content?: string;
}

/** Write a plan-set directory with manifest, optional anchor, and child files. */
async function setupPlanSet(opts: {
  cwd: string;
  planSetId: string;
  manifestId?: string;
  status?: string;
  strategy?: string;
  anchor?: string | null;
  writeAnchor?: boolean;
  children: SetupChild[];
}): Promise<string> {
  const dir = resolve(opts.cwd, '.eforge', 'session-plans', opts.planSetId);
  await mkdir(dir, { recursive: true });

  const anchorName = opts.anchor === null ? undefined : (opts.anchor ?? 'umbrella.md');

  const childrenLines = opts.children
    .map((c) => {
      const dependsOn = c.dependsOn ?? [];
      const dependsYaml =
        dependsOn.length > 0
          ? `    dependsOn:\n${dependsOn.map((d) => `      - ${d}`).join('\n')}`
          : '    dependsOn: []';
      return [
        `  - id: ${c.id}`,
        `    title: ${c.id}`,
        `    file: ${c.file}`,
        '    kind: plan',
        '    buildable: true',
        '    status: planning',
        dependsYaml,
      ].join('\n');
    })
    .join('\n');

  const parts = [
    `id: ${opts.manifestId ?? opts.planSetId}`,
    'title: Test Plan Set',
    `status: ${opts.status ?? 'planning'}`,
    `strategy: ${opts.strategy ?? 'dag'}`,
  ];
  if (anchorName !== undefined) parts.push(`anchor: ${anchorName}`);
  parts.push('children:');
  parts.push(childrenLines);

  await writeFile(resolve(dir, 'plan-set.yaml'), parts.join('\n') + '\n', 'utf-8');

  if (anchorName !== undefined && opts.writeAnchor !== false) {
    await writeFile(resolve(dir, anchorName), '# Umbrella\n\nOverview content.\n', 'utf-8');
  }

  for (const child of opts.children) {
    if (child.content === undefined) continue;
    const childPath = resolve(dir, child.file);
    await mkdir(resolve(childPath, '..'), { recursive: true });
    await writeFile(childPath, child.content, 'utf-8');
  }

  return dir;
}

async function startWithCwd(cwd: string): Promise<MonitorServer> {
  const db = openDatabase(resolve(cwd, 'monitor.db'));
  return startServer(db, 0, { strictPort: true, cwd });
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

describe('GET /api/session-plan-set/list', () => {
  it('returns plan-set fields for a fixture', async () => {
    const cwd = makeTempDir();
    await setupPlanSet({
      cwd,
      planSetId: 'add-search',
      manifestId: 'add-search',
      strategy: 'dag',
      children: [{ id: 'plan-01', file: 'plans/plan-01.md', content: '# One\n' }],
    });

    server = await startWithCwd(cwd);
    const res = await fetch(`http://localhost:${server.port}${API_ROUTES.sessionPlanSetList}`);
    expect(res.status).toBe(200);

    const data = (await res.json()) as {
      planSets: Array<{
        id: string;
        planSetId: string;
        title: string;
        status: string;
        strategy: string;
        dir: string;
        manifestPath: string;
        childCount: number;
      }>;
    };
    expect(data.planSets).toHaveLength(1);
    const entry = data.planSets[0];
    expect(entry.id).toBe('add-search');
    expect(entry.planSetId).toBe('add-search');
    expect(entry.title).toBe('Test Plan Set');
    expect(entry.status).toBe('planning');
    expect(entry.strategy).toBe('dag');
    expect(entry.childCount).toBe(1);
    expect(entry.dir.endsWith('.eforge/session-plans/add-search')).toBe(true);
    expect(entry.manifestPath.endsWith('.eforge/session-plans/add-search/plan-set.yaml')).toBe(true);
  });

  it('excludes submitted plan sets by default and includes them with includeSubmitted=true; always excludes abandoned', async () => {
    const cwd = makeTempDir();
    await setupPlanSet({ cwd, planSetId: 'active', manifestId: 'active', status: 'planning', children: [{ id: 'plan-01', file: 'plans/a.md', content: '# A\n' }] });
    await setupPlanSet({ cwd, planSetId: 'done', manifestId: 'done', status: 'submitted', children: [{ id: 'plan-01', file: 'plans/a.md', content: '# A\n' }] });
    await setupPlanSet({ cwd, planSetId: 'gone', manifestId: 'gone', status: 'abandoned', children: [{ id: 'plan-01', file: 'plans/a.md', content: '# A\n' }] });

    server = await startWithCwd(cwd);

    const resDefault = await fetch(`http://localhost:${server.port}${API_ROUTES.sessionPlanSetList}`);
    const defaultData = (await resDefault.json()) as { planSets: Array<{ id: string }> };
    const defaultIds = defaultData.planSets.map((p) => p.id);
    expect(defaultIds).toContain('active');
    expect(defaultIds).not.toContain('done');
    expect(defaultIds).not.toContain('gone');

    const resAll = await fetch(`http://localhost:${server.port}${API_ROUTES.sessionPlanSetList}?includeSubmitted=true`);
    const allData = (await resAll.json()) as { planSets: Array<{ id: string }> };
    const allIds = allData.planSets.map((p) => p.id);
    expect(allIds).toContain('active');
    expect(allIds).toContain('done');
    expect(allIds).not.toContain('gone');
  });
});

// ---------------------------------------------------------------------------
// show
// ---------------------------------------------------------------------------

describe('GET /api/session-plan-set/show', () => {
  it('returns umbrella anchorContent and omits raw child markdown', async () => {
    const cwd = makeTempDir();
    await setupPlanSet({
      cwd,
      planSetId: 'add-search',
      children: [{ id: 'plan-01', file: 'plans/plan-01.md', content: `# One\n\n${CHILD_BODY_SENTINEL}\n` }],
    });

    server = await startWithCwd(cwd);
    const res = await fetch(`http://localhost:${server.port}${API_ROUTES.sessionPlanSetShow}?planSetId=add-search`);
    expect(res.status).toBe(200);

    const text = await res.text();
    expect(text).not.toContain(CHILD_BODY_SENTINEL);

    const data = JSON.parse(text) as {
      planSet: { id: string; children: Array<{ id: string }> };
      validation: { ok: boolean };
      dir: string;
      manifestPath: string;
      anchorContent?: string;
    };
    expect(data.anchorContent).toContain('Overview content');
    expect(data.planSet.children[0].id).toBe('plan-01');
    expect(typeof data.dir).toBe('string');
    expect(typeof data.manifestPath).toBe('string');
  });

  it('returns 400 when planSetId is missing', async () => {
    const cwd = makeTempDir();
    server = await startWithCwd(cwd);
    const res = await fetch(`http://localhost:${server.port}${API_ROUTES.sessionPlanSetShow}`);
    expect(res.status).toBe(400);
  });

  it('returns 400 for an unsafe planSetId', async () => {
    const cwd = makeTempDir();
    server = await startWithCwd(cwd);
    const res = await fetch(
      `http://localhost:${server.port}${API_ROUTES.sessionPlanSetShow}?planSetId=${encodeURIComponent('../escape')}`,
    );
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown plan-set id', async () => {
    const cwd = makeTempDir();
    server = await startWithCwd(cwd);
    const res = await fetch(`http://localhost:${server.port}${API_ROUTES.sessionPlanSetShow}?planSetId=nonexistent`);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// validate
// ---------------------------------------------------------------------------

describe('GET /api/session-plan-set/validate', () => {
  it('returns ok:false with a missing-anchor diagnostic when the declared anchor is absent', async () => {
    const cwd = makeTempDir();
    await setupPlanSet({
      cwd,
      planSetId: 'add-search',
      writeAnchor: false,
      children: [{ id: 'plan-01', file: 'plans/plan-01.md', content: '# One\n' }],
    });

    server = await startWithCwd(cwd);
    const res = await fetch(`http://localhost:${server.port}${API_ROUTES.sessionPlanSetValidate}?planSetId=add-search`);
    expect(res.status).toBe(200);

    const data = (await res.json()) as {
      ok: boolean;
      diagnostics: Array<{ code: string }>;
      summary: { id: string };
    };
    expect(data.ok).toBe(false);
    expect(data.diagnostics.some((d) => d.code === 'missing-anchor')).toBe(true);
    expect(data.summary.id).toBe('add-search');
  });

  it('returns 400 for missing planSetId and 404 for an unknown plan set', async () => {
    const cwd = makeTempDir();
    server = await startWithCwd(cwd);

    const missing = await fetch(`http://localhost:${server.port}${API_ROUTES.sessionPlanSetValidate}`);
    expect(missing.status).toBe(400);

    const unknown = await fetch(`http://localhost:${server.port}${API_ROUTES.sessionPlanSetValidate}?planSetId=nonexistent`);
    expect(unknown.status).toBe(404);
  });
});
