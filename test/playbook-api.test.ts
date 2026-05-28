/**
 * Integration tests for playbook HTTP routes.
 *
 * Drives the daemon in-process via `startServer` (consistent with the
 * serve-queue and daemon-recovery test patterns). Each test creates a real
 * temp directory with a minimal eforge project layout, exercises each of the
 * seven playbook routes, and asserts status codes, response shapes, and
 * engine-side persistence.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, writeFile, readFile, access, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { useTempDir } from './test-tmpdir.js';
import { openDatabase } from '@eforge-build/monitor/db';
import { startServer, type DaemonState, type MonitorServer, type StartServerOptions, type WorkerTracker } from '@eforge-build/monitor/server';
import { API_ROUTES } from '@eforge-build/client';
import { AutoBuildSupervisor, type AutoBuildQueueMutationReason } from '@eforge-build/monitor/auto-build-supervisor';

const makeTempDir = useTempDir('eforge-playbook-api-');

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Set up a minimal eforge project with git and a config directory. */
async function setupProject(tmpDir: string): Promise<{ configDir: string }> {
  // Init git repo
  const gitOpts = { cwd: tmpDir };
  execFileSync('git', ['init', '-b', 'main'], gitOpts);
  execFileSync('git', ['config', 'user.email', 'test@example.com'], gitOpts);
  execFileSync('git', ['config', 'user.name', 'Test'], gitOpts);

  // Add .gitignore ignoring .eforge/ so queue writes don't appear in git status
  await writeFile(resolve(tmpDir, '.gitignore'), '.eforge/\n', 'utf-8');
  execFileSync('git', ['add', '.gitignore'], gitOpts);
  execFileSync('git', ['commit', '-m', 'chore: initial commit'], gitOpts);

  // Create eforge config directory (so getConfigDir resolves it)
  const configDir = resolve(tmpDir, 'eforge');
  await mkdir(configDir, { recursive: true });
  await writeFile(resolve(configDir, 'config.yaml'), '', 'utf-8');

  return { configDir };
}

/** Build a valid raw playbook string. */
function validPlaybookRaw(opts: {
  name?: string; description?: string; scope?: string; mode?: string; goal?: string; profile?: string;
} = {}): string {
  const { name = 'my-feature', description = 'Add the my-feature capability', scope = 'project-team', mode = 'autonomous', goal = 'Implement the feature.', profile } = opts;
  const lines = ['---', `name: ${name}`, `description: ${description}`, `scope: ${scope}`, `mode: ${mode}`];
  if (profile) lines.push(`profile: ${profile}`);
  lines.push('---', '', '## Goal', '', goal);
  return lines.join('\n');
}

/** Build an invalid-AC playbook string (grouping label + bare command triggers the quality gate). */
function invalidAcPlaybookRaw(opts: { name?: string; mode?: string; profile?: string; vague?: boolean } = {}): string {
  const { name = 'bad-ac', mode = 'autonomous', profile, vague } = opts;
  const lines = ['---', `name: ${name}`, 'description: Test playbook with bad AC', 'scope: project-team', `mode: ${mode}`];
  if (profile) lines.push(`profile: ${profile}`);
  lines.push('---', '', '## Goal', '', 'Do the thing.', '', '## Acceptance criteria', '', '- Supply-chain checks:', '- `pnpm build`.');
  if (vague) lines.push('- Works correctly.');
  return lines.join('\n');
}

