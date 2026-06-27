import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { summarizeExtensionContributionManifest, resolveExtensionContributionInvocation } from '@eforge-build/client';
import { buildExtensionContributionManifest } from '@eforge-build/engine/extensions/manifest.js';
import { dispatchExtensionAction } from '@eforge-build/engine/extensions/action-runtime.js';
import { createExtensionRecorder } from '@eforge-build/engine/extensions/recorder.js';
import type { NativeExtensionRegistry } from '@eforge-build/engine/extensions/types.js';
import extension from '../eforge/extensions/eforge-playbooks/index.js';

const tempDirs: string[] = [];
const previousXdgConfigHome = process.env.XDG_CONFIG_HOME;

function recordPlaybooks(options: { planningCapability?: boolean } = {}): NativeExtensionRegistry {
  const { api, state } = createExtensionRecorder('eforge-playbooks', '/repo/eforge/extensions/eforge-playbooks/index.ts');
  extension(api as never);
  return {
    ...state,
    candidates: [],
    extensions: options.planningCapability ? [{
      name: 'eforge-plan',
      path: '/repo/eforge/extensions/eforge-plan/index.ts',
      scope: 'project-local',
      status: 'loaded',
      source: 'explicit',
      trust: 'trusted',
      trustState: 'not-required',
      diagnostics: [],
      capabilities: [{ name: 'eforge.plan.planning-workstation', version: '1.0.0' }],
    } as never] : [],
  };
}

function emptyRegistry(): NativeExtensionRegistry {
  const { state } = createExtensionRecorder('empty', '/repo/empty/index.ts');
  return { ...state, candidates: [], extensions: [] };
}

async function makeProject(): Promise<{ cwd: string; configDir: string }> {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-playbook-contributions-'));
  tempDirs.push(cwd);
  process.env.XDG_CONFIG_HOME = resolve(cwd, '.xdg');
  return { cwd, configDir: resolve(cwd, 'eforge') };
}

function rawPlaybook(name: string, mode: 'autonomous' | 'planning' = 'autonomous'): string {
  return [
    '---',
    `name: ${name}`,
    `description: ${name} description`,
    'scope: project-local',
    `mode: ${mode}`,
    'profile: contribution-profile',
    '---',
    '',
    '## Goal',
    '',
    `Ship ${name}.`,
    '',
    '## Acceptance criteria',
    '',
    '- `pnpm type-check` exits 0.',
    '',
    '## Notes for the planner',
    '',
    'Use generic extension contribution invocation.',
    '',
  ].join('\n');
}

async function invokeThroughManifest(options: {
  registry: NativeExtensionRegistry;
  cwd: string;
  configDir: string;
  id: string;
  kind?: 'action' | 'command';
  input?: Record<string, unknown>;
  buildQueue?: Parameters<typeof dispatchExtensionAction>[1]['buildQueue'];
}) {
  const manifest = buildExtensionContributionManifest(options.registry);
  const resolved = resolveExtensionContributionInvocation(manifest, {
    kind: options.kind,
    id: options.id,
    input: options.input ?? {},
    requestedBy: { host: 'cli' },
  });
  const result = await dispatchExtensionAction(options.registry, {
    actionId: resolved.target.actionId,
    input: resolved.target.input,
    requestedBy: resolved.target.requestedBy,
    cwd: options.cwd,
    configDir: options.configDir,
    timeoutMs: 1000,
    buildQueue: options.buildQueue,
  });
  return { resolved, result };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  if (previousXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = previousXdgConfigHome;
});

