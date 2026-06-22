import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dispatchExtensionAction } from '@eforge-build/engine/extensions/action-runtime.js';
import type { NativeExtensionRegistry } from '@eforge-build/engine/extensions/types.js';
import { rawPlaybook, record, withTempProject, writePlaybook } from './helpers.js';

function withCapability(registry: NativeExtensionRegistry): NativeExtensionRegistry {
  return { ...registry, extensions: [{ name: 'eforge-plan', path: '/ext/eforge-plan', scope: 'project-local', status: 'loaded', source: 'explicit', trust: 'trusted', trustState: 'not-required', diagnostics: [], capabilities: [{ name: 'eforge.plan.planning-mode-playbook', version: '1.0.0' }] } as any] };
}

async function run(cwd: string, input: Record<string, unknown>, opts: { capability?: boolean; enqueue?: (req: any) => Promise<any> } = {}) {
  const calls: any[] = [];
  const registry = opts.capability ? withCapability(record()) : record();
  const result = await dispatchExtensionAction(registry, {
    actionId: 'eforge-playbooks:run-playbook', input, requestedBy: { host: 'cli' }, cwd, configDir: resolve(cwd, 'eforge'), timeoutMs: 1000,
    buildQueue: () => ({ enqueue: async (req) => { calls.push(req); return opts.enqueue ? opts.enqueue(req) : { sessionId: 's1', pid: 123, autoBuild: true }; } }),
  });
  return { result, calls };
}

describe('run-playbook action', () => {
  it('enqueues autonomous playbooks with inherited and supplied queue fields', async () => {
    await withTempProject(async (cwd) => {
      await writePlaybook(cwd, 'project-local', 'auto', rawPlaybook({ name: 'auto', scope: 'project-local', profile: 'errand', postMerge: ['pnpm build'] }));
      const { result, calls } = await run(cwd, { name: 'auto', afterQueueId: 'q1', landingAction: 'pr', landingAutoMerge: true });
      expect(result).toMatchObject({ kind: 'success', output: { kind: 'enqueued', id: 's1', sessionId: 's1', autoBuild: true } });
      expect(calls[0]).toMatchObject({ profile: 'errand', postMerge: ['pnpm build'], afterQueueId: 'q1', landingAction: 'pr', landingAutoMerge: true });
      expect(calls[0].source).toContain('## Goal');
    });
  });

  it('blocks bad AC, mode mismatch, and enqueue failures as invalid input', async () => {
    await withTempProject(async (cwd) => {
      await writePlaybook(cwd, 'project-local', 'bad', rawPlaybook({ name: 'bad', scope: 'project-local', ac: '- `pnpm test`.' }));
      expect((await run(cwd, { name: 'bad' })).result.kind).toBe('invalid-input');
      await writePlaybook(cwd, 'project-local', 'auto');
      expect((await run(cwd, { name: 'auto', mode: 'planning' })).result.kind).toBe('invalid-input');
      const failed = await run(cwd, { name: 'auto' }, { enqueue: async () => { throw new Error('bad queue'); } });
      expect(failed.result).toMatchObject({ kind: 'invalid-input', message: expect.stringContaining('Playbook enqueue failed:') });
    });
  });

  it('returns planning diagnostics or planning entry without queue calls and with JSON-safe seed', async () => {
    await withTempProject(async (cwd) => {
      await writePlaybook(cwd, 'project-local', 'plan', rawPlaybook({ name: 'plan', scope: 'project-local', mode: 'planning' }));
      const missing = await run(cwd, { name: 'plan' });
      expect(missing.calls).toEqual([]);
      expect(missing.result).toMatchObject({ kind: 'success', output: { kind: 'planning-unavailable', planningEntry: { seed: { sections: expect.any(Object) } } } });
      expect((missing.result as any).output.planningEntry.seed.sections instanceof Map).toBe(false);
      const available = await run(cwd, { name: 'plan' }, { capability: true });
      expect(available.calls).toEqual([]);
      expect(available.result).toMatchObject({ kind: 'success', output: { kind: 'requires-agent', planningEntry: { actionId: 'eforge-plan:open-planning-entry', workstationId: 'eforge-plan:planning-workstation', workstationUrl: '/console/workstations/eforge-plan%3Aplanning-workstation' } } });
    });
  });
});