/** POST helper that sends JSON. */
async function post(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function setup(opts: StartServerOptions = {}) {
  const tmpDir = makeTempDir();
  const { configDir } = await setupProject(tmpDir);
  const db = openDatabase(resolve(tmpDir, 'monitor.db'));
  server = await startServer(db, 0, { strictPort: true, cwd: tmpDir, ...opts });
  return { tmpDir, configDir };
}
async function start(tmpDir: string, opts: StartServerOptions = {}) {
  const db = openDatabase(resolve(tmpDir, 'monitor.db'));
  server = await startServer(db, 0, { strictPort: true, cwd: tmpDir, ...opts });
}
async function init() {
  const tmpDir = makeTempDir();
  const { configDir } = await setupProject(tmpDir);
  return { tmpDir, configDir };
}

// ---------------------------------------------------------------------------
// Route: GET /api/playbook/list
// ---------------------------------------------------------------------------

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

  // --- eforge:region plan-01-playbook-ac-quality-gates ---

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

  // --- eforge:endregion plan-01-playbook-ac-quality-gates ---

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
// Route: POST /api/playbook/enqueue (removed — must return 404)
// ---------------------------------------------------------------------------

describe('POST /api/playbook/enqueue (old route removed)', () => {
  it('returns 404 for the old enqueue route', async () => {
    await setup();

    const res = await post(`http://localhost:${server.port}/api/playbook/enqueue`, {
      name: 'my-feature',
    });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Route: POST /api/playbook/run
// ---------------------------------------------------------------------------

describe('POST /api/playbook/run', () => {
  it('returns 404 when the named playbook does not exist', async () => {
    await setup();

    const res = await post(`http://localhost:${server.port}${API_ROUTES.playbookRun}`, {
      name: 'nonexistent',
    });
    expect(res.status).toBe(404);
  });

  it('returns { kind: "enqueued", id } for an autonomous playbook and creates a PRD', async () => {
    const { tmpDir, configDir } = await init();

    // Write an autonomous playbook to the team dir
    const teamDir = resolve(configDir, 'playbooks');
    await mkdir(teamDir, { recursive: true });
    await writeFile(resolve(teamDir, 'my-feature.md'), validPlaybookRaw({ mode: 'autonomous' }), 'utf-8');

    await start(tmpDir, { daemonState: makeDaemonState() });

    const res = await post(`http://localhost:${server.port}${API_ROUTES.playbookRun}`, {
      name: 'my-feature',
    });
    expect(res.status).toBe(200);

    const data = await res.json() as { kind: string; id: string };
    expect(data.kind).toBe('enqueued');
    expect(typeof data.id).toBe('string');
    expect(data.id.length).toBeGreaterThan(0);

    // Verify the PRD file exists in the queue
    const queueFile = resolve(tmpDir, '.eforge', 'queue', `${data.id}.md`);
    await expect(access(queueFile)).resolves.toBeUndefined();
    const content = await readFile(queueFile, 'utf-8');
    expect(content).toContain('title:');

    // Enqueue is filesystem-only — no commit should have been created.
    // The initial empty commit is still the latest commit.
    const commitSubject = execFileSync('git', ['log', '-1', '--pretty=%s'], { cwd: tmpDir }).toString().trim();
    expect(commitSubject).toBe('chore: initial commit');

    // Verify the queue directory shows no changes (queue is gitignored)
    const gitStatus = execFileSync('git', ['status', '--porcelain', '.eforge/queue/'], { cwd: tmpDir }).toString().trim();
    expect(gitStatus).toBe('');

    expect(autoBuildWakeReasons).toContain('playbook-enqueue');
  });

  it('returns { kind: "requires-agent", mode: "planning", name, message } for a planning-mode playbook and does not write a session plan or enqueue', async () => {
    const { tmpDir, configDir } = await init();

    // Write a planning-mode playbook
    const teamDir = resolve(configDir, 'playbooks');
    await mkdir(teamDir, { recursive: true });
    await writeFile(resolve(teamDir, 'my-planning.md'), validPlaybookRaw({ name: 'my-planning', mode: 'planning' }), 'utf-8');

    const sessionPlanDir = resolve(tmpDir, '.eforge', 'session-plans');
    await mkdir(sessionPlanDir, { recursive: true });
    const sentinelSessionPlan = resolve(sessionPlanDir, 'existing-plan.md');
    await writeFile(sentinelSessionPlan, '# Existing plan\n\nDo not modify.\n', 'utf-8');

    await start(tmpDir, { daemonState: makeDaemonState() });

    const res = await post(`http://localhost:${server.port}${API_ROUTES.playbookRun}`, {
      name: 'my-planning',
    });
    expect(res.status).toBe(200);

    const data = await res.json() as { kind: string; mode: string; name: string; message: string };
    expect(data.kind).toBe('requires-agent');
    expect(data.mode).toBe('planning');
    expect(data.name).toBe('my-planning');
    expect(typeof data.message).toBe('string');
    expect(data.message).toContain('/eforge:playbook run my-planning');

    // Verify no session plan file was created and existing session plans were left untouched
    await expect(readdir(sessionPlanDir)).resolves.toEqual(['existing-plan.md']);
    await expect(readFile(sentinelSessionPlan, 'utf-8')).resolves.toBe('# Existing plan\n\nDo not modify.\n');

    // Verify no queue mutation (no PRD created) and no auto-build wake
    const queueDir = resolve(tmpDir, '.eforge', 'queue');
    await expect(readdir(queueDir)).rejects.toThrow();
    expect(autoBuildWakeReasons).toEqual([]);
  });

  it('returns requires-agent for a planning-mode playbook even when afterQueueId is provided', async () => {
    const { tmpDir, configDir } = await init();

    const teamDir = resolve(configDir, 'playbooks');
    await mkdir(teamDir, { recursive: true });
    await writeFile(resolve(teamDir, 'my-planning.md'), validPlaybookRaw({ name: 'my-planning', mode: 'planning' }), 'utf-8');

    await start(tmpDir, { daemonState: makeDaemonState() });

    const res = await post(`http://localhost:${server.port}${API_ROUTES.playbookRun}`, {
      name: 'my-planning',
      afterQueueId: 'missing-upstream',
    });

    expect(res.status).toBe(200);
    const data = await res.json() as { kind: string; mode: string; name: string };
    expect(data).toEqual(expect.objectContaining({
      kind: 'requires-agent',
      mode: 'planning',
      name: 'my-planning',
    }));
    const queueDir = resolve(tmpDir, '.eforge', 'queue');
    await expect(readdir(queueDir)).rejects.toThrow();
    expect(autoBuildWakeReasons).toEqual([]);
  });

  it('returns { kind: "requires-agent" } on repeated calls for a planning-mode playbook (no 409)', async () => {
    const { tmpDir, configDir } = await init();

    const teamDir = resolve(configDir, 'playbooks');
    await mkdir(teamDir, { recursive: true });
    await writeFile(resolve(teamDir, 'my-planning.md'), validPlaybookRaw({ name: 'my-planning', mode: 'planning' }), 'utf-8');

    await start(tmpDir, { daemonState: makeDaemonState() });

    // First run
    const first = await post(`http://localhost:${server.port}${API_ROUTES.playbookRun}`, { name: 'my-planning' });
    expect(first.status).toBe(200);
    const firstData = await first.json() as { kind: string };
    expect(firstData.kind).toBe('requires-agent');

    // Second run — no collision since no file is written
    const second = await post(`http://localhost:${server.port}${API_ROUTES.playbookRun}`, { name: 'my-planning' });
    expect(second.status).toBe(200);
    const secondData = await second.json() as { kind: string };
    expect(secondData.kind).toBe('requires-agent');
    expect(autoBuildWakeReasons).toEqual([]);
  });

  it('returns 404 and does not enqueue when afterQueueId is missing for an autonomous playbook', async () => {
    const { tmpDir, configDir } = await init();

    const teamDir = resolve(configDir, 'playbooks');
    await mkdir(teamDir, { recursive: true });
    await writeFile(resolve(teamDir, 'my-feature.md'), validPlaybookRaw({ mode: 'autonomous' }), 'utf-8');

    await start(tmpDir, { daemonState: makeDaemonState() });

    const res = await post(`http://localhost:${server.port}${API_ROUTES.playbookRun}`, {
      name: 'my-feature',
      afterQueueId: 'missing-upstream',
    });

    expect(res.status).toBe(404);
    const data = await res.json() as { error: string };
    expect(data.error).toContain('depends_on references unknown queue item: "missing-upstream"');

    const queueDir = resolve(tmpDir, '.eforge', 'queue');
    await expect(readdir(queueDir)).rejects.toThrow();
    expect(autoBuildWakeReasons).toEqual([]);
  });

  // --- eforge:region plan-01-playbook-ac-quality-gates ---

  it('returns requires-agent for a planning-mode playbook with invalid acceptance criteria (AC gate must not apply to planning mode)', async () => {
    const { tmpDir, configDir } = await init();

    const teamDir = resolve(configDir, 'playbooks');
    await mkdir(teamDir, { recursive: true });
    // Write a planning-mode playbook with deliberately invalid AC (grouping label + bare command)
    await writeFile(resolve(teamDir, 'planning-bad-ac.md'), invalidAcPlaybookRaw({ name: 'planning-bad-ac', mode: 'planning' }), 'utf-8');

    await start(tmpDir, { daemonState: makeDaemonState() });

    const res = await post(`http://localhost:${server.port}${API_ROUTES.playbookRun}`, {
      name: 'planning-bad-ac',
    });
    expect(res.status).toBe(200);

    const data = await res.json() as { kind: string; mode: string; name: string };
    expect(data.kind).toBe('requires-agent');
    expect(data.mode).toBe('planning');
    expect(data.name).toBe('planning-bad-ac');

    // No queue files and no auto-build wake
    const queueDir = resolve(tmpDir, '.eforge', 'queue');
    await expect(readdir(queueDir)).rejects.toThrow();
    expect(autoBuildWakeReasons).toEqual([]);
  });

  it('returns 400 and does not enqueue when autonomous playbook has invalid acceptance criteria', async () => {
    const { tmpDir, configDir } = await init();

    // Write a playbook with invalid AC directly to the playbooks directory
    const teamDir = resolve(configDir, 'playbooks');
    await mkdir(teamDir, { recursive: true });
    await writeFile(resolve(teamDir, 'bad-ac.md'), invalidAcPlaybookRaw({ vague: true }), 'utf-8');

    await start(tmpDir, { daemonState: makeDaemonState() });

    const res = await post(`http://localhost:${server.port}${API_ROUTES.playbookRun}`, {
      name: 'bad-ac',
    });
    expect(res.status).toBe(400);

    const data = await res.json() as { error: string };
    expect(data.error).toContain('Acceptance criteria quality issues');
    expect(data.error).toContain('[grouping-label]');
    expect(data.error).toContain('[bare-command]');
    expect(data.error).toContain('[vague]');

    // No queue markdown files should have been created
    const queueDir = resolve(tmpDir, '.eforge', 'queue');
    const queueExists = await readdir(queueDir).then(() => true).catch(() => false);
    if (queueExists) {
      const files = await readdir(queueDir);
      const markdownFiles = files.filter((f) => f.endsWith('.md'));
      expect(markdownFiles).toHaveLength(0);
    }
    expect(autoBuildWakeReasons).toEqual([]);
  });

  it('returns AC-quality 400 before dependency 404 when afterQueueId is missing-upstream and AC is invalid', async () => {
    const { tmpDir, configDir } = await init();

    const teamDir = resolve(configDir, 'playbooks');
    await mkdir(teamDir, { recursive: true });
    await writeFile(resolve(teamDir, 'bad-ac.md'), invalidAcPlaybookRaw(), 'utf-8');

    await start(tmpDir, { daemonState: makeDaemonState() });

    // AC gate must fire before the dependency validation (which would return 404)
    const res = await post(`http://localhost:${server.port}${API_ROUTES.playbookRun}`, {
      name: 'bad-ac',
      afterQueueId: 'missing-upstream',
    });
    expect(res.status).toBe(400);

    const data = await res.json() as { error: string };
    expect(data.error).toContain('Acceptance criteria quality issues');
    expect(autoBuildWakeReasons).toEqual([]);
  });

  it('returns AC-quality 400 before profile 400 when autonomous playbook has both invalid AC and a missing profile', async () => {
    const { tmpDir, configDir } = await init();

    const teamDir = resolve(configDir, 'playbooks');
    await mkdir(teamDir, { recursive: true });
    // Playbook with invalid AC AND a profile that does not exist
    await writeFile(resolve(teamDir, 'bad-ac-missing-profile.md'), invalidAcPlaybookRaw({ name: 'bad-ac-missing-profile', profile: 'nonexistent-profile' }), 'utf-8');

    await start(tmpDir, { daemonState: makeDaemonState() });

    const res = await post(`http://localhost:${server.port}${API_ROUTES.playbookRun}`, {
      name: 'bad-ac-missing-profile',
    });
    expect(res.status).toBe(400);

    const data = await res.json() as { error: string };
    // Must get the AC-quality error, not the missing-profile error
    expect(data.error).toContain('Acceptance criteria quality issues');
    expect(data.error).not.toContain('nonexistent-profile');

    // No queue files and no auto-build wake
    const queueDir = resolve(tmpDir, '.eforge', 'queue');
    const queueExists = await readdir(queueDir).then(() => true).catch(() => false);
    if (queueExists) {
      const files = await readdir(queueDir);
      expect(files.filter((f) => f.endsWith('.md'))).toHaveLength(0);
    }
    expect(autoBuildWakeReasons).toEqual([]);
  });

  // --- eforge:endregion plan-01-playbook-ac-quality-gates ---

  it('persists dependsOn in PRD frontmatter when afterQueueId is provided for autonomous playbook', async () => {
    const { tmpDir, configDir } = await init();

    const teamDir = resolve(configDir, 'playbooks');
    await mkdir(teamDir, { recursive: true });
    await writeFile(resolve(teamDir, 'my-feature.md'), validPlaybookRaw({ mode: 'autonomous' }), 'utf-8');
    await writeFile(resolve(teamDir, 'my-dependent.md'), validPlaybookRaw({ name: 'my-dependent', mode: 'autonomous' }), 'utf-8');

    await start(tmpDir);

    // First run the predecessor so it exists in the queue
    const predecessorRes = await post(`http://localhost:${server.port}${API_ROUTES.playbookRun}`, {
      name: 'my-feature',
    });
    expect(predecessorRes.status).toBe(200);
    const { id: predecessorId } = await predecessorRes.json() as { kind: string; id: string };

    // Now run the dependent with afterQueueId pointing to the predecessor
    const res = await post(`http://localhost:${server.port}${API_ROUTES.playbookRun}`, {
      name: 'my-dependent',
      afterQueueId: predecessorId,
    });
    expect(res.status).toBe(200);

    const data = await res.json() as { kind: string; id: string };
    expect(data.kind).toBe('enqueued');
    // When afterQueueId is provided, the PRD goes into waiting/ not queue root
    const queueFile = resolve(tmpDir, '.eforge', 'queue', 'waiting', `${data.id}.md`);
    const content = await readFile(queueFile, 'utf-8');

    // The PRD frontmatter should include depends_on
    expect(content).toContain('depends_on');
    expect(content).toContain(predecessorId);
  });

  it('enqueued PRD is visible via GET /api/queue', async () => {
    const { tmpDir, configDir } = await init();

    const teamDir = resolve(configDir, 'playbooks');
    await mkdir(teamDir, { recursive: true });
    await writeFile(resolve(teamDir, 'my-feature.md'), validPlaybookRaw({ mode: 'autonomous' }), 'utf-8');

    await start(tmpDir);

    const runRes = await post(`http://localhost:${server.port}${API_ROUTES.playbookRun}`, {
      name: 'my-feature',
    });
    expect(runRes.status).toBe(200);

    const { id } = await runRes.json() as { kind: string; id: string };

    // The new PRD should appear in the queue listing
    const queueRes = await fetch(`http://localhost:${server.port}${API_ROUTES.queue}`);
    expect(queueRes.status).toBe(200);

    const items = await queueRes.json() as Array<{ id: string; status: string }>;
    const found = items.find((item) => item.id === id);
    expect(found).toBeDefined();
    expect(found!.status).toBe('pending');
  });
});

// --- Route: POST /api/playbook/promote ---

describe('POST /api/playbook/promote', () => {
  it('moves a playbook from project-local to project-team and returns the new path', async () => {
    const { tmpDir, configDir } = await init();

    // Write playbook to project-local tier
    const localDir = resolve(tmpDir, '.eforge', 'playbooks');
    await mkdir(localDir, { recursive: true });
    await writeFile(resolve(localDir, 'my-feature.md'), validPlaybookRaw({ scope: 'project-local' }), 'utf-8');

    await start(tmpDir);

    const res = await post(`http://localhost:${server.port}${API_ROUTES.playbookPromote}`, { name: 'my-feature' });
    expect(res.status).toBe(200);

    const data = await res.json() as { path: string };
    expect(typeof data.path).toBe('string');

    // New path should be under eforge/playbooks (project-team)
    expect(data.path).toContain('eforge');
    expect(data.path).toContain('playbooks');
    expect(data.path).toContain('my-feature.md');

    // Verify the file exists at the new location
    await expect(access(data.path)).resolves.toBeUndefined();

    // Old location should no longer exist
    const oldPath = resolve(localDir, 'my-feature.md');
    await expect(access(oldPath)).rejects.toThrow();
  });
});

// --- Route: POST /api/playbook/demote ---

describe('POST /api/playbook/demote', () => {
  it('moves a playbook from project-team to project-local and returns the new path', async () => {
    const { tmpDir, configDir } = await init();

    // Write playbook to project-team tier
    const teamDir = resolve(configDir, 'playbooks');
    await mkdir(teamDir, { recursive: true });
    await writeFile(resolve(teamDir, 'my-feature.md'), validPlaybookRaw({ scope: 'project-team' }), 'utf-8');

    await start(tmpDir);

    const res = await post(`http://localhost:${server.port}${API_ROUTES.playbookDemote}`, { name: 'my-feature' });
    expect(res.status).toBe(200);

    const data = await res.json() as { path: string };
    expect(typeof data.path).toBe('string');

    // New path should be under .eforge/playbooks (project-local)
    expect(data.path).toContain('.eforge');
    expect(data.path).toContain('playbooks');
    expect(data.path).toContain('my-feature.md');

    // Verify the file exists at the new location
    await expect(access(data.path)).resolves.toBeUndefined();

    // Old location should no longer exist
    const oldPath = resolve(teamDir, 'my-feature.md');
    await expect(access(oldPath)).rejects.toThrow();
  });
});

// --- Route: POST /api/playbook/validate ---

describe('POST /api/playbook/validate', () => {
  it('returns ok:true for a valid raw playbook', async () => {
    await setup();

    const res = await post(`http://localhost:${server.port}${API_ROUTES.playbookValidate}`, {
      raw: validPlaybookRaw(),
    });
    expect(res.status).toBe(200);

    const data = await res.json() as { ok: boolean; errors?: string[] };
    expect(data.ok).toBe(true);
    expect(data.errors).toBeUndefined();
  });

  it('returns ok:false with errors for an invalid raw playbook', async () => {
    await setup();

    const invalidRaw = '---\nname: INVALID NAME\nscope: bad-scope\n---\n\n## Goal\n\nDo something.';

    const res = await post(`http://localhost:${server.port}${API_ROUTES.playbookValidate}`, {
      raw: invalidRaw,
    });
    expect(res.status).toBe(200);

    const data = await res.json() as { ok: boolean; errors: string[] };
    expect(data.ok).toBe(false);
    expect(Array.isArray(data.errors)).toBe(true);
    expect(data.errors.length).toBeGreaterThan(0);
  });

  it('returns ok:false when the ## Goal section is missing', async () => {
    await setup();

    const rawNoGoal = '---\nname: my-feature\ndescription: A feature\nscope: project-team\nmode: autonomous\n---\n\n## Out of scope\n\nNothing.';

    const res = await post(`http://localhost:${server.port}${API_ROUTES.playbookValidate}`, {
      raw: rawNoGoal,
    });
    expect(res.status).toBe(200);

    const data = await res.json() as { ok: boolean; errors: string[] };
    expect(data.ok).toBe(false);
    expect(data.errors.some((e) => /goal/i.test(e))).toBe(true);
  });
});

// --- Playbook profile field — /api/playbook/run ---

describe('POST /api/playbook/run — profile field', () => {
  it('does not validate missing profile for a planning-mode playbook', async () => {
    const { tmpDir, configDir } = await init();

    const teamDir = resolve(configDir, 'playbooks');
    await mkdir(teamDir, { recursive: true });
    await writeFile(resolve(teamDir, 'my-planning.md'), validPlaybookRaw({ name: 'my-planning', mode: 'planning', profile: 'missing-profile' }), 'utf-8');

    await start(tmpDir, { daemonState: makeDaemonState() });

    const res = await post(`http://localhost:${server.port}${API_ROUTES.playbookRun}`, {
      name: 'my-planning',
    });
    expect(res.status).toBe(200);

    const data = await res.json() as { kind: string; mode: string; name: string };
    expect(data).toEqual(expect.objectContaining({
      kind: 'requires-agent',
      mode: 'planning',
      name: 'my-planning',
    }));

    const queueDir = resolve(tmpDir, '.eforge', 'queue');
    await expect(readdir(queueDir)).rejects.toThrow();
    expect(autoBuildWakeReasons).toEqual([]);
  });

  it('creates queued PRD with profile: frontmatter when autonomous playbook has a known profile', async () => {
    const { tmpDir, configDir } = await init();

    const profilesDir = resolve(configDir, 'profiles');
    await mkdir(profilesDir, { recursive: true });
    await writeFile(resolve(profilesDir, 'docs-heavy.yaml'), '# test profile\n', 'utf-8');

    const teamDir = resolve(configDir, 'playbooks');
    await mkdir(teamDir, { recursive: true });
    await writeFile(resolve(teamDir, 'my-feature.md'), validPlaybookRaw({ profile: 'docs-heavy' }), 'utf-8');

    await start(tmpDir, { daemonState: makeDaemonState() });

    const res = await post(`http://localhost:${server.port}${API_ROUTES.playbookRun}`, {
      name: 'my-feature',
    });
    expect(res.status).toBe(200);

    const data = await res.json() as { kind: string; id: string };
    expect(data.kind).toBe('enqueued');

    // Verify the queued PRD contains profile: docs-heavy in frontmatter
    const queueFile = resolve(tmpDir, '.eforge', 'queue', `${data.id}.md`);
    const content = await readFile(queueFile, 'utf-8');
    const frontmatter = content.match(/^---\n([\s\S]*?)\n---/)?.[1];
    expect(frontmatter).toBeDefined();
    expect(frontmatter).toContain('profile: docs-heavy');
  });

  it('returns 400 and does not enqueue when autonomous playbook profile is absent from all profile scopes', async () => {
    const { tmpDir, configDir } = await init();
    // Note: no profile file created

    const teamDir = resolve(configDir, 'playbooks');
    await mkdir(teamDir, { recursive: true });
    await writeFile(resolve(teamDir, 'my-feature.md'), validPlaybookRaw({ profile: 'missing-profile' }), 'utf-8');

    await start(tmpDir, { daemonState: makeDaemonState() });

    const res = await post(`http://localhost:${server.port}${API_ROUTES.playbookRun}`, {
      name: 'my-feature',
    });
    expect(res.status).toBe(400);

    const data = await res.json() as { error: string };
    expect(data.error).toContain('missing-profile');

    // Verify no PRD was created
    const queueDir = resolve(tmpDir, '.eforge', 'queue');
    await expect(readdir(queueDir)).rejects.toThrow();
    expect(autoBuildWakeReasons).toEqual([]);
  });

  it('persists landingAction in PRD frontmatter when valid landingAction value is provided for autonomous playbook', async () => {
    const { tmpDir, configDir } = await init();

    const teamDir = resolve(configDir, 'playbooks');
    await mkdir(teamDir, { recursive: true });
    await writeFile(resolve(teamDir, 'my-feature.md'), validPlaybookRaw({ mode: 'autonomous' }), 'utf-8');

    await start(tmpDir, { daemonState: makeDaemonState() });

    const res = await post(`http://localhost:${server.port}${API_ROUTES.playbookRun}`, {
      name: 'my-feature',
      landingAction: 'leave',
    });
    expect(res.status).toBe(200);

    const data = await res.json() as { kind: string; id: string };
    expect(data.kind).toBe('enqueued');
    expect(typeof data.id).toBe('string');

    // Verify the queued PRD contains landing: leave in frontmatter
    const queueFile = resolve(tmpDir, '.eforge', 'queue', `${data.id}.md`);
    const content = await readFile(queueFile, 'utf-8');
    const frontmatter = content.match(/^---\n([\s\S]*?)\n---/)?.[1];
    expect(frontmatter).toBeDefined();
    expect(frontmatter).toContain('landing: leave');
  });

  it('returns 400 and does not enqueue when landingAction value is invalid for autonomous playbook', async () => {
    const { tmpDir, configDir } = await init();

    const teamDir = resolve(configDir, 'playbooks');
    await mkdir(teamDir, { recursive: true });
    await writeFile(resolve(teamDir, 'my-feature.md'), validPlaybookRaw({ mode: 'autonomous' }), 'utf-8');

    await start(tmpDir, { daemonState: makeDaemonState() });

    const res = await post(`http://localhost:${server.port}${API_ROUTES.playbookRun}`, {
      name: 'my-feature',
      landingAction: 'bad',
    });
    expect(res.status).toBe(400);

    const data = await res.json() as { error: string };
    expect(data.error).toContain('landingAction');

    // No PRD should have been created in queue or waiting
    const queueDir = resolve(tmpDir, '.eforge', 'queue');
    await expect(readdir(queueDir)).rejects.toThrow();
    expect(autoBuildWakeReasons).toEqual([]);
  });

  it('returns requires-agent for a planning-mode playbook even when valid landingAction is provided', async () => {
    const { tmpDir, configDir } = await init();

    const teamDir = resolve(configDir, 'playbooks');
    await mkdir(teamDir, { recursive: true });
    await writeFile(resolve(teamDir, 'my-planning.md'), validPlaybookRaw({ name: 'my-planning', mode: 'planning' }), 'utf-8');

    await start(tmpDir, { daemonState: makeDaemonState() });

    const res = await post(`http://localhost:${server.port}${API_ROUTES.playbookRun}`, {
      name: 'my-planning',
      landingAction: 'pr',
    });
    expect(res.status).toBe(200);

    const data = await res.json() as { kind: string; mode: string; name: string };
    expect(data.kind).toBe('requires-agent');
    expect(data.mode).toBe('planning');
    expect(data.name).toBe('my-planning');

    // No PRD should have been enqueued
    const queueDir = resolve(tmpDir, '.eforge', 'queue');
    await expect(readdir(queueDir)).rejects.toThrow();
    expect(autoBuildWakeReasons).toEqual([]);
  });

  it('returns 400 with migration error when old onSuccess wire value is sent in request body', async () => {
    const { tmpDir, configDir } = await init();

    const teamDir = resolve(configDir, 'playbooks');
    await mkdir(teamDir, { recursive: true });
    await writeFile(resolve(teamDir, 'my-feature.md'), validPlaybookRaw({ mode: 'autonomous' }), 'utf-8');

    await start(tmpDir, { daemonState: makeDaemonState() });

    const res = await post(`http://localhost:${server.port}${API_ROUTES.playbookRun}`, {
      name: 'my-feature',
      onSuccess: 'leave-branch',
    });
    expect(res.status).toBe(400);

    const data = await res.json() as { error: string };
    // Migration guidance: old onSuccess field rejected
    expect(data.error).toMatch(/onSuccess|landingAction/i);

    const queueDir = resolve(tmpDir, '.eforge', 'queue');
    await expect(readdir(queueDir)).rejects.toThrow();
    expect(autoBuildWakeReasons).toEqual([]);
  });

  it('save/show/list round-trip includes profile field and required mode', async () => {
    await setup();

    const saveRes = await post(`http://localhost:${server.port}${API_ROUTES.playbookSave}`, {
      scope: 'project-team',
      playbook: {
        frontmatter: {
          name: 'my-feature',
          description: 'Add the my-feature capability',
          scope: 'project-team',
          mode: 'autonomous',
          profile: 'docs-heavy',
        },
        body: { goal: 'Implement the feature.', outOfScope: '', acceptanceCriteria: '', plannerNotes: '' },
      },
    });
    expect(saveRes.status).toBe(200);
    const saveData = await saveRes.json() as { path: string };
    const savedRaw = await readFile(saveData.path, 'utf-8');
    expect(savedRaw).toContain('mode: autonomous');
    expect(savedRaw).toContain('profile: docs-heavy');

    // GET /api/playbook/show includes profile
    const showRes = await fetch(`http://localhost:${server.port}${API_ROUTES.playbookShow}?name=my-feature`);
    expect(showRes.status).toBe(200);
    const showData = await showRes.json() as { playbook: { profile?: string; mode: string } };
    expect(showData.playbook.profile).toBe('docs-heavy');
    expect(showData.playbook.mode).toBe('autonomous');

    // GET /api/playbook/list includes profile
    const listRes = await fetch(`http://localhost:${server.port}${API_ROUTES.playbookList}`);
    expect(listRes.status).toBe(200);
    const listData = await listRes.json() as { playbooks: Array<{ name: string; profile?: string; mode: string }> };
    const entry = listData.playbooks.find((p) => p.name === 'my-feature');
    expect(entry).toBeDefined();
    expect(entry!.profile).toBe('docs-heavy');
    expect(entry!.mode).toBe('autonomous');
  });
});

// --- eforge:region plan-02-request-surfaces-and-pi-ux ---

// --- Helpers for enqueue-route tests (daemon mode requires workerTracker) ---

function makeStubWorkerTracker(): WorkerTracker {
  return {
    spawnWorker(_command: string, _args: string[]): { sessionId: string; pid: number } {
      return { sessionId: 'stub-session', pid: 99999 };
    },
    cancelWorker(_sessionId: string): boolean {
      return false;
    },
  };
}

// --- Route: POST /api/enqueue — landingAutoMerge validation ---

describe('POST /api/enqueue - landingAutoMerge validation', () => {
  it('returns 400 when landingAutoMerge is true and landingAction is merge', async () => {
    await setup({ workerTracker: makeStubWorkerTracker() });

    const res = await post(`http://localhost:${server.port}${API_ROUTES.enqueue}`, {
      source: 'implement a new feature',
      landingAction: 'merge',
      landingAutoMerge: true,
    });
    expect(res.status).toBe(400);

    const data = await res.json() as { error: string };
    expect(data.error).toContain('landingAutoMerge');
    expect(data.error).toContain('pr');
  });

  it('returns 400 when landingAutoMerge is a non-boolean value', async () => {
    await setup({ workerTracker: makeStubWorkerTracker() });

    const res = await post(`http://localhost:${server.port}${API_ROUTES.enqueue}`, {
      source: 'implement a new feature',
      landingAutoMerge: 'yes',
    });
    expect(res.status).toBe(400);

    const data = await res.json() as { error: string };
    expect(data.error).toContain('landingAutoMerge');
    expect(data.error).toContain('boolean');
  });

  it('returns 400 when landingAutoMerge is true and policy is never', async () => {
    const { tmpDir, configDir } = await init();

    // Set landing.pr.autoMerge: never in project config
    await writeFile(resolve(configDir, 'config.yaml'), 'landing:\n  pr:\n    autoMerge: never\n', 'utf-8');

    await start(tmpDir, { workerTracker: makeStubWorkerTracker() });

    const res = await post(`http://localhost:${server.port}${API_ROUTES.enqueue}`, {
      source: 'implement a new feature',
      landingAction: 'pr',
      landingAutoMerge: true,
    });
    expect(res.status).toBe(400);

    const data = await res.json() as { error: string };
    expect(data.error).toContain("never");
  });
});

// ---------------------------------------------------------------------------
// Route: POST /api/playbook/run — landingAutoMerge persistence
// ---------------------------------------------------------------------------

describe('POST /api/playbook/run - landingAutoMerge persistence', () => {
  it('persists landing_auto_merge: true in PRD frontmatter when landingAction pr and landingAutoMerge true are both supplied', async () => {
    const { tmpDir, configDir } = await init();

    const teamDir = resolve(configDir, 'playbooks');
    await mkdir(teamDir, { recursive: true });
    await writeFile(resolve(teamDir, 'my-feature.md'), validPlaybookRaw({ mode: 'autonomous' }), 'utf-8');

    await start(tmpDir, { daemonState: makeDaemonState() });

    const res = await post(`http://localhost:${server.port}${API_ROUTES.playbookRun}`, {
      name: 'my-feature',
      landingAction: 'pr',
      landingAutoMerge: true,
    });
    expect(res.status).toBe(200);

    const data = await res.json() as { kind: string; id: string };
    expect(data.kind).toBe('enqueued');

    // Verify the queued PRD contains both landing: pr and landing_auto_merge: true
    const queueFile = resolve(tmpDir, '.eforge', 'queue', `${data.id}.md`);
    const content = await readFile(queueFile, 'utf-8');
    const frontmatter = content.match(/^---\n([\s\S]*?)\n---/)?.[1];
    expect(frontmatter).toBeDefined();
    expect(frontmatter).toContain('landing: pr');
    expect(frontmatter).toContain('landing_auto_merge: true');
  });

  it('returns 400 when landingAutoMerge is not a boolean', async () => {
    const { tmpDir, configDir } = await init();

    const teamDir = resolve(configDir, 'playbooks');
    await mkdir(teamDir, { recursive: true });
    await writeFile(resolve(teamDir, 'my-feature.md'), validPlaybookRaw({ mode: 'autonomous' }), 'utf-8');

    await start(tmpDir, { daemonState: makeDaemonState() });

    const res = await post(`http://localhost:${server.port}${API_ROUTES.playbookRun}`, {
      name: 'my-feature',
      landingAutoMerge: 'yes',
    });
    expect(res.status).toBe(400);

    const data = await res.json() as { error: string };
    expect(data.error).toContain('landingAutoMerge');
  });

  it('returns 400 when landingAutoMerge is true but landingAction is leave', async () => {
    const { tmpDir, configDir } = await init();

    const teamDir = resolve(configDir, 'playbooks');
    await mkdir(teamDir, { recursive: true });
    await writeFile(resolve(teamDir, 'my-feature.md'), validPlaybookRaw({ mode: 'autonomous' }), 'utf-8');

    await start(tmpDir, { daemonState: makeDaemonState() });

    const res = await post(`http://localhost:${server.port}${API_ROUTES.playbookRun}`, {
      name: 'my-feature',
      landingAction: 'leave',
      landingAutoMerge: true,
    });
    expect(res.status).toBe(400);

    const data = await res.json() as { error: string };
    expect(data.error).toContain('landingAutoMerge');
  });
});

// --- eforge:endregion plan-02-request-surfaces-and-pi-ux ---

// --- eforge:region plan-01-build-dependency-core ---

// ---------------------------------------------------------------------------
// Route: POST /api/enqueue — afterQueueId validation
// ---------------------------------------------------------------------------

// Recording workerTracker so tests can inspect spawned args
function makeRecordingWorkerTracker(): WorkerTracker & { calls: Array<{ command: string; args: string[] }> } {
  const calls: Array<{ command: string; args: string[] }> = [];
  return {
    calls,
    spawnWorker(command: string, args: string[]): { sessionId: string; pid: number } {
      calls.push({ command, args });
      return { sessionId: 'rec-session', pid: 88888 };
    },
    cancelWorker(_sessionId: string): boolean {
      return false;
    },
  };
}

describe('POST /api/enqueue - afterQueueId validation', () => {
  it('returns 400 when afterQueueId is not a string (number)', async () => {
    await setup({ workerTracker: makeStubWorkerTracker() });

    const res = await post(`http://localhost:${server.port}${API_ROUTES.enqueue}`, {
      source: 'implement a new feature',
      afterQueueId: 42,
    });
    expect(res.status).toBe(400);

    const data = await res.json() as { error: string };
    expect(data.error).toContain('afterQueueId');
    expect(data.error).toContain('string');
  });

  it('returns 400 when afterQueueId is not a string (boolean)', async () => {
    await setup({ workerTracker: makeStubWorkerTracker() });

    const res = await post(`http://localhost:${server.port}${API_ROUTES.enqueue}`, {
      source: 'implement a new feature',
      afterQueueId: true,
    });
    expect(res.status).toBe(400);

    const data = await res.json() as { error: string };
    expect(data.error).toContain('afterQueueId');
  });

  it('returns 400 with the invalid id in error text for an unknown afterQueueId', async () => {
    const { tmpDir } = await init();
    // Initialize git repo so loadQueue works
    execFileSync('git', ['init', '-b', 'main'], { cwd: tmpDir });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: tmpDir });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: tmpDir });
    await start(tmpDir, { workerTracker: makeStubWorkerTracker() });

    const res = await post(`http://localhost:${server.port}${API_ROUTES.enqueue}`, {
      source: 'implement a new feature',
      afterQueueId: 'nonexistent-q-abc',
    });
    expect(res.status).toBe(400);

    const data = await res.json() as { error: string };
    expect(data.error).toContain('nonexistent-q-abc');
  });

  it('passes --after <id> to enqueue worker when afterQueueId is valid (active root item)', async () => {
    const { tmpDir, configDir } = await init();
    execFileSync('git', ['init', '-b', 'main'], { cwd: tmpDir });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: tmpDir });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: tmpDir });

    // Write an active PRD to the queue root
    const queueDir = resolve(tmpDir, '.eforge', 'queue');
    await mkdir(queueDir, { recursive: true });
    await writeFile(
      resolve(queueDir, 'active-upstream.md'),
      '---\ntitle: active-upstream\ncreated: 2026-01-01\n---\n\n# Active upstream\n',
      'utf-8',
    );

    const tracker = makeRecordingWorkerTracker();
    await start(tmpDir, { workerTracker: tracker });

    const res = await post(`http://localhost:${server.port}${API_ROUTES.enqueue}`, {
      source: 'implement a dependent feature',
      afterQueueId: 'active-upstream',
    });
    expect(res.status).toBe(200);

    // Worker should have been spawned with --after active-upstream
    const call = tracker.calls.find((c) => c.command === 'enqueue');
    expect(call).toBeDefined();
    expect(call!.args).toContain('--after');
    const afterIdx = call!.args.indexOf('--after');
    expect(call!.args[afterIdx + 1]).toBe('active-upstream');
  });
});

// --- eforge:endregion plan-01-build-dependency-core ---
