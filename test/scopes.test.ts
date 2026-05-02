/**
 * Tests for @eforge-build/scopes.
 *
 * Covers:
 *   - getScopeDirectory: correct root paths for each tier
 *   - resolveLayeredSingletons: merge order, partial presence, missing files
 *   - resolveNamedSet / listNamedSet: precedence, shadowing, merge order
 *
 * All tests are fixtures-free: each test builds a fresh temp directory tree
 * and writes files programmatically.
 */
import { describe, it, expect } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  SCOPES,
  getScopeDirectory,
  resolveLayeredSingletons,
  resolveNamedSet,
  listNamedSet,
  userEforgeConfigDir,
  type ScopeResolverOpts,
} from '@eforge-build/scopes';
import { useTempDir } from './test-tmpdir.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Build a standard temp tree with all three scope directories.
 * Overrides XDG_CONFIG_HOME so userEforgeConfigDir() resolves inside the
 * temp tree and never touches the developer's real ~/.config/eforge/.
 */
async function makeTree(root: string): Promise<{
  opts: ScopeResolverOpts;
  userRoot: string;
  teamRoot: string;
  localRoot: string;
}> {
  const configDir = resolve(root, 'eforge');
  const cwd = root;
  const xdgConfigHome = resolve(root, 'xdg-config');

  process.env.XDG_CONFIG_HOME = xdgConfigHome;

  const opts: ScopeResolverOpts = { cwd, configDir };

  const userRoot = getScopeDirectory('user', opts);
  const teamRoot = getScopeDirectory('project-team', opts);
  const localRoot = getScopeDirectory('project-local', opts);

  await mkdir(userRoot, { recursive: true });
  await mkdir(teamRoot, { recursive: true });
  await mkdir(localRoot, { recursive: true });

  return { opts, userRoot, teamRoot, localRoot };
}

async function writeArtifact(
  dir: string,
  name: string,
  ext = 'txt',
  content = 'content',
): Promise<string> {
  const path = resolve(dir, `${name}.${ext}`);
  await mkdir(dir, { recursive: true });
  await writeFile(path, content, 'utf-8');
  return path;
}

async function writeSingleton(dir: string, filename: string, content = 'data'): Promise<string> {
  const path = resolve(dir, filename);
  await writeFile(path, content, 'utf-8');
  return path;
}

// ---------------------------------------------------------------------------
// SCOPES constant
// ---------------------------------------------------------------------------

describe('SCOPES constant', () => {
  it('is ordered lowest-to-highest precedence', () => {
    expect(SCOPES).toEqual(['user', 'project-team', 'project-local']);
  });
});

// ---------------------------------------------------------------------------
// getScopeDirectory
// ---------------------------------------------------------------------------

describe('getScopeDirectory', () => {
  const makeTempDir = useTempDir('scopes-dir-');

  it('project-team returns configDir', async () => {
    const root = makeTempDir();
    const { opts } = await makeTree(root);
    expect(getScopeDirectory('project-team', opts)).toBe(opts.configDir);
  });

  it('project-local returns <cwd>/.eforge', async () => {
    const root = makeTempDir();
    const { opts } = await makeTree(root);
    expect(getScopeDirectory('project-local', opts)).toBe(resolve(opts.cwd, '.eforge'));
  });

  it('user returns userEforgeConfigDir() which respects XDG_CONFIG_HOME', () => {
    const xdgBase = makeTempDir();
    process.env.XDG_CONFIG_HOME = xdgBase;
    const opts: ScopeResolverOpts = { cwd: '/some/project', configDir: '/some/project/eforge' };
    const userDir = getScopeDirectory('user', opts);
    expect(userDir).toBe(userEforgeConfigDir());
    expect(userDir).toBe(resolve(xdgBase, 'eforge'));
  });
});

// ---------------------------------------------------------------------------
// resolveLayeredSingletons
// ---------------------------------------------------------------------------

