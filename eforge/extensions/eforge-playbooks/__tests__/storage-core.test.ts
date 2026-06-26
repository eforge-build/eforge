import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { copyPlaybookToScope, listPlaybooks, loadPlaybook, movePlaybook, PlaybookNotFoundError, writePlaybook } from '../storage-core.js';
import { parsePlaybook } from '../model.js';
import { rawPlaybook, withTempProject, writePlaybook as writeRawPlaybook } from './helpers.js';

describe('extension-owned playbook storage core', () => {
  it('writes and loads playbooks from each named-set scope', async () => withTempProject(async (cwd, configDir) => {
    process.env.XDG_CONFIG_HOME = `${cwd}/.xdg`;
    for (const scope of ['project-local', 'project-team', 'user'] as const) {
      const written = await writePlaybook({ cwd, configDir, scope, playbook: parsePlaybook(rawPlaybook({ name: `${scope}-demo`, scope })) });
      expect(written.path).toMatch(new RegExp(`${scope}-demo\\.md$`));
      await expect(loadPlaybook({ cwd, configDir, name: `${scope}-demo` })).resolves.toMatchObject({ playbook: { name: `${scope}-demo` } });
    }
  }));

  it('lists by deterministic name with precedence, shadows, profile, warnings, and legacy mode default', async () => withTempProject(async (cwd, configDir) => {
    process.env.XDG_CONFIG_HOME = `${cwd}/.xdg`;
    await writeRawPlaybook(cwd, 'user', 'shared', rawPlaybook({ name: 'shared', scope: 'user', profile: 'user' }));
    await writeRawPlaybook(cwd, 'project-team', 'shared', rawPlaybook({ name: 'shared', scope: 'project-team', profile: 'team' }));
    await writeRawPlaybook(cwd, 'project-local', 'aaa', rawPlaybook({ name: 'aaa', scope: 'project-team' }));
    await writeRawPlaybook(cwd, 'project-team', 'legacy', rawPlaybook({ name: 'legacy', scope: 'project-team' }).replace('mode: autonomous\n', ''));
    const result = await listPlaybooks({ cwd, configDir });
    expect(result.playbooks.map((entry) => entry.name)).toEqual(['aaa', 'legacy', 'shared']);
    expect(result.playbooks.find((entry) => entry.name === 'shared')).toMatchObject({ source: 'project-team', profile: 'team', shadows: [{ source: 'user' }] });
    expect(result.playbooks.find((entry) => entry.name === 'legacy')).toMatchObject({ mode: 'autonomous' });
    expect(result.warnings[0]).toContain('frontmatter scope "project-team" does not match storage tier "project-local"');
  }));

  it('reports absolute shadow paths in precedence order', async () => withTempProject(async (cwd, configDir) => {
    process.env.XDG_CONFIG_HOME = `${cwd}/.xdg`;
    await writeRawPlaybook(cwd, 'user', 'shadowed', rawPlaybook({ name: 'shadowed', scope: 'user' }));
    await writeRawPlaybook(cwd, 'project-team', 'shadowed', rawPlaybook({ name: 'shadowed', scope: 'project-team' }));
    await writeRawPlaybook(cwd, 'project-local', 'shadowed', rawPlaybook({ name: 'shadowed', scope: 'project-local', profile: 'local' }));
    const { playbooks } = await listPlaybooks({ cwd, configDir });
    const entry = playbooks.find((candidate) => candidate.name === 'shadowed');
    expect(entry).toMatchObject({ source: 'project-local', profile: 'local', shadows: [{ source: 'project-team' }, { source: 'user' }] });
    expect(entry?.shadows.map((shadow) => shadow.path)).toEqual([
      expect.stringMatching(/^\//),
      expect.stringMatching(/^\//),
    ]);
    expect(entry?.shadows.map((shadow) => shadow.path.endsWith('/playbooks/shadowed.md'))).toEqual([true, true]);
  }));

  it('moves playbooks, updates scope, and honors overwrite', async () => withTempProject(async (cwd, configDir) => {
    process.env.XDG_CONFIG_HOME = `${cwd}/.xdg`;
    await writeRawPlaybook(cwd, 'project-local', 'move-me');
    await writeRawPlaybook(cwd, 'project-team', 'move-me');
    await expect(movePlaybook({ cwd, configDir, name: 'move-me', fromScope: 'project-local', toScope: 'project-team' })).rejects.toThrow(/already exists/);
    const moved = await movePlaybook({ cwd, configDir, name: 'move-me', fromScope: 'project-local', toScope: 'project-team', overwrite: true });
    expect(parsePlaybook(await readFile(moved.path, 'utf-8')).scope).toBe('project-team');
  }));

  it('rejects same-scope moves before overwrite can remove the source', async () => withTempProject(async (cwd, configDir) => {
    process.env.XDG_CONFIG_HOME = `${cwd}/.xdg`;
    await writeRawPlaybook(cwd, 'project-local', 'same-scope');
    await expect(movePlaybook({ cwd, configDir, name: 'same-scope', fromScope: 'project-local', toScope: 'project-local', overwrite: true })).rejects.toThrow(/same scope/);
    const loaded = await loadPlaybook({ cwd, configDir, name: 'same-scope' });
    expect(loaded.playbook.name).toBe('same-scope');
  }));

  it('rejects playbooks whose storage name and frontmatter name differ', async () => withTempProject(async (cwd, configDir) => {
    process.env.XDG_CONFIG_HOME = `${cwd}/.xdg`;
    await writeRawPlaybook(cwd, 'project-local', 'foo', rawPlaybook({ name: 'bar', scope: 'project-local' }));
    await expect(loadPlaybook({ cwd, configDir, name: 'foo' })).rejects.toThrow(/frontmatter name "bar" does not match requested name "foo"/);
    await expect(movePlaybook({ cwd, configDir, name: 'foo', fromScope: 'project-local', toScope: 'project-team', overwrite: true })).rejects.toThrow(/frontmatter name "bar" does not match requested name "foo"/);
    await expect(copyPlaybookToScope({ cwd, configDir, name: 'foo', targetScope: 'user' })).rejects.toThrow(/frontmatter name "bar" does not match requested name "foo"/);
  }));

  it('reports missing move sources before destination overwrite conflicts', async () => withTempProject(async (cwd, configDir) => {
    process.env.XDG_CONFIG_HOME = `${cwd}/.xdg`;
    await writeRawPlaybook(cwd, 'project-team', 'missing-source');
    await expect(movePlaybook({ cwd, configDir, name: 'missing-source', fromScope: 'project-local', toScope: 'project-team' })).rejects.toThrow(/ENOENT|no such file/);
  }));

  it('copies highest-precedence playbooks and reports missing names', async () => withTempProject(async (cwd, configDir) => {
    process.env.XDG_CONFIG_HOME = `${cwd}/.xdg`;
    await writeRawPlaybook(cwd, 'user', 'copy-me', rawPlaybook({ name: 'copy-me', scope: 'user', profile: 'user' }));
    await writeRawPlaybook(cwd, 'project-team', 'copy-me', rawPlaybook({ name: 'copy-me', scope: 'project-team', profile: 'team' }));
    const copied = await copyPlaybookToScope({ cwd, configDir, name: 'copy-me', targetScope: 'project-local' });
    expect(copied).toMatchObject({ targetScope: 'project-local' });
    expect(parsePlaybook(await readFile(copied.targetPath, 'utf-8'))).toMatchObject({ scope: 'project-local', profile: 'team' });
    await expect(copyPlaybookToScope({ cwd, configDir, name: 'missing', targetScope: 'user' })).rejects.toBeInstanceOf(PlaybookNotFoundError);
  }));
});
