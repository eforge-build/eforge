import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  loadConfig,
  resolveActiveProfileName,
  loadProfile,
  listProfiles,
  listUserProfiles,
  resolveUserActiveProfile,
  loadUserProfile,
  setActiveProfile,
  createAgentRuntimeProfile,
  deleteAgentRuntimeProfile,
  getConfigDir,
  parseRawConfigLegacy,
  deriveProfileName,
  extractProfileMetadata,
  configYamlSchema,
  DEFAULT_TIER_MAX_TURNS,
  type PartialEforgeConfig,
} from '@eforge-build/engine/config';
import { makeProject, makeUserHome, fileExists } from './config-backend-profile-helpers';

describe('user-scope: loadProfile', () => {
  let projectDir: string;
  let configDir: string;
  let userHomeDir: string;
  let userEforgeDir: string;
  let origXdg: string | undefined;

  beforeEach(async () => {
    ({ projectDir, configDir } = await makeProject());
    ({ userHomeDir, userEforgeDir } = await makeUserHome());
    origXdg = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = userHomeDir;
  });

  afterEach(async () => {
    if (origXdg === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = origXdg;
    }
    await rm(projectDir, { recursive: true, force: true });
    await rm(userHomeDir, { recursive: true, force: true });
  });

  it('loads user-scope profile when no project profile exists', async () => {
    await mkdir(join(userEforgeDir, 'profiles'), { recursive: true });
    await writeFile(
      join(userEforgeDir, 'profiles', 'shared.yaml'),
      'agents:\n  maxTurns: 50\n',
      'utf-8',
    );
    const result = await loadProfile(configDir, 'shared');
    expect(result).not.toBeNull();
    expect(result?.scope).toBe('user');
    expect(result?.profile.agents?.maxTurns).toBe(50);
  });

  it('project profile shadows user profile on same-name collision', async () => {
    await mkdir(join(configDir, 'profiles'), { recursive: true });
    await writeFile(join(configDir, 'profiles', 'common.yaml'), 'agents:\n  maxTurns: 10\n', 'utf-8');
    await mkdir(join(userEforgeDir, 'profiles'), { recursive: true });
    await writeFile(join(userEforgeDir, 'profiles', 'common.yaml'), 'agents:\n  maxTurns: 99\n', 'utf-8');

    const result = await loadProfile(configDir, 'common');
    expect(result).not.toBeNull();
    expect(result?.scope).toBe('project');
    expect(result?.profile.agents?.maxTurns).toBe(10); // project shadows user
  });
});

