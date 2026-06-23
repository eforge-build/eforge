import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dispatchExtensionAction } from '@eforge-build/engine/extensions/action-runtime.js';
import { createExtensionRecorder } from '@eforge-build/engine/extensions/recorder.js';
import type { LoadedNativeExtension, NativeExtensionRegistry } from '@eforge-build/engine/extensions/types.js';
import eforgePlaybooks from '../eforge/extensions/eforge-playbooks/index.js';

function registry(options: { planCapabilityVersion?: string; planProviderName?: string } = {}): NativeExtensionRegistry {
  const { api, state } = createExtensionRecorder('eforge-playbooks', '/project/eforge/extensions/eforge-playbooks/index.ts');
  eforgePlaybooks(api as never);
  const extensions: LoadedNativeExtension[] = [];
  if (options.planCapabilityVersion !== undefined) {
    const providerName = options.planProviderName ?? 'eforge-plan';
    extensions.push({
      name: providerName,
      path: `/project/eforge/extensions/${providerName}`,
      entrypoint: `/project/eforge/extensions/${providerName}/index.ts`,
      scope: 'project-local',
      source: 'explicit',
      strategy: 'jiti',
      capabilities: [{ name: 'eforge.plan.planning-mode-playbook', version: options.planCapabilityVersion }],
      registrations: { eventHooks: 0, agentRunHooks: 0, policyGates: 0, profileRouters: 0, inputSources: 0, reviewerPerspectives: 0, validationProviders: 0, tools: 0, prdEnrichers: 0, actions: 0, consoleContributions: 0, consoleWorkstations: 0, integrationCommands: 0, deepLinks: 0 },
    });
  }
  return { ...state, extensions, candidates: [] };
}

async function withProject<T>(fn: (cwd: string, configDir: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-playbook-planning-contract-'));
  const configDir = resolve(cwd, 'eforge');
  try {
    return await fn(cwd, configDir);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

async function writePlaybook(cwd: string, name: string, mode: 'planning' | 'autonomous' = 'planning'): Promise<void> {
  const dir = resolve(cwd, '.eforge/playbooks');
  await mkdir(dir, { recursive: true });
  await writeFile(resolve(dir, `${name}.md`), `---\nname: ${name}\ndescription: ${name} description\nscope: project-local\nmode: ${mode}\nprofile: playbook-profile\n---\n\n## Goal\n\nShip ${name}.\n\n## Acceptance criteria\n\n- \`pnpm type-check\` exits 0.\n\n## Notes for the planner\n\nKeep the seed JSON-safe.\n`, 'utf-8');
}

async function run(cwd: string, configDir: string, input: Record<string, unknown>, options: { planCapabilityVersion?: string; planProviderName?: string } = {}) {
  const queueCalls: unknown[] = [];
  const result = await dispatchExtensionAction(registry(options), {
    actionId: 'eforge-playbooks:run-playbook',
    input,
    requestedBy: { host: 'cli', surface: 'test' },
    cwd,
    configDir,
    timeoutMs: 1000,
    buildQueue: () => ({
      enqueue: async (request) => {
        queueCalls.push(request);
        return { sessionId: 'queued-session', pid: 1234, autoBuild: true };
      },
    }),
  });
  return { result, queueCalls };
}

describe('eforge-playbooks planning contract through extension action dispatch', () => {
  it('returns eforge-plan planning entry metadata when the planning capability is available', async () => {
    await withProject(async (cwd, configDir) => {
      await writePlaybook(cwd, 'plan-docs');
      const { result, queueCalls } = await run(cwd, configDir, { name: 'plan-docs', profile: 'override-profile' }, { planCapabilityVersion: '1.0.0' });

      expect(queueCalls).toEqual([]);
      expect(result).toMatchObject({
        kind: 'success',
        output: {
          kind: 'requires-agent',
          requiredCapability: { provider: 'eforge-plan', id: 'eforge.plan.planning-mode-playbook', range: '>=1.0.0' },
          planningEntry: {
            contributionId: 'eforge-plan:open-planning-entry',
            workstationId: 'eforge-plan:planning-workstation',
            workstationUrl: '/console/workstations/eforge-plan%3Aplanning-workstation',
            source: { extension: 'eforge-playbooks', playbook: 'plan-docs' },
            seed: { profile: 'override-profile', seededFrom: 'plan-docs', sections: expect.any(Object) },
          },
        },
      });
      const seed = (result as Extract<typeof result, { kind: 'success' }>).output as { planningEntry: { seed: unknown } };
      expect(JSON.parse(JSON.stringify(seed.planningEntry.seed))).toEqual(seed.planningEntry.seed);
    });
  });

  it('returns unavailable diagnostics and guidance when eforge-plan is missing or incompatible', async () => {
    await withProject(async (cwd, configDir) => {
      await writePlaybook(cwd, 'plan-api');
      for (const options of [{}, { planCapabilityVersion: '0.9.0' }]) {
        const { result, queueCalls } = await run(cwd, configDir, { name: 'plan-api' }, options);
        expect(queueCalls).toEqual([]);
        expect(result).toMatchObject({
          kind: 'success',
          output: {
            kind: 'planning-unavailable',
            requiredCapability: { provider: 'eforge-plan', id: 'eforge.plan.planning-mode-playbook', range: '>=1.0.0' },
            diagnostics: expect.arrayContaining([expect.objectContaining({ capabilityName: 'eforge.plan.planning-mode-playbook' })]),
            message: expect.stringMatching(/Install\/load eforge-plan|reload extensions/i),
          },
        });
      }
    });
  });

  it('returns unavailable diagnostics when another provider declares the planning capability', async () => {
    await withProject(async (cwd, configDir) => {
      await writePlaybook(cwd, 'plan-owned');
      const { result, queueCalls } = await run(cwd, configDir, { name: 'plan-owned' }, { planCapabilityVersion: '1.0.0', planProviderName: 'not-eforge-plan' });

      expect(queueCalls).toEqual([]);
      expect(result).toMatchObject({
        kind: 'success',
        output: {
          kind: 'planning-unavailable',
          requiredCapability: { provider: 'eforge-plan', id: 'eforge.plan.planning-mode-playbook', range: '>=1.0.0' },
          diagnostics: expect.arrayContaining([expect.objectContaining({ providerName: 'eforge-plan', capabilityName: 'eforge.plan.planning-mode-playbook', requiredVersion: '>=1.0.0' })]),
        },
      });
    });
  });

  it('still enqueues autonomous playbooks when the planning capability is unavailable', async () => {
    await withProject(async (cwd, configDir) => {
      await writePlaybook(cwd, 'auto-docs', 'autonomous');
      const { result, queueCalls } = await run(cwd, configDir, { name: 'auto-docs' });

      expect(queueCalls).toHaveLength(1);
      expect(result).toMatchObject({ kind: 'success', output: { kind: 'enqueued', sessionId: 'queued-session' } });
    });
  });
});