describe('eforge-playbooks generic extension contribution flows', () => {
  it('discovers list/show metadata through the generic contribution manifest', () => {
    const manifest = buildExtensionContributionManifest(recordPlaybooks());
    const ids = manifest.actions.map((entry) => entry.id).sort();

    expect(ids).toEqual(expect.arrayContaining([
      'eforge-playbooks:list-playbooks',
      'eforge-playbooks:save-playbook',
      'eforge-playbooks:run-playbook',
    ]));
    expect(manifest.integrationCommands.map((entry) => entry.id)).toEqual(expect.arrayContaining(['eforge-playbooks:list-playbooks']));
    expect(manifest.consoleContributions.map((entry) => entry.id)).toContain('eforge-playbooks:playbook-management');

    const summary = summarizeExtensionContributionManifest(manifest, { extensionName: 'eforge-playbooks', kind: 'command', includeInputSchema: true });
    expect(summary.entries.map((entry) => entry.id)).toEqual(expect.arrayContaining(['eforge-playbooks:list-playbooks', 'eforge-playbooks:run-playbook']));
    expect(summary.entries.find((entry) => entry.id === 'eforge-playbooks:run-playbook')).toMatchObject({ kind: 'command', actionId: 'eforge-playbooks:run-playbook', actionBacked: true });
  });

  it('invokes save, list, autonomous run, and planning run only through resolved generic contributions', async () => {
    const project = await makeProject();
    const registry = recordPlaybooks({ planningCapability: true });

    const save = await invokeThroughManifest({
      registry,
      ...project,
      kind: 'command',
      id: 'eforge-playbooks:save-playbook',
      input: { scope: 'project-local', raw: rawPlaybook('flow-auto'), overwrite: false },
    });
    expect(save.resolved.target).toMatchObject({ kind: 'command', actionId: 'eforge-playbooks:save-playbook', requestedBy: { host: 'cli', commandId: 'eforge-playbooks:save-playbook' } });
    expect(save.result).toMatchObject({ kind: 'success', output: { path: expect.stringContaining('flow-auto.md') } });

    const list = await invokeThroughManifest({ registry, ...project, kind: 'action', id: 'eforge-playbooks:list-playbooks' });
    expect(list.result).toMatchObject({ kind: 'success', output: { playbooks: [expect.objectContaining({ name: 'flow-auto', source: 'project-local' })] } });

    const enqueueCalls: unknown[] = [];
    const run = await invokeThroughManifest({
      registry,
      ...project,
      kind: 'command',
      id: 'eforge-playbooks:run-playbook',
      input: { name: 'flow-auto', landingAction: 'pr', landingAutoMerge: true },
      buildQueue: () => ({ enqueue: async (request) => { enqueueCalls.push(request); return { sessionId: 'queued-session', pid: 1234, autoBuild: false }; } }),
    });
    expect(run.result).toMatchObject({ kind: 'success', output: { kind: 'enqueued', sessionId: 'queued-session', autoBuild: false } });
    expect(enqueueCalls).toHaveLength(1);
    expect(enqueueCalls[0]).toMatchObject({ profile: 'contribution-profile', landingAction: 'pr', landingAutoMerge: true });

    await invokeThroughManifest({
      registry,
      ...project,
      id: 'eforge-playbooks:save-playbook',
      kind: 'command',
      input: { scope: 'project-local', raw: rawPlaybook('flow-planning', 'planning'), overwrite: false },
    });
    const planning = await invokeThroughManifest({ registry, ...project, kind: 'command', id: 'eforge-playbooks:run-playbook', input: { name: 'flow-planning' } });
    expect(planning.result).toMatchObject({
      kind: 'success',
      output: {
        kind: 'requires-agent',
        planningEntry: {
          actionId: 'eforge-plan:open-planning-entry',
          workstationId: 'eforge-plan:planning-workstation',
          workstationUrl: '/console/workstations/eforge-plan%3Aplanning-workstation',
          seed: { profile: 'contribution-profile' },
        },
      },
    });
  });

  it('has no playbook contributions when the extension is absent or disabled', () => {
    const manifest = buildExtensionContributionManifest(emptyRegistry());
    const summary = summarizeExtensionContributionManifest(manifest, { search: 'playbook', kind: 'all' });

    expect(manifest.actions).toEqual([]);
    expect(manifest.integrationCommands).toEqual([]);
    expect(manifest.consoleContributions).toEqual([]);
    expect(summary.entries).toEqual([]);
    expect(() => resolveExtensionContributionInvocation(manifest, { kind: 'command', id: 'eforge-playbooks:list-playbooks', input: {}, requestedBy: { host: 'cli' } })).toThrow('Unknown extension integration command');
  });
});