describe('user-scope: resolveActiveProfileName', () => {
  let projectDir: string;
  let configDir: string;
  let userHomeDir: string;
  let userEforgeDir: string;
  let origXdg: string | undefined;

  beforeEach(async () => {
    ({ projectDir, configDir } = await makeProject());
    ({ userHomeDir, userEforgeDir } = await makeUserHome());
    origXdg = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = userHomeDir;
  });

  afterEach(async () => {
    if (origXdg === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = origXdg;
    }
    await rm(projectDir, { recursive: true, force: true });
    await rm(userHomeDir, { recursive: true, force: true });
  });

  it('returns source=user-local when project has no marker/config but user marker exists', async () => {
    // Create a profile file in user scope
    await mkdir(join(userEforgeDir, 'profiles'), { recursive: true });
    await writeFile(join(userEforgeDir, 'profiles', 'default.yaml'), 'agents:\n  maxTurns: 30\n', 'utf-8');
    // Write user marker
    await writeFile(join(userEforgeDir, '.active-profile'), 'default\n', 'utf-8');

    const result = await resolveActiveProfileName(configDir, {});
    expect(result).toEqual({ name: 'default', source: 'user-local', warnings: [] });
  });

  it('returns source=project when both project and user markers exist', async () => {
    // Create profiles in both scopes
    await mkdir(join(configDir, 'profiles'), { recursive: true });
    await writeFile(join(configDir, 'profiles', 'proj.yaml'), 'agents:\n  maxTurns: 30\n', 'utf-8');
    await mkdir(join(userEforgeDir, 'profiles'), { recursive: true });
    await writeFile(join(userEforgeDir, 'profiles', 'usr.yaml'), 'agents:\n  maxTurns: 30\n', 'utf-8');
    // Write both markers
    await writeFile(join(configDir, '.active-profile'), 'proj\n', 'utf-8');
    await writeFile(join(userEforgeDir, '.active-profile'), 'usr\n', 'utf-8');

    const result = await resolveActiveProfileName(configDir, {});
    expect(result).toEqual({ name: 'proj', source: 'project', warnings: [] });
  });

  it('user marker wins over user config backend field', async () => {
    await mkdir(join(userEforgeDir, 'profiles'), { recursive: true });
    await writeFile(join(userEforgeDir, 'profiles', 'marker-pick.yaml'), 'agents:\n  maxTurns: 30\n', 'utf-8');
    await writeFile(join(userEforgeDir, 'profiles', 'config-pick.yaml'), 'agents:\n  maxTurns: 30\n', 'utf-8');
    await writeFile(join(userEforgeDir, '.active-profile'), 'marker-pick\n', 'utf-8');

    const result = await resolveActiveProfileName(
      configDir,
      {},
      { backend: 'config-pick' } as PartialEforgeConfig,
    );
    expect(result).toEqual({ name: 'marker-pick', source: 'user-local', warnings: [] });
  });

  it('returns source=none when only user config backend: is set (user-team resolution removed)', async () => {
    await mkdir(join(userEforgeDir, 'profiles'), { recursive: true });
    await writeFile(join(userEforgeDir, 'profiles', 'team-default.yaml'), 'agents:\n  maxTurns: 30\n', 'utf-8');

    // user config backend: field is no longer used for resolution
    const result = await resolveActiveProfileName(
      configDir,
      {},
      { backend: 'team-default' } as PartialEforgeConfig,
    );
    expect(result).toEqual({ name: null, source: 'none', warnings: [] });
  });

  it('project marker can resolve to a user-scope profile file', async () => {
    // Profile exists only in user scope but project marker points to it
    await mkdir(join(userEforgeDir, 'profiles'), { recursive: true });
    await writeFile(join(userEforgeDir, 'profiles', 'shared.yaml'), 'agents:\n  maxTurns: 30\n', 'utf-8');
    await writeFile(join(configDir, '.active-profile'), 'shared\n', 'utf-8');

    const result = await resolveActiveProfileName(configDir, {});
    expect(result).toEqual({ name: 'shared', source: 'project', warnings: [] });
  });
});

describe('user-scope: listProfiles', () => {
  let projectDir: string;
  let configDir: string;
  let userHomeDir: string;
  let userEforgeDir: string;
  let origXdg: string | undefined;

  beforeEach(async () => {
    ({ projectDir, configDir } = await makeProject());
    ({ userHomeDir, userEforgeDir } = await makeUserHome());
    origXdg = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = userHomeDir;
  });

  afterEach(async () => {
    if (origXdg === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = origXdg;
    }
    await rm(projectDir, { recursive: true, force: true });
    await rm(userHomeDir, { recursive: true, force: true });
  });

  it('returns entries from both scopes with correct scope and shadowedBy', async () => {
    await mkdir(join(configDir, 'profiles'), { recursive: true });
    // project:shared uses pi harness
    await writeFile(
      join(configDir, 'profiles', 'shared.yaml'),
      'agents:\n  tiers:\n    planning:\n      harness: pi\n      pi:\n        provider: openrouter\n      model: x\n      effort: high\n',
      'utf-8',
    );
    // project:proj-only uses claude-sdk
    await writeFile(
      join(configDir, 'profiles', 'proj-only.yaml'),
      'agents:\n  tiers:\n    planning:\n      harness: claude-sdk\n      model: claude-opus-4-7\n      effort: high\n',
      'utf-8',
    );
    await mkdir(join(userEforgeDir, 'profiles'), { recursive: true });
    // user:shared uses claude-sdk (shadowed by project:shared which uses pi)
    await writeFile(
      join(userEforgeDir, 'profiles', 'shared.yaml'),
      'agents:\n  tiers:\n    planning:\n      harness: claude-sdk\n      model: claude-opus-4-7\n      effort: high\n',
      'utf-8',
    );
    // user:usr-only uses pi
    await writeFile(
      join(userEforgeDir, 'profiles', 'usr-only.yaml'),
      'agents:\n  tiers:\n    planning:\n      harness: pi\n      pi:\n        provider: zai\n      model: y\n      effort: high\n',
      'utf-8',
    );

    const result = await listProfiles(configDir);
    const byNameAndScope = new Map(result.map((r) => [`${r.scope}:${r.name}`, r]));

    // Project entries
    expect(byNameAndScope.get('project:shared')?.harness).toBe('pi');
    expect(byNameAndScope.get('project:shared')?.shadowedBy).toBeUndefined();
    expect(byNameAndScope.get('project:proj-only')?.harness).toBe('claude-sdk');

    // User entries
    expect(byNameAndScope.get('user:shared')?.harness).toBe('claude-sdk');
    expect(byNameAndScope.get('user:shared')?.shadowedBy).toBe('project');
    expect(byNameAndScope.get('user:usr-only')?.harness).toBe('pi');
    expect(byNameAndScope.get('user:usr-only')?.shadowedBy).toBeUndefined();

    expect(result.length).toBe(4);
  });
});

