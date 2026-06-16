import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dispatchExtensionAction } from '@eforge-build/engine/extensions/action-runtime.js';
import { createExtensionRecorder } from '@eforge-build/engine/extensions/recorder.js';
import eforgePlanExtension from '../index.js';

async function withTempProject<T>(fn: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-plan-roadmap-actions-'));
  try { return await fn(cwd); } finally { await rm(cwd, { recursive: true, force: true }); }
}

function registry() {
  const { api, state } = createExtensionRecorder('eforge-plan', '/project/eforge/extensions/eforge-plan/index.ts');
  eforgePlanExtension(api as never);
  expect(state.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
  return { ...state, extensions: [], candidates: [] };
}

async function dispatch(cwd: string, actionId: string, input: Record<string, unknown>) {
  return dispatchExtensionAction(registry(), { actionId: `eforge-plan:${actionId}`, input, requestedBy: { host: 'pi' }, cwd, timeoutMs: 1000 });
}

describe('roadmap actions', () => {
  it('reads and updates roadmap state through the action runtime', async () => {
    await withTempProject(async (cwd) => {
      const update = await dispatch(cwd, 'update-roadmap-state', { localFocusContent: '# Focus\n\nAction updated.\n' });
      expect(update).toMatchObject({ kind: 'success', output: { schemaVersion: 1, context: { localSteering: { exists: true, kind: 'local-focus' } } } });
      const get = await dispatch(cwd, 'get-roadmap-state', { includeLocalFocusContent: true });
      expect(get).toMatchObject({ kind: 'success', output: { context: { localSteering: { content: expect.stringContaining('Action updated') } } } });
    });
  });

  it('reports optimistic hash mismatch with expectedLocalFocusSha256 path', async () => {
    await withTempProject(async (cwd) => {
      const result = await dispatch(cwd, 'update-roadmap-state', { localFocusContent: '# Focus\n', expectedLocalFocusSha256: 'not-current' });
      expect(result.kind).not.toBe('success');
      expect(JSON.stringify(result)).toContain('expectedLocalFocusSha256');
    });
  });

  it('rejects update requests without local focus content or shared sources', async () => {
    await withTempProject(async (cwd) => {
      const result = await dispatch(cwd, 'update-roadmap-state', {});
      expect(result.kind).not.toBe('success');
      expect(JSON.stringify(result)).toMatch(/localFocusContent|sharedSources/);
    });
  });

  it('does not write configured shared project files', async () => {
    await withTempProject(async (cwd) => {
      await mkdir(join(cwd, 'docs'), { recursive: true });
      await writeFile(join(cwd, 'docs/shared.md'), '# Shared\n\nOriginal.\n');
      const result = await dispatch(cwd, 'update-roadmap-state', { sharedSources: [{ id: 'shared', path: 'docs/shared.md', label: 'Shared' }] });
      expect(result.kind).toBe('success');
      expect(await readFile(join(cwd, 'docs/shared.md'), 'utf-8')).toBe('# Shared\n\nOriginal.\n');
      expect(JSON.stringify(result)).toContain('Shared');
    });
  });
});
