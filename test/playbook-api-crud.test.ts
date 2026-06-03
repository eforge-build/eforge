import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, writeFile, readFile, access, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { useTempDir } from './test-tmpdir.js';
import { openDatabase } from '@eforge-build/monitor/db';
import { startServer, type DaemonState, type MonitorServer, type StartServerOptions, type WorkerTracker } from '@eforge-build/monitor/server';
import { API_ROUTES } from '@eforge-build/client';
import { AutoBuildSupervisor, type AutoBuildQueueMutationReason } from '@eforge-build/monitor/auto-build-supervisor';
import { upsertArtifact, upsertCompletion } from '@eforge-build/engine/artifacts';

import { setupPlaybookApiProject, postJson as post } from './playbook-api-helpers.js';
import { validPlaybookRaw } from './playbook-helpers.js';
const makeTempDir = useTempDir('eforge-playbook-api-');
// Intentionally absent from API_ROUTES: this retired endpoint must stay unregistered.
const RETIRED_PLAYBOOK_ENQUEUE_ROUTE = ['', 'api', 'playbook', 'enqueue'].join('/');

let server: MonitorServer | undefined;
let autoBuildWakeReasons: string[] = [];

class RecordingAutoBuildSupervisor extends AutoBuildSupervisor {
  override notifyQueueMutation(reason?: AutoBuildQueueMutationReason) {
    autoBuildWakeReasons.push(reason ?? 'external');
    return super.notifyQueueMutation(reason);
  }
}

function makeDaemonState(): DaemonState {
  return {
    autoBuildController: new RecordingAutoBuildSupervisor(),
  };
}

afterEach(async () => {
  await server?.stop();
  server = undefined;
  autoBuildWakeReasons = [];
});

async function init(): Promise<{ tmpDir: string; configDir: string }> {
  const tmpDir = makeTempDir();
  const { configDir } = await setupPlaybookApiProject(tmpDir);
  return { tmpDir, configDir };
}

async function start(tmpDir: string, opts: StartServerOptions = {}): Promise<void> {
  const db = openDatabase(resolve(tmpDir, 'monitor.db'));
  server = await startServer(db, 0, { strictPort: true, cwd: tmpDir, ...opts });
}

async function setup(opts: StartServerOptions = {}): Promise<{ tmpDir: string; configDir: string }> {
  const ctx = await init();
  await start(ctx.tmpDir, opts);
  return ctx;
}

// --- eforge:region playbook-api-crud-suite ---
describe('GET /api/playbook/list', () => {
  it('returns empty list when no playbooks exist', async () => {
    await setup();

    const res = await fetch(`http://localhost:${server.port}${API_ROUTES.playbookList}`);
    expect(res.status).toBe(200);

    const data = await res.json() as { playbooks: unknown[]; warnings: unknown[] };
    expect(Array.isArray(data.playbooks)).toBe(true);
    expect(data.playbooks).toHaveLength(0);
    expect(Array.isArray(data.warnings)).toBe(true);
  });

  it('returns playbooks with source, shadows, and mode fields when files exist at multiple tiers', async () => {
    const { tmpDir, configDir } = await init();

    // Write project-team autonomous playbook
    const teamDir = resolve(configDir, 'playbooks');
    await mkdir(teamDir, { recursive: true });
    await writeFile(resolve(teamDir, 'my-feature.md'), validPlaybookRaw({ scope: 'project-team', mode: 'autonomous' }), 'utf-8');

    // Write project-local shadow
    const localDir = resolve(tmpDir, '.eforge', 'playbooks');
    await mkdir(localDir, { recursive: true });
    await writeFile(resolve(localDir, 'my-feature.md'), validPlaybookRaw({ scope: 'project-local', mode: 'autonomous' }), 'utf-8');

    // Write a planning-mode playbook
    await writeFile(resolve(teamDir, 'my-planning.md'), validPlaybookRaw({ name: 'my-planning', scope: 'project-team', mode: 'planning' }), 'utf-8');

    await start(tmpDir);

    const res = await fetch(`http://localhost:${server.port}${API_ROUTES.playbookList}`);
    expect(res.status).toBe(200);

    const data = await res.json() as {
      playbooks: Array<{ name: string; source: string; mode: string; shadows: Array<{ source: string; path: string }> }>;
      warnings: string[];
    };

    expect(data.playbooks.length).toBeGreaterThanOrEqual(2);
    const entry = data.playbooks.find((p) => p.name === 'my-feature');
    expect(entry).toBeDefined();
    // project-local has highest precedence; source should be 'project-local'
    expect(entry!.source).toBe('project-local');
    expect(entry!.mode).toBe('autonomous');
    // project-team is a shadow
    expect(entry!.shadows.length).toBeGreaterThanOrEqual(1);
    expect(entry!.shadows.some((s) => s.source === 'project-team')).toBe(true);

    // Planning playbook has mode: 'planning'
    const planningEntry = data.playbooks.find((p) => p.name === 'my-planning');
    expect(planningEntry).toBeDefined();
    expect(planningEntry!.mode).toBe('planning');
  });
});