describe('user-scope: createAgentRuntimeProfile', () => {
  let projectDir: string;
  let configDir: string;
  let userHomeDir: string;
  let userEforgeDir: string;
  let origXdg: string | undefined;

  beforeEach(async () => {
    ({ projectDir, configDir } = await makeProject());
    ({ userHomeDir, userEforgeDir } = await makeUserHome());
    origXdg = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = userHomeDir;
  });

  afterEach(async () => {
    if (origXdg === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = origXdg;
    }
    await rm(projectDir, { recursive: true, force: true });
    await rm(userHomeDir, { recursive: true, force: true });
  });

  it('with scope: user writes file under user config profiles directory', async () => {
    const result = await createAgentRuntimeProfile(configDir, {
      name: 'user-prof',
      scope: 'user',
    });
    expect(result.path).toContain(userHomeDir);
    expect(await fileExists(result.path)).toBe(true);
    // Should NOT exist in project scope
    expect(await fileExists(join(configDir, 'profiles', 'user-prof.yaml'))).toBe(false);
  });
});

describe('user-scope: deleteAgentRuntimeProfile', () => {
  let projectDir: string;
  let configDir: string;
  let userHomeDir: string;
  let userEforgeDir: string;
  let origXdg: string | undefined;

  beforeEach(async () => {
    ({ projectDir, configDir } = await makeProject());
    ({ userHomeDir, userEforgeDir } = await makeUserHome());
    origXdg = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = userHomeDir;
  });

  afterEach(async () => {
    if (origXdg === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = origXdg;
    }
    await rm(projectDir, { recursive: true, force: true });
    await rm(userHomeDir, { recursive: true, force: true });
  });

  it('throws ambiguous error when same name exists in both scopes without scope', async () => {
    await mkdir(join(configDir, 'profiles'), { recursive: true });
    await writeFile(join(configDir, 'profiles', 'dup.yaml'), 'agents:\n  maxTurns: 30\n', 'utf-8');
    await mkdir(join(userEforgeDir, 'profiles'), { recursive: true });
    await writeFile(join(userEforgeDir, 'profiles', 'dup.yaml'), 'agents:\n  maxTurns: 30\n', 'utf-8');

    await expect(deleteAgentRuntimeProfile(configDir, 'dup')).rejects.toThrow(
      /multiple scopes/i,
    );
  });

  it('deletes from specified scope when name exists in both', async () => {
    await mkdir(join(configDir, 'profiles'), { recursive: true });
    await writeFile(join(configDir, 'profiles', 'dup.yaml'), 'agents:\n  maxTurns: 30\n', 'utf-8');
    await mkdir(join(userEforgeDir, 'profiles'), { recursive: true });
    await writeFile(join(userEforgeDir, 'profiles', 'dup.yaml'), 'agents:\n  maxTurns: 30\n', 'utf-8');

    await deleteAgentRuntimeProfile(configDir, 'dup', false, 'user');
    expect(await fileExists(join(userEforgeDir, 'profiles', 'dup.yaml'))).toBe(false);
    expect(await fileExists(join(configDir, 'profiles', 'dup.yaml'))).toBe(true);
  });
});