describe('resolveLayeredSingletons', () => {
  const makeTempDir = useTempDir('scopes-singleton-');

  it('returns empty array when no tier has the file', async () => {
    const root = makeTempDir();
    const { opts } = await makeTree(root);
    const result = await resolveLayeredSingletons('config.yaml', opts);
    expect(result).toEqual([]);
  });

  it('returns user tier only when only user has the file', async () => {
    const root = makeTempDir();
    const { opts, userRoot } = await makeTree(root);
    const p = await writeSingleton(userRoot, 'config.yaml', 'user-config');

    const result = await resolveLayeredSingletons('config.yaml', opts);
    expect(result).toHaveLength(1);
    expect(result[0].scope).toBe('user');
    expect(result[0].path).toBe(p);
  });

  it('returns project-team tier only when only team has the file', async () => {
    const root = makeTempDir();
    const { opts, teamRoot } = await makeTree(root);
    const p = await writeSingleton(teamRoot, 'config.yaml', 'team-config');

    const result = await resolveLayeredSingletons('config.yaml', opts);
    expect(result).toHaveLength(1);
    expect(result[0].scope).toBe('project-team');
    expect(result[0].path).toBe(p);
  });

  it('returns project-local tier only when only local has the file', async () => {
    const root = makeTempDir();
    const { opts, localRoot } = await makeTree(root);
    const p = await writeSingleton(localRoot, 'config.yaml', 'local-config');

    const result = await resolveLayeredSingletons('config.yaml', opts);
    expect(result).toHaveLength(1);
    expect(result[0].scope).toBe('project-local');
    expect(result[0].path).toBe(p);
  });

  it('returns all three tiers in merge order (user → project-team → project-local)', async () => {
    const root = makeTempDir();
    const { opts, userRoot, teamRoot, localRoot } = await makeTree(root);
    const userPath = await writeSingleton(userRoot, 'config.yaml', 'user');
    const teamPath = await writeSingleton(teamRoot, 'config.yaml', 'team');
    const localPath = await writeSingleton(localRoot, 'config.yaml', 'local');

    const result = await resolveLayeredSingletons('config.yaml', opts);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ scope: 'user', path: userPath });
    expect(result[1]).toEqual({ scope: 'project-team', path: teamPath });
    expect(result[2]).toEqual({ scope: 'project-local', path: localPath });
  });

  it('returns user and project-local when project-team is absent', async () => {
    const root = makeTempDir();
    const { opts, userRoot, localRoot } = await makeTree(root);
    const userPath = await writeSingleton(userRoot, 'config.yaml', 'user');
    const localPath = await writeSingleton(localRoot, 'config.yaml', 'local');

    const result = await resolveLayeredSingletons('config.yaml', opts);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ scope: 'user', path: userPath });
    expect(result[1]).toEqual({ scope: 'project-local', path: localPath });
  });

  it('returns user and project-team when project-local is absent', async () => {
    const root = makeTempDir();
    const { opts, userRoot, teamRoot } = await makeTree(root);
    const userPath = await writeSingleton(userRoot, 'config.yaml', 'user');
    const teamPath = await writeSingleton(teamRoot, 'config.yaml', 'team');

    const result = await resolveLayeredSingletons('config.yaml', opts);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ scope: 'user', path: userPath });
    expect(result[1]).toEqual({ scope: 'project-team', path: teamPath });
  });

  it('works for arbitrary filenames (not just config.yaml)', async () => {
    const root = makeTempDir();
    const { opts, userRoot } = await makeTree(root);
    const p = await writeSingleton(userRoot, 'active-profile', 'my-profile');

    const result = await resolveLayeredSingletons('active-profile', opts);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe(p);
  });
});

// ---------------------------------------------------------------------------
// resolveNamedSet
// ---------------------------------------------------------------------------

