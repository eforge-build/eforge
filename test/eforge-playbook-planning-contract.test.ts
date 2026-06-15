import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '@eforge-build/monitor/db';
import { upsertTrustRecord } from '@eforge-build/engine/extensions';
import { startServer, type MonitorServer } from '@eforge-build/monitor/server';
import { API_ROUTES } from '@eforge-build/client';
import { useTempDir } from './test-tmpdir.js';
import { postJson, setupProject, validAutonomousPlaybookRaw, validPlanningPlaybookRaw } from './daemon-session-plan-routes-helpers.js';

const makeTempDir = useTempDir('eforge-playbook-planning-contract-');
const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const EFORGE_PLAN_EXTENSION_PATH = resolve(REPO_ROOT, 'eforge/extensions/eforge-plan');

let server: MonitorServer | undefined;

afterEach(async () => {
  await server?.stop();
  server = undefined;
});

async function writeTeamPlaybook(tmpDir: string, name: string, raw: string): Promise<void> {
  const playbooksDir = resolve(tmpDir, 'eforge', 'playbooks');
  await mkdir(playbooksDir, { recursive: true });
  await writeFile(resolve(playbooksDir, `${name}.md`), raw, 'utf-8');
}

async function start(tmpDir: string): Promise<MonitorServer> {
  const db = openDatabase(resolve(tmpDir, 'monitor.db'));
  server = await startServer(db, 0, { strictPort: true, cwd: tmpDir });
  return server;
}

async function runPlaybook(name: string): Promise<{ status: number; data: any }> {
  const res = await postJson(`http://localhost:${server!.port}${API_ROUTES.playbookRun}`, { name });
  return { status: res.status, data: await res.json() };
}

async function writeConfig(tmpDir: string, body: string): Promise<void> {
  await writeFile(resolve(tmpDir, 'eforge', 'config.yaml'), body, 'utf-8');
}

async function writePlanningExtension(tmpDir: string, scope: 'project-local' | 'project-team', opts: { capabilityVersion?: string; body?: string } = {}): Promise<string> {
  const extensionDir = scope === 'project-local'
    ? resolve(tmpDir, '.eforge', 'extensions', 'eforge-plan')
    : resolve(tmpDir, 'eforge', 'extensions', 'eforge-plan');
  await mkdir(extensionDir, { recursive: true });
  await writeFile(resolve(extensionDir, 'package.json'), JSON.stringify({
    type: 'module',
    eforge: {
      extension: {
        name: 'eforge-plan',
        entrypoint: 'index.js',
        capabilities: [
          { name: 'eforge.plan.planning-workstation', version: '1.0.0' },
          { name: 'eforge.plan.planning-mode-playbook', version: opts.capabilityVersion ?? '1.0.0' },
        ],
      },
    },
  }), 'utf-8');
  await writeFile(resolve(extensionDir, 'index.js'), opts.body ?? 'export default function extension() {}\n', 'utf-8');
  return extensionDir;
}

describe('planning-mode playbooks depend on the eforge-plan planning contract', () => {
  it('returns generic planning entry metadata when eforge-plan provides the required capability', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);
    await writeConfig(tmpDir, `extensions:\n  paths:\n    - ${JSON.stringify(EFORGE_PLAN_EXTENSION_PATH)}\n`);
    await writeTeamPlaybook(tmpDir, 'my-planning', validPlanningPlaybookRaw({ name: 'my-planning' }));
    await start(tmpDir);

    const { status, data } = await runPlaybook('my-planning');

    expect(status).toBe(200);
    expect(data).toMatchObject({
      kind: 'requires-agent',
      mode: 'planning',
      name: 'my-planning',
      requiredCapability: { name: 'eforge.plan.planning-mode-playbook', version: '>=1.0.0' },
      planningEntry: {
        actionId: 'eforge-plan:open-planning-entry',
        integrationCommandId: 'eforge-plan:open-planning-entry',
        deepLinkId: 'eforge-plan:planning-workstation',
        workstationId: 'eforge-plan:planning-workstation',
        workstationUrl: '/console/workstations/eforge-plan%3Aplanning-workstation',
      },
    });
    await expect(readdir(resolve(tmpDir, '.eforge', 'queue'))).rejects.toThrow();
  });

  it.each([
    { label: 'disabled', setup: async (tmpDir: string) => { await writeConfig(tmpDir, 'extensions:\n  enabled: false\n'); }, expectedCode: 'extension:disabled', expectedMessage: 'disabled' },
    { label: 'missing', setup: async () => {}, expectedCode: 'extension:dependency-missing', expectedMessage: 'not loaded' },
    { label: 'untrusted', setup: async (tmpDir: string) => { await writePlanningExtension(tmpDir, 'project-team'); }, expectedCode: 'extension:untrusted', expectedMessage: 'untrusted' },
    { label: 'changed', setup: async (tmpDir: string) => { await writePlanningExtension(tmpDir, 'project-team'); await upsertTrustRecord(resolve(tmpDir, '.eforge'), 'eforge-plan', '0'.repeat(64), 'tester'); }, expectedCode: 'extension:trust-changed', expectedMessage: 'changed' },
    { label: 'errored', setup: async (tmpDir: string) => { await writePlanningExtension(tmpDir, 'project-local', { body: 'throw new Error("boom"); export default function extension() {}\n' }); }, expectedCode: 'extension:factory-error', expectedMessage: 'boom' },
    { label: 'capability-incompatible', setup: async (tmpDir: string) => { await writePlanningExtension(tmpDir, 'project-local', { capabilityVersion: '0.9.0' }); }, expectedCode: 'extension:dependency-capability-incompatible', expectedMessage: 'does not satisfy' },
  ])('returns unavailable dependency diagnostics when eforge-plan is $label', async ({ setup, expectedCode, expectedMessage }) => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);
    await setup(tmpDir);
    await writeTeamPlaybook(tmpDir, 'my-planning', validPlanningPlaybookRaw({ name: 'my-planning' }));
    await start(tmpDir);

    const { status, data } = await runPlaybook('my-planning');

    expect(status).toBe(200);
    expect(data).toMatchObject({
      kind: 'planning-unavailable',
      mode: 'planning',
      name: 'my-planning',
      requiredCapability: { name: 'eforge.plan.planning-mode-playbook', version: '>=1.0.0' },
    });
    if (data.kind !== 'planning-unavailable') throw new Error('Expected unavailable response');
    expect(data.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: expectedCode })]));
    expect(data.diagnostics.map((diagnostic) => diagnostic.message).join('\n')).toContain(expectedMessage);
    await expect(readdir(resolve(tmpDir, '.eforge', 'queue'))).rejects.toThrow();
  });

  it('keeps autonomous playbooks on the enqueue path when eforge-plan is unavailable', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);
    await writeConfig(tmpDir, 'extensions:\n  enabled: false\n');
    await writeTeamPlaybook(tmpDir, 'my-auto', validAutonomousPlaybookRaw({ name: 'my-auto' }));
    await start(tmpDir);

    const { status, data } = await runPlaybook('my-auto');

    expect(status).toBe(200);
    expect(data).toMatchObject({ kind: 'enqueued' });
    const queueFiles = await readdir(resolve(tmpDir, '.eforge', 'queue'));
    expect(queueFiles.some((entry) => entry.endsWith('.md'))).toBe(true);
  });
});