describe('user-scope: setActiveProfile', () => {
  let projectDir: string;
  let configDir: string;
  let userHomeDir: string;
  let userEforgeDir: string;
  let origXdg: string | undefined;

  beforeEach(async () => {
    // Empty project config — fixture only needs eforge/ to exist; user-scope
    // setActiveProfile tests don't depend on project config content.
    ({ projectDir, configDir } = await makeProject({ configYaml: '' }));
    ({ userHomeDir, userEforgeDir } = await makeUserHome());
    origXdg = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = userHomeDir;
  });

  afterEach(async () => {
    if (origXdg === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = origXdg;
    }
    await rm(projectDir, { recursive: true, force: true });
    await rm(userHomeDir, { recursive: true, force: true });
  });

  it('with scope: user writes the user marker file, not the project marker', async () => {
    // Create profile in user scope
    await mkdir(join(userEforgeDir, 'profiles'), { recursive: true });
    await writeFile(join(userEforgeDir, 'profiles', 'user-default.yaml'), 'agents:\n  maxTurns: 30\n', 'utf-8');

    await setActiveProfile(configDir, 'user-default', { scope: 'user' });

    const userMarker = await readFile(join(userEforgeDir, '.active-profile'), 'utf-8');
    expect(userMarker.trim()).toBe('user-default');
    // Project marker should not exist
    expect(await fileExists(join(configDir, '.active-profile'))).toBe(false);
  });

  it('with scope: user validates profile exists in user scope', async () => {
    await expect(
      setActiveProfile(configDir, 'nonexistent', { scope: 'user' }),
    ).rejects.toThrow(/not found/);
  });

  it('with scope: user can reference a project-scope profile file', async () => {
    // Profile exists only in project scope, but setActiveProfile with scope: user should
    // accept it because profileExistsInAnyScope checks both directories
    await mkdir(join(configDir, 'profiles'), { recursive: true });
    await writeFile(join(configDir, 'profiles', 'proj-only.yaml'), 'agents:\n  maxTurns: 30\n', 'utf-8');

    await setActiveProfile(configDir, 'proj-only', { scope: 'user' });
    const userMarker = await readFile(join(userEforgeDir, '.active-profile'), 'utf-8');
    expect(userMarker.trim()).toBe('proj-only');
  });
});

// ---------------------------------------------------------------------------
// Additional edge case tests for user-scope behavior
// ---------------------------------------------------------------------------

describe('user-scope: resolveActiveProfileName edge cases', () => {
  let projectDir: string;
  let configDir: string;
  let userHomeDir: string;
  let userEforgeDir: string;
  let origXdg: string | undefined;

  beforeEach(async () => {
    ({ projectDir, configDir } = await makeProject());
    ({ userHomeDir, userEforgeDir } = await makeUserHome());
    origXdg = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = userHomeDir;
  });

  afterEach(async () => {
    if (origXdg === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = origXdg;
    }
    await rm(projectDir, { recursive: true, force: true });
    await rm(userHomeDir, { recursive: true, force: true });
  });

  it('stale project marker falls through to user-local when user marker is valid', async () => {
    // Project marker points at a nonexistent profile
    await writeFile(join(configDir, '.active-profile'), 'gone\n', 'utf-8');
    // User marker points at a valid user-scope profile
    await mkdir(join(userEforgeDir, 'profiles'), { recursive: true });
    await writeFile(join(userEforgeDir, 'profiles', 'fallback.yaml'), 'agents:\n  maxTurns: 30\n', 'utf-8');
    await writeFile(join(userEforgeDir, '.active-profile'), 'fallback\n', 'utf-8');

    const result = await resolveActiveProfileName(configDir, {});
    expect(result.name).toBe('fallback');
    expect(result.source).toBe('user-local');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('gone');
  });

  it('stale project marker falls through to missing when no user marker exists (user-team removed)', async () => {
    await writeFile(join(configDir, '.active-profile'), 'gone\n', 'utf-8');
    await mkdir(join(userEforgeDir, 'profiles'), { recursive: true });
    await writeFile(join(userEforgeDir, 'profiles', 'team-default.yaml'), 'agents:\n  maxTurns: 30\n', 'utf-8');

    // user config backend: is no longer used for fallback
    const result = await resolveActiveProfileName(
      configDir,
      {},
      { backend: 'team-default' } as PartialEforgeConfig,
    );
    expect(result.name).toBeNull();
    expect(result.source).toBe('missing');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('gone');
  });

  it('user marker wins when no project marker exists (team resolution removed)', async () => {
    // Project config backend: field no longer affects resolution
    await mkdir(join(configDir, 'profiles'), { recursive: true });
    await writeFile(join(configDir, 'profiles', 'team.yaml'), 'agents:\n  maxTurns: 30\n', 'utf-8');
    // User marker exists
    await mkdir(join(userEforgeDir, 'profiles'), { recursive: true });
    await writeFile(join(userEforgeDir, 'profiles', 'usr.yaml'), 'agents:\n  maxTurns: 30\n', 'utf-8');
    await writeFile(join(userEforgeDir, '.active-profile'), 'usr\n', 'utf-8');

    const result = await resolveActiveProfileName(configDir, { backend: 'team' } as PartialEforgeConfig);
    expect(result).toEqual({ name: 'usr', source: 'user-local', warnings: [] });
  });

  it('returns source=none when all sources are empty', async () => {
    // No markers, no config backend: fields
    const result = await resolveActiveProfileName(configDir, {}, {});
    expect(result).toEqual({ name: null, source: 'none', warnings: [] });
  });

  it('user config backend: field is ignored (user-team source removed)', async () => {
    // User config points at a name — no longer used for resolution
    const result = await resolveActiveProfileName(
      configDir,
      {},
      { backend: 'phantom' } as PartialEforgeConfig,
    );
    expect(result).toEqual({ name: null, source: 'none', warnings: [] });
  });
});