describe('resolveNamedSet', () => {
  const makeTempDir = useTempDir('scopes-named-set-');

  it('returns empty map when all tiers are empty', async () => {
    const root = makeTempDir();
    const { opts } = await makeTree(root);
    const result = await resolveNamedSet('profiles', { ...opts, extension: 'yaml' });
    expect(result.size).toBe(0);
  });

  it('returns user entry when only user tier has files', async () => {
    const root = makeTempDir();
    const { opts, userRoot } = await makeTree(root);
    const p = await writeArtifact(resolve(userRoot, 'profiles'), 'default', 'yaml');

    const result = await resolveNamedSet('profiles', { ...opts, extension: 'yaml' });
    expect(result.size).toBe(1);
    const entry = result.get('default')!;
    expect(entry.scope).toBe('user');
    expect(entry.path).toBe(p);
    expect(entry.shadows).toEqual([]);
  });

  it('returns project-team entry when only team tier has files', async () => {
    const root = makeTempDir();
    const { opts, teamRoot } = await makeTree(root);
    const p = await writeArtifact(resolve(teamRoot, 'profiles'), 'shared', 'yaml');

    const result = await resolveNamedSet('profiles', { ...opts, extension: 'yaml' });
    expect(result.size).toBe(1);
    const entry = result.get('shared')!;
    expect(entry.scope).toBe('project-team');
    expect(entry.path).toBe(p);
    expect(entry.shadows).toEqual([]);
  });

  it('returns project-local entry when only local tier has files', async () => {
    const root = makeTempDir();
    const { opts, localRoot } = await makeTree(root);
    const p = await writeArtifact(resolve(localRoot, 'profiles'), 'override', 'yaml');

    const result = await resolveNamedSet('profiles', { ...opts, extension: 'yaml' });
    expect(result.size).toBe(1);
    const entry = result.get('override')!;
    expect(entry.scope).toBe('project-local');
    expect(entry.path).toBe(p);
    expect(entry.shadows).toEqual([]);
  });

  it('project-local wins over project-team and records shadow chain', async () => {
    const root = makeTempDir();
    const { opts, teamRoot, localRoot } = await makeTree(root);
    await writeArtifact(resolve(teamRoot, 'profiles'), 'fast', 'yaml');
    const localPath = await writeArtifact(resolve(localRoot, 'profiles'), 'fast', 'yaml');

    const result = await resolveNamedSet('profiles', { ...opts, extension: 'yaml' });
    expect(result.size).toBe(1);
    const entry = result.get('fast')!;
    expect(entry.scope).toBe('project-local');
    expect(entry.path).toBe(localPath);
    expect(entry.shadows).toEqual(['project-team']);
  });

  it('project-local wins over user and records shadow chain', async () => {
    const root = makeTempDir();
    const { opts, userRoot, localRoot } = await makeTree(root);
    await writeArtifact(resolve(userRoot, 'profiles'), 'fast', 'yaml');
    const localPath = await writeArtifact(resolve(localRoot, 'profiles'), 'fast', 'yaml');

    const result = await resolveNamedSet('profiles', { ...opts, extension: 'yaml' });
    expect(result.size).toBe(1);
    const entry = result.get('fast')!;
    expect(entry.scope).toBe('project-local');
    expect(entry.path).toBe(localPath);
    expect(entry.shadows).toEqual(['user']);
  });

  it('project-team wins over user and records shadow', async () => {
    const root = makeTempDir();
    const { opts, userRoot, teamRoot } = await makeTree(root);
    await writeArtifact(resolve(userRoot, 'profiles'), 'fast', 'yaml');
    const teamPath = await writeArtifact(resolve(teamRoot, 'profiles'), 'fast', 'yaml');

    const result = await resolveNamedSet('profiles', { ...opts, extension: 'yaml' });
    expect(result.size).toBe(1);
    const entry = result.get('fast')!;
    expect(entry.scope).toBe('project-team');
    expect(entry.path).toBe(teamPath);
    expect(entry.shadows).toEqual(['user']);
  });

  it('project-local shadows both project-team and user (full chain)', async () => {
    const root = makeTempDir();
    const { opts, userRoot, teamRoot, localRoot } = await makeTree(root);
    await writeArtifact(resolve(userRoot, 'profiles'), 'turbo', 'yaml', 'user');
    await writeArtifact(resolve(teamRoot, 'profiles'), 'turbo', 'yaml', 'team');
    const localPath = await writeArtifact(resolve(localRoot, 'profiles'), 'turbo', 'yaml', 'local');

    const result = await resolveNamedSet('profiles', { ...opts, extension: 'yaml' });
    expect(result.size).toBe(1);
    const entry = result.get('turbo')!;
    expect(entry.scope).toBe('project-local');
    expect(entry.path).toBe(localPath);
    expect(entry.shadows).toEqual(['project-team', 'user']);
  });

  it('returns three entries for distinct names across tiers', async () => {
    const root = makeTempDir();
    const { opts, userRoot, teamRoot, localRoot } = await makeTree(root);
    await writeArtifact(resolve(userRoot, 'profiles'), 'user-only', 'yaml');
    await writeArtifact(resolve(teamRoot, 'profiles'), 'team-only', 'yaml');
    await writeArtifact(resolve(localRoot, 'profiles'), 'local-only', 'yaml');

    const result = await resolveNamedSet('profiles', { ...opts, extension: 'yaml' });
    expect(result.size).toBe(3);

    expect(result.get('user-only')!.scope).toBe('user');
    expect(result.get('user-only')!.shadows).toEqual([]);

    expect(result.get('team-only')!.scope).toBe('project-team');
    expect(result.get('team-only')!.shadows).toEqual([]);

    expect(result.get('local-only')!.scope).toBe('project-local');
    expect(result.get('local-only')!.shadows).toEqual([]);
  });

  it('handles partial overlap: shared name plus unique names', async () => {
    const root = makeTempDir();
    const { opts, userRoot, teamRoot, localRoot } = await makeTree(root);

    // 'shared' in all tiers — project-local wins with full shadow chain
    await writeArtifact(resolve(userRoot, 'profiles'), 'shared', 'yaml');
    await writeArtifact(resolve(teamRoot, 'profiles'), 'shared', 'yaml');
    const sharedLocalPath = await writeArtifact(resolve(localRoot, 'profiles'), 'shared', 'yaml');

    // 'user-only' in user only
    await writeArtifact(resolve(userRoot, 'profiles'), 'user-only', 'yaml');

    // 'team-only' in project-team only
    await writeArtifact(resolve(teamRoot, 'profiles'), 'team-only', 'yaml');

    const result = await resolveNamedSet('profiles', { ...opts, extension: 'yaml' });
    expect(result.size).toBe(3);

    const shared = result.get('shared')!;
    expect(shared.scope).toBe('project-local');
    expect(shared.path).toBe(sharedLocalPath);
    expect(shared.shadows).toEqual(['project-team', 'user']);

    expect(result.get('user-only')!.scope).toBe('user');
    expect(result.get('team-only')!.scope).toBe('project-team');
  });

  it('ignores files that do not match the extension filter', async () => {
    const root = makeTempDir();
    const { opts, teamRoot } = await makeTree(root);
    const dir = resolve(teamRoot, 'profiles');
    await mkdir(dir, { recursive: true });
    // Write a .yaml file (should be included) and a .json file (should be ignored)
    await writeFile(resolve(dir, 'included.yaml'), 'data', 'utf-8');
    await writeFile(resolve(dir, 'ignored.json'), 'data', 'utf-8');

    const result = await resolveNamedSet('profiles', { ...opts, extension: 'yaml' });
    expect(result.size).toBe(1);
    expect(result.has('included')).toBe(true);
    expect(result.has('ignored')).toBe(false);
  });

  it('includes all files when no extension filter is provided', async () => {
    const root = makeTempDir();
    const { opts, teamRoot } = await makeTree(root);
    const dir = resolve(teamRoot, 'profiles');
    await mkdir(dir, { recursive: true });
    await writeFile(resolve(dir, 'fast.yaml'), 'data', 'utf-8');
    await writeFile(resolve(dir, 'slow.md'), 'data', 'utf-8');

    const result = await resolveNamedSet('profiles', opts);
    expect(result.size).toBe(2);
    expect(result.has('fast.yaml')).toBe(true);
    expect(result.has('slow.md')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// listNamedSet
// ---------------------------------------------------------------------------

describe('listNamedSet', () => {
  const makeTempDir = useTempDir('scopes-list-');

  it('returns empty array when all tiers are empty', async () => {
    const root = makeTempDir();
    const { opts } = await makeTree(root);
    const result = await listNamedSet('playbooks', { ...opts, extension: 'md' });
    expect(result).toEqual([]);
  });

  it('returns entries sorted alphabetically', async () => {
    const root = makeTempDir();
    const { opts, userRoot } = await makeTree(root);
    const dir = resolve(userRoot, 'playbooks');
    await writeArtifact(dir, 'zebra', 'md');
    await writeArtifact(dir, 'alpha', 'md');
    await writeArtifact(dir, 'mango', 'md');

    const result = await listNamedSet('playbooks', { ...opts, extension: 'md' });
    expect(result.map((e) => e.name)).toEqual(['alpha', 'mango', 'zebra']);
  });

  it('includes name, scope, path, and shadows in each entry', async () => {
    const root = makeTempDir();
    const { opts, userRoot, localRoot } = await makeTree(root);
    await writeArtifact(resolve(userRoot, 'playbooks'), 'my-plan', 'md');
    const localPath = await writeArtifact(resolve(localRoot, 'playbooks'), 'my-plan', 'md');

    const result = await listNamedSet('playbooks', { ...opts, extension: 'md' });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('my-plan');
    expect(result[0].scope).toBe('project-local');
    expect(result[0].path).toBe(localPath);
    expect(result[0].shadows).toEqual(['user']);
  });

  it('returns winning scope for each name in a mixed-tier set', async () => {
    const root = makeTempDir();
    const { opts, userRoot, teamRoot, localRoot } = await makeTree(root);

    // 'shared' in all tiers
    await writeArtifact(resolve(userRoot, 'playbooks'), 'shared', 'md');
    await writeArtifact(resolve(teamRoot, 'playbooks'), 'shared', 'md');
    await writeArtifact(resolve(localRoot, 'playbooks'), 'shared', 'md');

    // 'beta' in user and project-team only
    await writeArtifact(resolve(userRoot, 'playbooks'), 'beta', 'md');
    await writeArtifact(resolve(teamRoot, 'playbooks'), 'beta', 'md');

    // 'gamma' in user only
    await writeArtifact(resolve(userRoot, 'playbooks'), 'gamma', 'md');

    const result = await listNamedSet('playbooks', { ...opts, extension: 'md' });
    expect(result).toHaveLength(3);

    const byName = Object.fromEntries(result.map((e) => [e.name, e]));

    expect(byName['shared'].scope).toBe('project-local');
    expect(byName['shared'].shadows).toEqual(['project-team', 'user']);

    expect(byName['beta'].scope).toBe('project-team');
    expect(byName['beta'].shadows).toEqual(['user']);

    expect(byName['gamma'].scope).toBe('user');
    expect(byName['gamma'].shadows).toEqual([]);
  });
});
