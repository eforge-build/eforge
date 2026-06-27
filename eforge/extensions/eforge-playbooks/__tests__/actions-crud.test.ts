import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dispatchExtensionAction } from '@eforge-build/engine/extensions/action-runtime.js';
import { rawPlaybook, record, withTempProject, writePlaybook } from './helpers.js';

async function dispatch(cwd: string, actionId: string, input: Record<string, unknown>) {
  return dispatchExtensionAction(record(), { actionId: `eforge-playbooks:${actionId}`, input, requestedBy: { host: 'cli' }, cwd, configDir: resolve(cwd, 'eforge'), timeoutMs: 1000 });
}

describe('eforge-playbooks CRUD actions', () => {
  it('lists, shows, saves, validates, copies, promotes, and demotes playbooks', async () => {
    await withTempProject(async (cwd) => {
      process.env.XDG_CONFIG_HOME = resolve(cwd, '.xdg');
      await writePlaybook(cwd, 'project-team', 'demo');
      await writePlaybook(cwd, 'project-local', 'demo', rawPlaybook({ name: 'demo', scope: 'project-local', mode: 'planning', profile: 'errand' }));
      const list = await dispatch(cwd, 'list-playbooks', {});
      expect(list).toMatchObject({ kind: 'success', output: { playbooks: [expect.objectContaining({ name: 'demo', source: 'project-local', mode: 'planning', profile: 'errand' })] } });
      const compact = await dispatch(cwd, 'list-playbooks', { includeShadowed: false });
      expect((compact as any).output.playbooks[0].shadows).toEqual([]);
      await expect(dispatch(cwd, 'show-playbook', { name: 'demo' })).resolves.toMatchObject({ kind: 'success', output: { source: { source: 'project-local' } } });
      await expect(dispatch(cwd, 'show-playbook', { name: 'demo', scope: 'project-team' })).resolves.toMatchObject({ kind: 'success', output: { source: { source: 'project-team' } } });
      await expect(dispatch(cwd, 'validate-playbook', { raw: rawPlaybook({ name: 'valid', scope: 'project-local' }) })).resolves.toMatchObject({ kind: 'success', output: { ok: true } });
      await expect(dispatch(cwd, 'validate-playbook', { scope: 'project-team', raw: rawPlaybook({ name: 'valid', scope: 'project-local' }) })).resolves.toMatchObject({ kind: 'success', output: { ok: false, errors: [expect.stringContaining('Scope mismatch')] } });
      await expect(dispatch(cwd, 'validate-playbook', { raw: 'nope' })).resolves.toMatchObject({ kind: 'success', output: { ok: false } });
      const saved = await dispatch(cwd, 'save-playbook', { scope: 'project-local', raw: rawPlaybook({ name: 'saved', scope: 'project-local' }), overwrite: false });
      expect(saved).toMatchObject({ kind: 'success', output: { path: expect.stringContaining('saved.md') } });
      const yamlSafe = await dispatch(cwd, 'save-playbook', { scope: 'project-local', name: 'yaml-safe', description: 'Plan: preserve punctuation safely', mode: 'autonomous', profile: 'team: default', goal: 'Ship it.' });
      expect(yamlSafe).toMatchObject({ kind: 'success', output: { path: expect.stringContaining('yaml-safe.md') } });
      await expect(dispatch(cwd, 'show-playbook', { name: 'yaml-safe', scope: 'project-local' })).resolves.toMatchObject({ kind: 'success', output: { playbook: { description: 'Plan: preserve punctuation safely', profile: 'team: default' } } });
      const newlineDescription = await dispatch(cwd, 'save-playbook', { scope: 'project-local', name: 'newline-description', description: 'bad\nvalue', mode: 'autonomous', goal: 'Ship it.' });
      expect(newlineDescription.kind).toBe('invalid-input');
      const newlineProfile = await dispatch(cwd, 'save-playbook', { scope: 'project-local', name: 'newline-profile', description: 'Profile test', mode: 'autonomous', profile: 'bad\nvalue', goal: 'Ship it.' });
      expect(newlineProfile.kind).toBe('invalid-input');
      const rejected = await dispatch(cwd, 'save-playbook', { scope: 'project-local', raw: rawPlaybook({ name: 'saved', scope: 'project-local' }), overwrite: false });
      expect(rejected.kind).toBe('invalid-input');
      const badAc = await dispatch(cwd, 'save-playbook', { scope: 'project-local', raw: rawPlaybook({ name: 'bad-ac', scope: 'project-local', ac: '- `pnpm test`.' }) });
      expect(badAc.kind).toBe('invalid-input');
      const copied = await dispatch(cwd, 'copy-playbook', { name: 'saved', sourceScope: 'project-local', targetScope: 'user' });
      expect(copied).toMatchObject({ kind: 'success', output: { targetScope: 'user' } });
      await writePlaybook(cwd, 'project-local', 'alias', rawPlaybook({ name: 'frontmatter-name', scope: 'project-local' }));
      expect((await dispatch(cwd, 'copy-playbook', { name: 'alias', sourceScope: 'project-local', targetScope: 'user' })).kind).toBe('invalid-input');
      expect((await dispatch(cwd, 'copy-playbook', { name: 'alias', targetScope: 'user' })).kind).toBe('invalid-input');
      expect(await readFile((copied as any).output.targetPath, 'utf-8')).toContain('scope: user');
      await mkdir(resolve(cwd, 'eforge', 'playbooks'), { recursive: true });
      await expect(dispatch(cwd, 'promote-playbook', { name: 'saved' })).resolves.toMatchObject({ kind: 'success' });
      await expect(dispatch(cwd, 'demote-playbook', { name: 'saved' })).resolves.toMatchObject({ kind: 'success' });
    });
  });
});