describe('user-scope: deleteAgentRuntimeProfile edge cases', () => {
  let projectDir: string;
  let configDir: string;
  let userHomeDir: string;
  let userEforgeDir: string;
  let origXdg: string | undefined;

  beforeEach(async () => {
    ({ projectDir, configDir } = await makeProject());
    ({ userHomeDir, userEforgeDir } = await makeUserHome());
    origXdg = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = userHomeDir;
  });

  afterEach(async () => {
    if (origXdg === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = origXdg;
    }
    await rm(projectDir, { recursive: true, force: true });
    await rm(userHomeDir, { recursive: true, force: true });
  });

  it('force-deletes user-scope profile and clears user marker', async () => {
    await mkdir(join(userEforgeDir, 'profiles'), { recursive: true });
    await writeFile(join(userEforgeDir, 'profiles', 'active.yaml'), 'agents:\n  maxTurns: 30\n', 'utf-8');
    await writeFile(join(userEforgeDir, '.active-profile'), 'active\n', 'utf-8');

    await deleteAgentRuntimeProfile(configDir, 'active', true, 'user');
    expect(await fileExists(join(userEforgeDir, 'profiles', 'active.yaml'))).toBe(false);
    expect(await fileExists(join(userEforgeDir, '.active-profile'))).toBe(false);
  });

  it('refuses to delete profile active via user marker without force', async () => {
    await mkdir(join(userEforgeDir, 'profiles'), { recursive: true });
    await writeFile(join(userEforgeDir, 'profiles', 'active.yaml'), 'agents:\n  maxTurns: 30\n', 'utf-8');
    await writeFile(join(userEforgeDir, '.active-profile'), 'active\n', 'utf-8');

    await expect(deleteAgentRuntimeProfile(configDir, 'active', false, 'user')).rejects.toThrow(
      /currently active/,
    );
  });

  it('infers user scope when profile only exists in user scope', async () => {
    await mkdir(join(userEforgeDir, 'profiles'), { recursive: true });
    await writeFile(join(userEforgeDir, 'profiles', 'usr-only.yaml'), 'agents:\n  maxTurns: 30\n', 'utf-8');

    await deleteAgentRuntimeProfile(configDir, 'usr-only');
    expect(await fileExists(join(userEforgeDir, 'profiles', 'usr-only.yaml'))).toBe(false);
  });

  it('errors when profile not found in specified scope even if it exists in the other', async () => {
    await mkdir(join(configDir, 'profiles'), { recursive: true });
    await writeFile(join(configDir, 'profiles', 'proj.yaml'), 'agents:\n  maxTurns: 30\n', 'utf-8');

    await expect(deleteAgentRuntimeProfile(configDir, 'proj', false, 'user')).rejects.toThrow(
      /not found in user scope/,
    );
  });
});

describe('user-scope: loadConfig integration', () => {
  let projectDir: string;
  let configDir: string;
  let userHomeDir: string;
  let userEforgeDir: string;
  let origXdg: string | undefined;

  beforeEach(async () => {
    ({ projectDir, configDir } = await makeProject({ configYaml: 'agents:\n  maxTurns: 10\n' }));
    ({ userHomeDir, userEforgeDir } = await makeUserHome());
    origXdg = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = userHomeDir;
  });

  afterEach(async () => {
    if (origXdg === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = origXdg;
    }
    await rm(projectDir, { recursive: true, force: true });
    await rm(userHomeDir, { recursive: true, force: true });
  });

  it('user-scope profile is loaded when user marker is active and no project marker exists', async () => {
    await mkdir(join(userEforgeDir, 'profiles'), { recursive: true });
    await writeFile(
      join(userEforgeDir, 'profiles', 'user-override.yaml'),
      'agents:\n  maxTurns: 55\n',
      'utf-8',
    );
    await writeFile(join(userEforgeDir, '.active-profile'), 'user-override\n', 'utf-8');

    const { config: cfg } = await loadConfig(projectDir);
    // cfg.backend is no longer part of EforgeConfig; verify agents settings from the profile
    expect(cfg.agents.maxTurns).toBe(55);
  });
});

