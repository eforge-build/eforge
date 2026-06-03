import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, writeFile, readFile, access, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { useTempDir } from './test-tmpdir.js';
import { openDatabase } from '@eforge-build/monitor/db';
import { startServer, type DaemonState, type MonitorServer, type StartServerOptions } from '@eforge-build/monitor/server';
import { API_ROUTES } from '@eforge-build/client';
import { AutoBuildSupervisor, type AutoBuildQueueMutationReason } from '@eforge-build/monitor/auto-build-supervisor';
import { upsertArtifact, upsertCompletion } from '@eforge-build/engine/artifacts';

import { setupPlaybookApiProject, postJson as post, invalidAcPlaybookRaw } from './playbook-api-helpers.js';
import { validPlaybookRaw } from './playbook-helpers.js';
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

async function expectNoMarkdownFiles(dir: string): Promise<void> {
  try {
    const files = await readdir(dir);
    expect(files.filter((f) => f.endsWith('.md'))).toHaveLength(0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

// --- eforge:region playbook-api-run-profile-suite ---
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
    expect(data.error).toContain('missing-upstream');
    expect(data.error).toContain('unknown queue item');

    const queueDir = resolve(tmpDir, '.eforge', 'queue');
    await expect(readdir(queueDir)).rejects.toThrow();
    expect(autoBuildWakeReasons).toEqual([]);
  });


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


  it('writes dependent PRD to waiting/ when autonomous upstream is active (in queue root)', async () => {
    const { tmpDir, configDir } = await init();

    // Write a playbook to use as the dependent
    const teamDir = resolve(configDir, 'playbooks');
    await mkdir(teamDir, { recursive: true });
    await writeFile(resolve(teamDir, 'my-dependent.md'), validPlaybookRaw({ name: 'my-dependent', mode: 'autonomous' }), 'utf-8');

    // Write an active PRD directly to the queue root (simulating an in-progress upstream)
    const queueDir = resolve(tmpDir, '.eforge', 'queue');
    await mkdir(queueDir, { recursive: true });
    const upstreamId = 'active-upstream-for-playbook';
    await writeFile(
      resolve(queueDir, `${upstreamId}.md`),
      `---\ntitle: Active Upstream\ncreated: 2026-01-01\n---\n\n# Active Upstream\n`,
      'utf-8',
    );

    await start(tmpDir, { daemonState: makeDaemonState() });

    const res = await post(`http://localhost:${server!.port}${API_ROUTES.playbookRun}`, {
      name: 'my-dependent',
      afterQueueId: upstreamId,
    });
    expect(res.status).toBe(200);

    const data = await res.json() as { kind: string; id: string };
    expect(data.kind).toBe('enqueued');

    // Dependent must be in waiting/ not queue root
    const waitingFile = resolve(queueDir, 'waiting', `${data.id}.md`);
    await expect(access(waitingFile)).resolves.toBeUndefined();
    // Must NOT be in queue root
    await expect(access(resolve(queueDir, `${data.id}.md`))).rejects.toThrow();

    const content = await readFile(waitingFile, 'utf-8');
    expect(content).toContain('depends_on');
    expect(content).toContain(upstreamId);

    expect(autoBuildWakeReasons).toContain('playbook-enqueue');
  });

  it('writes dependent PRD to queue root when autonomous upstream is completed with usable artifact', async () => {
    const { tmpDir, configDir } = await init();

    const teamDir = resolve(configDir, 'playbooks');
    await mkdir(teamDir, { recursive: true });
    await writeFile(resolve(teamDir, 'my-dependent.md'), validPlaybookRaw({ name: 'my-dependent', mode: 'autonomous' }), 'utf-8');

    // Record a usable artifact for a completed upstream (no queue file — already completed)
    const upstreamId = 'completed-upstream-with-artifact';
    const now = new Date().toISOString();
    await upsertArtifact(tmpDir, {
      prdId: upstreamId,
      artifactBranch: `eforge/${upstreamId}`,
      commitSha: 'abc123',
      resolvedBase: 'main',
      landingAction: 'leave',
      status: 'built',
      recordedAt: now,
      updatedAt: now,
    });

    await start(tmpDir, { daemonState: makeDaemonState() });

    const res = await post(`http://localhost:${server!.port}${API_ROUTES.playbookRun}`, {
      name: 'my-dependent',
      afterQueueId: upstreamId,
    });
    expect(res.status).toBe(200);

    const data = await res.json() as { kind: string; id: string };
    expect(data.kind).toBe('enqueued');

    const queueDir = resolve(tmpDir, '.eforge', 'queue');
    // Dependent must be in queue root (NOT waiting/) because upstream is already completed
    const queueFile = resolve(queueDir, `${data.id}.md`);
    await expect(access(queueFile)).resolves.toBeUndefined();
    // Must NOT be in waiting/
    const waitingFile = resolve(queueDir, 'waiting', `${data.id}.md`);
    await expect(access(waitingFile)).rejects.toThrow();

    const content = await readFile(queueFile, 'utf-8');
    expect(content).toContain('depends_on');
    expect(content).toContain(upstreamId);

    expect(autoBuildWakeReasons).toContain('playbook-enqueue');
  });

  it('returns 404 and does not enqueue when autonomous upstream is in failed/ directory', async () => {
    const { tmpDir, configDir } = await init();

    const teamDir = resolve(configDir, 'playbooks');
    await mkdir(teamDir, { recursive: true });
    await writeFile(resolve(teamDir, 'my-dependent.md'), validPlaybookRaw({ name: 'my-dependent', mode: 'autonomous' }), 'utf-8');

    // Write an upstream PRD to the failed/ directory
    const failedDir = resolve(tmpDir, '.eforge', 'queue', 'failed');
    await mkdir(failedDir, { recursive: true });
    const upstreamId = 'failed-upstream';
    await writeFile(
      resolve(failedDir, `${upstreamId}.md`),
      `---\ntitle: Failed Upstream\ncreated: 2026-01-01\n---\n\n# Failed Upstream\n`,
      'utf-8',
    );

    await start(tmpDir, { daemonState: makeDaemonState() });

    const res = await post(`http://localhost:${server!.port}${API_ROUTES.playbookRun}`, {
      name: 'my-dependent',
      afterQueueId: upstreamId,
    });
    expect(res.status).toBe(404);

    const data = await res.json() as { error: string };
    expect(data.error).toContain(upstreamId);

    // No dependent should have been written
    const queueDir = resolve(tmpDir, '.eforge', 'queue');
    const files = await readdir(queueDir);
    expect(files.filter((f) => f.endsWith('.md'))).toHaveLength(0);
    await expectNoMarkdownFiles(resolve(queueDir, 'waiting'));
    expect(autoBuildWakeReasons).toEqual([]);
  });

  it('returns 404 and does not enqueue when autonomous upstream is in skipped/ directory', async () => {
    const { tmpDir, configDir } = await init();

    const teamDir = resolve(configDir, 'playbooks');
    await mkdir(teamDir, { recursive: true });
    await writeFile(resolve(teamDir, 'my-dependent.md'), validPlaybookRaw({ name: 'my-dependent', mode: 'autonomous' }), 'utf-8');

    // Write an upstream PRD to the skipped/ directory
    const skippedDir = resolve(tmpDir, '.eforge', 'queue', 'skipped');
    await mkdir(skippedDir, { recursive: true });
    const upstreamId = 'skipped-upstream';
    await writeFile(
      resolve(skippedDir, `${upstreamId}.md`),
      `---\ntitle: Skipped Upstream\ncreated: 2026-01-01\n---\n\n# Skipped Upstream\n`,
      'utf-8',
    );

    await start(tmpDir, { daemonState: makeDaemonState() });

    const res = await post(`http://localhost:${server!.port}${API_ROUTES.playbookRun}`, {
      name: 'my-dependent',
      afterQueueId: upstreamId,
    });
    expect(res.status).toBe(404);

    const data = await res.json() as { error: string };
    expect(data.error).toContain(upstreamId);

    // No dependent should have been written
    const queueDir = resolve(tmpDir, '.eforge', 'queue');
    const files = await readdir(queueDir);
    expect(files.filter((f) => f.endsWith('.md'))).toHaveLength(0);
    await expectNoMarkdownFiles(resolve(queueDir, 'waiting'));
    expect(autoBuildWakeReasons).toEqual([]);
  });

  it('returns 404 and does not enqueue when autonomous upstream completed without usable artifact', async () => {
    const { tmpDir, configDir } = await init();

    const teamDir = resolve(configDir, 'playbooks');
    await mkdir(teamDir, { recursive: true });
    await writeFile(resolve(teamDir, 'my-dependent.md'), validPlaybookRaw({ name: 'my-dependent', mode: 'autonomous' }), 'utf-8');

    // Record completion without artifact for the upstream
    const upstreamId = 'completed-no-artifact-upstream';
    const now = new Date().toISOString();
    await upsertCompletion(tmpDir, {
      prdId: upstreamId,
      status: 'completed',
      artifactAvailable: false,
      completedAt: now,
      updatedAt: now,
    });

    await start(tmpDir, { daemonState: makeDaemonState() });

    const res = await post(`http://localhost:${server!.port}${API_ROUTES.playbookRun}`, {
      name: 'my-dependent',
      afterQueueId: upstreamId,
    });
    expect(res.status).toBe(404);

    const data = await res.json() as { error: string };
    expect(data.error).toContain(upstreamId);

    // No dependent should have been written
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



// --- eforge:endregion playbook-api-run-profile-suite ---