// ---------------------------------------------------------------------------
// Route: GET /api/playbook/show
// ---------------------------------------------------------------------------


describe('GET /api/playbook/show', () => {
  it('returns 400 when name param is missing', async () => {
    await setup();

    const res = await fetch(`http://localhost:${server.port}${API_ROUTES.playbookShow}`);
    expect(res.status).toBe(400);
  });

  it('returns 404 when playbook does not exist', async () => {
    await setup();

    const res = await fetch(`http://localhost:${server.port}${API_ROUTES.playbookShow}?name=nonexistent`);
    expect(res.status).toBe(404);
  });

  it('returns playbook frontmatter, body, and mode for an existing playbook', async () => {
    const { tmpDir, configDir } = await init();

    const teamDir = resolve(configDir, 'playbooks');
    await mkdir(teamDir, { recursive: true });
    await writeFile(resolve(teamDir, 'my-feature.md'), validPlaybookRaw(), 'utf-8');

    await start(tmpDir);

    const res = await fetch(`http://localhost:${server.port}${API_ROUTES.playbookShow}?name=my-feature`);
    expect(res.status).toBe(200);

    const data = await res.json() as {
      playbook: { name: string; description: string; scope: string; mode: string; goal: string };
      source: string;
      shadows: unknown[];
    };
    expect(data.playbook.name).toBe('my-feature');
    expect(data.playbook.description).toBe('Add the my-feature capability');
    expect(data.playbook.scope).toBe('project-team');
    expect(data.playbook.mode).toBe('autonomous');
    expect(data.playbook.goal).toContain('Implement the feature');
    expect(data.source).toBe('project-team');
    expect(Array.isArray(data.shadows)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Route: POST /api/playbook/save
// ---------------------------------------------------------------------------


describe('POST /api/playbook/save', () => {
  it('returns 400 with errors array when playbook frontmatter is invalid', async () => {
    await setup();

    const res = await post(`http://localhost:${server.port}${API_ROUTES.playbookSave}`, {
      scope: 'project-team',
      playbook: {
        frontmatter: { name: 'INVALID NAME', description: '', scope: 'project-team' },
        body: { goal: 'Do something.' },
      },
    });
    expect(res.status).toBe(400);

    const data = await res.json() as { error: string; errors: string[] };
    expect(data.error).toContain('validation');
    expect(Array.isArray(data.errors)).toBe(true);
    expect(data.errors.length).toBeGreaterThan(0);
  });

  it('returns 400 when the Goal section is missing', async () => {
    await setup();

    const res = await post(`http://localhost:${server.port}${API_ROUTES.playbookSave}`, {
      scope: 'project-team',
      playbook: {
        frontmatter: { name: 'my-feature', description: 'A feature', scope: 'project-team', mode: 'autonomous' },
        body: { goal: '' }, // empty goal → invalid
      },
    });
    expect(res.status).toBe(400);

    const data = await res.json() as { errors: string[] };
    expect(Array.isArray(data.errors)).toBe(true);
    expect(data.errors.some((e) => /goal/i.test(e))).toBe(true);
  });


  it('returns 400 and does not create file when acceptance criteria contain quality issues', async () => {
    const { tmpDir } = await setup();

    const res = await post(`http://localhost:${server.port}${API_ROUTES.playbookSave}`, {
      scope: 'project-team',
      playbook: {
        frontmatter: { name: 'bad-ac', description: 'Test invalid AC', scope: 'project-team', mode: 'autonomous' },
        body: {
          goal: 'Do the thing.',
          outOfScope: '',
          // Grouping label, bare command, and vague criterion
          acceptanceCriteria: '- Supply-chain checks:\n- `pnpm build`.\n- Works correctly.',
          plannerNotes: '',
        },
      },
    });
    expect(res.status).toBe(400);

    const data = await res.json() as { error: string };
    expect(data.error).toContain('Acceptance criteria quality issues');
    expect(data.error).toContain('[grouping-label]');
    expect(data.error).toContain('[bare-command]');
    expect(data.error).toContain('[vague]');
    expect(data.error).toContain('Supply-chain checks:');

    // File must not have been created
    const targetPath = resolve(tmpDir, 'eforge', 'playbooks', 'bad-ac.md');
    await expect(access(targetPath)).rejects.toThrow();
  });

  it('returns 400 and leaves existing file unchanged when acceptance criteria contain quality issues', async () => {
    const { tmpDir, configDir } = await init();

    // Create sentinel file with known content
    const playbooksDir = resolve(configDir, 'playbooks');
    await mkdir(playbooksDir, { recursive: true });
    const sentinelContent = '---\nname: existing\ndescription: Existing playbook\nscope: project-team\nmode: autonomous\n---\n\n## Goal\n\nExisting goal.\n';
    await writeFile(resolve(playbooksDir, 'existing.md'), sentinelContent, 'utf-8');

    await start(tmpDir);

    const res = await post(`http://localhost:${server.port}${API_ROUTES.playbookSave}`, {
      scope: 'project-team',
      playbook: {
        frontmatter: { name: 'existing', description: 'Existing playbook', scope: 'project-team', mode: 'autonomous' },
        body: {
          goal: 'New goal.',
          outOfScope: '',
          acceptanceCriteria: '- Supply-chain checks:\n- `pnpm build`.',
          plannerNotes: '',
        },
      },
    });
    expect(res.status).toBe(400);

    const data = await res.json() as { error: string };
    expect(data.error).toContain('Acceptance criteria quality issues');

    // Existing file must be unchanged
    const fileContent = await readFile(resolve(playbooksDir, 'existing.md'), 'utf-8');
    expect(fileContent).toBe(sentinelContent);
  });


  it('writes the playbook file and returns its path', async () => {
    await setup();

    const res = await post(`http://localhost:${server.port}${API_ROUTES.playbookSave}`, {
      scope: 'project-team',
      playbook: {
        frontmatter: { name: 'my-feature', description: 'Add the my-feature capability', scope: 'project-team', mode: 'autonomous' },
        body: { goal: 'Implement the feature.', outOfScope: '', acceptanceCriteria: '', plannerNotes: '' },
      },
    });
    expect(res.status).toBe(200);

    const data = await res.json() as { path: string };
    expect(typeof data.path).toBe('string');
    expect(data.path).toContain('my-feature.md');

    // Verify file was actually written
    await expect(access(data.path)).resolves.toBeUndefined();
    const content = await readFile(data.path, 'utf-8');
    expect(content).toContain('name: my-feature');
    expect(content).toContain('## Goal');
  });
});

// ---------------------------------------------------------------------------
// Route: retired playbook enqueue endpoint (removed — must return 404)
// ---------------------------------------------------------------------------


describe('POST retired playbook enqueue endpoint (old route removed)', () => {
  it('returns 404 for the old enqueue route', async () => {
    await setup();

    expect(Object.values(API_ROUTES)).not.toContain(RETIRED_PLAYBOOK_ENQUEUE_ROUTE);

    const res = await post(`http://localhost:${server.port}${RETIRED_PLAYBOOK_ENQUEUE_ROUTE}`, {
      name: 'my-feature',
    });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Route: POST /api/playbook/run
// ---------------------------------------------------------------------------

// --- eforge:endregion playbook-api-crud-suite ---