// ---------------------------------------------------------------------------
// Auto-migration: eforge/backends/ -> eforge/profiles/
// ---------------------------------------------------------------------------

describe('user-scope helpers without configDir', () => {
  let userHomeDir: string;
  let userEforgeDir: string;
  let origXdg: string | undefined;

  beforeEach(async () => {
    ({ userHomeDir, userEforgeDir } = await makeUserHome());
    origXdg = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = userHomeDir;
  });

  afterEach(async () => {
    if (origXdg === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = origXdg;
    }
    await rm(userHomeDir, { recursive: true, force: true });
  });

  it('listUserProfiles returns user-scope yaml entries with correct harness and scope, skipping non-yaml', async () => {
    await mkdir(join(userEforgeDir, 'profiles'), { recursive: true });
    await writeFile(
      join(userEforgeDir, 'profiles', 'claude-sdk-4-7.yaml'),
      'agents:\n  tiers:\n    planning:\n      harness: claude-sdk\n      model: claude-opus-4-7\n      effort: high\n',
      'utf-8',
    );
    await writeFile(
      join(userEforgeDir, 'profiles', 'pi-codex-5-5.yaml'),
      'agents:\n  tiers:\n    planning:\n      harness: pi\n      pi:\n        provider: openai\n      model: codex-5.5\n      effort: high\n',
      'utf-8',
    );
    await writeFile(join(userEforgeDir, 'profiles', 'README.md'), '# skip me', 'utf-8');

    const result = await listUserProfiles();
    expect(result.length).toBe(2);
    const byName = new Map(result.map((r) => [r.name, r]));
    expect(byName.get('claude-sdk-4-7')?.harness).toBe('claude-sdk');
    expect(byName.get('claude-sdk-4-7')?.scope).toBe('user');
    expect(byName.get('pi-codex-5-5')?.harness).toBe('pi');
    expect(byName.get('pi-codex-5-5')?.scope).toBe('user');
  });

  it('listUserProfiles returns [] when user profiles directory is empty', async () => {
    await mkdir(join(userEforgeDir, 'profiles'), { recursive: true });
    const result = await listUserProfiles();
    expect(result).toEqual([]);
  });

  it('resolveUserActiveProfile returns { name, source: user-local, warnings: [] } for valid user marker', async () => {
    await mkdir(join(userEforgeDir, 'profiles'), { recursive: true });
    await writeFile(
      join(userEforgeDir, 'profiles', 'claude-sdk-4-7.yaml'),
      'agents:\n  maxTurns: 30\n',
      'utf-8',
    );
    await writeFile(join(userEforgeDir, '.active-profile'), 'claude-sdk-4-7\n', 'utf-8');

    const result = await resolveUserActiveProfile();
    expect(result).toEqual({ name: 'claude-sdk-4-7', source: 'user-local', warnings: [] });
  });

  it('resolveUserActiveProfile returns { name: null, source: none, warnings: [stale warning] } for stale user marker', async () => {
    // Marker file present, but profile yaml does not exist
    await writeFile(join(userEforgeDir, '.active-profile'), 'ghost-profile\n', 'utf-8');

    const result = await resolveUserActiveProfile();
    expect(result.name).toBeNull();
    expect(result.source).toBe('none');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('ghost-profile');
    expect(result.warnings[0]).toContain('no profile file exists');
  });

  it('resolveUserActiveProfile returns { name: null, source: none, warnings: [] } when no marker exists', async () => {
    const result = await resolveUserActiveProfile();
    expect(result).toEqual({ name: null, source: 'none', warnings: [] });
  });

  it('loadUserProfile returns { profile, scope: user } for a present yaml and null for an absent name', async () => {
    await mkdir(join(userEforgeDir, 'profiles'), { recursive: true });
    await writeFile(
      join(userEforgeDir, 'profiles', 'claude-sdk-4-7.yaml'),
      'agents:\n  maxTurns: 42\n',
      'utf-8',
    );

    const present = await loadUserProfile('claude-sdk-4-7');
    expect(present).not.toBeNull();
    expect(present?.scope).toBe('user');
    expect(present?.profile.agents?.maxTurns).toBe(42);

    const absent = await loadUserProfile('nonexistent');
    expect(absent).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseRawConfigLegacy
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Three-tier (local/.eforge/) tests
// ---------------------------------------------------------------------------
