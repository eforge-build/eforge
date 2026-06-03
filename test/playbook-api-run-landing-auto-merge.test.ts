import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { useTempDir } from './test-tmpdir.js';
import { openDatabase } from '@eforge-build/monitor/db';
import { startServer, type DaemonState, type MonitorServer } from '@eforge-build/monitor/server';
import { API_ROUTES } from '@eforge-build/client';
import { AutoBuildSupervisor, type AutoBuildQueueMutationReason } from '@eforge-build/monitor/auto-build-supervisor';
import { setupPlaybookApiProject, postJson as post } from './playbook-api-helpers.js';
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
  return { autoBuildController: new RecordingAutoBuildSupervisor() };
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

async function start(tmpDir: string): Promise<void> {
  const db = openDatabase(resolve(tmpDir, 'monitor.db'));
  server = await startServer(db, 0, { strictPort: true, cwd: tmpDir, daemonState: makeDaemonState() });
}

async function writeAutonomousPlaybook(configDir: string): Promise<void> {
  const teamDir = resolve(configDir, 'playbooks');
  await mkdir(teamDir, { recursive: true });
  await writeFile(resolve(teamDir, 'my-feature.md'), validPlaybookRaw({ mode: 'autonomous' }), 'utf-8');
}

// --- eforge:region playbook-api-run-landing-auto-merge-suite ---

describe('POST /api/playbook/run - landingAutoMerge persistence', () => {
  it('persists landing_auto_merge: true in PRD frontmatter when landingAction pr and landingAutoMerge true are both supplied', async () => {
    const { tmpDir, configDir } = await init();
    await writeAutonomousPlaybook(configDir);
    await start(tmpDir);

    const res = await post(`http://localhost:${server.port}${API_ROUTES.playbookRun}`, {
      name: 'my-feature',
      landingAction: 'pr',
      landingAutoMerge: true,
    });
    expect(res.status).toBe(200);

    const data = await res.json() as { kind: string; id: string };
    expect(data.kind).toBe('enqueued');

    const queueFile = resolve(tmpDir, '.eforge', 'queue', `${data.id}.md`);
    const content = await readFile(queueFile, 'utf-8');
    const frontmatter = content.match(/^---\n([\s\S]*?)\n---/)?.[1];
    expect(frontmatter).toBeDefined();
    expect(frontmatter).toContain('landing: pr');
    expect(frontmatter).toContain('landing_auto_merge: true');
  });

  it('returns 400 when landingAutoMerge is not a boolean', async () => {
    const { tmpDir, configDir } = await init();
    await writeAutonomousPlaybook(configDir);
    await start(tmpDir);

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
    await writeAutonomousPlaybook(configDir);
    await start(tmpDir);

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

// --- eforge:endregion playbook-api-run-landing-auto-merge-suite ---
