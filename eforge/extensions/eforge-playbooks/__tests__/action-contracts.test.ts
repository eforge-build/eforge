import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dispatchExtensionAction } from '@eforge-build/engine/extensions/action-runtime.js';
import { rawPlaybook, record, withTempProject, writePlaybook } from './helpers.js';

async function dispatch(cwd: string, actionId: string, input: Record<string, unknown>) {
  return dispatchExtensionAction(record(), {
    actionId: `eforge-playbooks:${actionId}`,
    input,
    requestedBy: { host: 'test' },
    cwd,
    configDir: resolve(cwd, 'eforge'),
    timeoutMs: 1000,
  });
}

function expectJsonSafe(value: unknown): void {
  expect(value).not.toBeInstanceOf(Map);
  expect(value).not.toBeUndefined();
  if (Array.isArray(value)) {
    for (const entry of value) expectJsonSafe(entry);
    return;
  }
  if (value !== null && typeof value === 'object') {
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    for (const entry of Object.values(value)) expectJsonSafe(entry);
  }
}

describe('eforge-playbooks action contracts', () => {
  it('resolves inventory by precedence while preserving default shadows and exact-scope errors', async () => {
    await withTempProject(async (cwd) => {
      process.env.XDG_CONFIG_HOME = resolve(cwd, '.xdg');
      await writePlaybook(cwd, 'user', 'shared', rawPlaybook({ name: 'shared', scope: 'user', mode: 'autonomous' }));
      await writePlaybook(cwd, 'project-team', 'shared', rawPlaybook({ name: 'shared', scope: 'project-team', mode: 'autonomous', profile: 'team' }));
      await writePlaybook(cwd, 'project-local', 'local-plan', rawPlaybook({ name: 'local-plan', scope: 'project-local', mode: 'planning' }));

      const list = await dispatch(cwd, 'list-playbooks', { mode: 'autonomous' });
      expect(list).toMatchObject({
        kind: 'success',
        output: {
          playbooks: [expect.objectContaining({ name: 'shared', source: 'project-team', profile: 'team' })],
        },
      });
      expect((list as any).output.playbooks[0].shadows).toEqual([
        expect.objectContaining({ source: 'user', path: expect.stringContaining('shared.md') }),
      ]);

      const scoped = await dispatch(cwd, 'list-playbooks', { scope: 'project-local' });
      expect((scoped as any).output.playbooks.map((entry: { name: string }) => entry.name)).toEqual(['local-plan']);

      const shown = await dispatch(cwd, 'show-playbook', { name: 'shared' });
      expect(shown).toMatchObject({ kind: 'success', output: { source: { source: 'project-team', path: expect.stringContaining('shared.md') } } });
      expect(isAbsolute((shown as any).output.source.path)).toBe(true);

      const missingExactScope = await dispatch(cwd, 'show-playbook', { name: 'shared', scope: 'project-local' });
      expect(missingExactScope).toMatchObject({ kind: 'invalid-input', message: expect.stringContaining('shared') });
    });
  });

  it('supports raw, nested, and flattened save payloads while validating overwrite and name mismatches', async () => {
    await withTempProject(async (cwd) => {
      const raw = await dispatch(cwd, 'save-playbook', {
        scope: 'project-local',
        raw: rawPlaybook({ name: 'raw-saved', scope: 'project-local' }),
      });
      expect(raw).toMatchObject({ kind: 'success', output: { path: expect.stringContaining('raw-saved.md') } });

      const overwritten = await dispatch(cwd, 'save-playbook', {
        scope: 'project-local',
        raw: rawPlaybook({ name: 'raw-saved', scope: 'project-local', profile: 'updated' }),
      });
      expect(overwritten.kind).toBe('success');
      expect(await readFile((overwritten as any).output.path, 'utf-8')).toContain('profile: updated');

      const nested = await dispatch(cwd, 'save-playbook', {
        scope: 'project-team',
        name: 'nested-saved',
        playbook: {
          frontmatter: { name: 'nested-saved', description: 'Nested saved', mode: 'planning', profile: 'planner' },
          body: { goal: 'Plan it.', acceptanceCriteria: '- `pnpm test` exits 0.', plannerNotes: 'Investigate first.' },
        },
      });
      expect(nested).toMatchObject({ kind: 'success', output: { path: expect.stringContaining('nested-saved.md') } });
      expect(await readFile((nested as any).output.path, 'utf-8')).toContain('scope: project-team');

      const flattened = await dispatch(cwd, 'save-playbook', {
        scope: 'user',
        name: 'flat-saved',
        description: 'Flat saved',
        mode: 'autonomous',
        goal: 'Ship a flat payload.',
        acceptanceCriteria: '- `pnpm type-check` exits 0.',
        plannerNotes: 'Use public APIs.',
      });
      expect(flattened).toMatchObject({ kind: 'success', output: { path: expect.stringContaining('flat-saved.md') } });

      const mismatch = await dispatch(cwd, 'save-playbook', {
        scope: 'project-local',
        name: 'expected-name',
        raw: rawPlaybook({ name: 'actual-name', scope: 'project-local' }),
      });
      expect(mismatch).toMatchObject({ kind: 'invalid-input', message: expect.stringContaining('does not match') });

      const multipleVariants = await dispatch(cwd, 'save-playbook', {
        scope: 'project-local',
        raw: rawPlaybook({ name: 'too-many', scope: 'project-local' }),
        goal: 'Also flattened.',
      });
      expect(multipleVariants).toMatchObject({ kind: 'invalid-input', message: expect.stringContaining('exactly one save payload variant') });
    });
  });

  it('returns JSON-safe planning-unavailable metadata with capability guidance and no queue handoff', async () => {
    await withTempProject(async (cwd) => {
      await writePlaybook(cwd, 'project-local', 'planning-json', rawPlaybook({ name: 'planning-json', scope: 'project-local', mode: 'planning', profile: 'planner' }));
      const result = await dispatch(cwd, 'run-playbook', { name: 'planning-json' });

      expect(result).toMatchObject({
        kind: 'success',
        output: {
          kind: 'planning-unavailable',
          requiredCapability: { provider: 'eforge-plan', id: 'eforge.plan.planning-workstation', range: '>=1.0.0' },
          message: expect.stringMatching(/Install\/load eforge-plan.*trust.*reload/i),
          diagnostics: [expect.objectContaining({ capabilityName: 'eforge.plan.planning-workstation', requiredVersion: '>=1.0.0' })],
          planningEntry: { seed: { profile: 'planner', sections: expect.any(Object) } },
        },
      });
      expectJsonSafe((result as any).output);
    });
  });
});
