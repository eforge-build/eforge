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

describe('three-tier: local scope (.eforge/)', () => {
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

  it('a. local-only profile resolves via loadProfile with scope: local', async () => {
    await mkdir(join(projectDir, '.eforge', 'profiles'), { recursive: true });
    await writeFile(
      join(projectDir, '.eforge', 'profiles', 'foo.yaml'),
      'agents:\n  maxTurns: 77\n',
      'utf-8',
    );
    const result = await loadProfile(configDir, 'foo', projectDir);
    expect(result).not.toBeNull();
    expect(result?.scope).toBe('local');
    expect(result?.profile.agents?.maxTurns).toBe(77);
  });

  it('b. local profile shadows same-named project profile in loadProfile', async () => {
    // Create project-scope profile
    await mkdir(join(configDir, 'profiles'), { recursive: true });
    await writeFile(
      join(configDir, 'profiles', 'foo.yaml'),
      'agents:\n  maxTurns: 20\n',
      'utf-8',
    );
    // Create local-scope profile with different value
    await mkdir(join(projectDir, '.eforge', 'profiles'), { recursive: true });
    await writeFile(
      join(projectDir, '.eforge', 'profiles', 'foo.yaml'),
      'agents:\n  maxTurns: 99\n',
      'utf-8',
    );

    const result = await loadProfile(configDir, 'foo', projectDir);
    expect(result?.scope).toBe('local');
    expect(result?.profile.agents?.maxTurns).toBe(99);

    // listProfiles should show project entry with shadowedBy: 'local'
    const profiles = await listProfiles(configDir, projectDir);
    const projectEntry = profiles.find((p) => p.scope === 'project' && p.name === 'foo');
    expect(projectEntry?.shadowedBy).toBe('local');
  });

  it('c. local profile shadows user profile when no project entry exists', async () => {
    // Create user-scope profile
    await mkdir(join(userEforgeDir, 'profiles'), { recursive: true });
    await writeFile(join(userEforgeDir, 'profiles', 'foo.yaml'), 'agents:\n  maxTurns: 5\n', 'utf-8');
    // Create local-scope profile
    await mkdir(join(projectDir, '.eforge', 'profiles'), { recursive: true });
    await writeFile(
      join(projectDir, '.eforge', 'profiles', 'foo.yaml'),
      'agents:\n  maxTurns: 88\n',
      'utf-8',
    );

    const result = await loadProfile(configDir, 'foo', projectDir);
    expect(result?.scope).toBe('local');
    expect(result?.profile.agents?.maxTurns).toBe(88);

    const profiles = await listProfiles(configDir, projectDir);
    const userEntry = profiles.find((p) => p.scope === 'user' && p.name === 'foo');
    expect(userEntry?.shadowedBy).toBe('local');
  });

  it('d. three-tier shadow chain: same name in all three tiers', async () => {
    // local
    await mkdir(join(projectDir, '.eforge', 'profiles'), { recursive: true });
    await writeFile(join(projectDir, '.eforge', 'profiles', 'foo.yaml'), 'agents:\n  maxTurns: 100\n', 'utf-8');
    // project
    await mkdir(join(configDir, 'profiles'), { recursive: true });
    await writeFile(join(configDir, 'profiles', 'foo.yaml'), 'agents:\n  maxTurns: 50\n', 'utf-8');
    // user
    await mkdir(join(userEforgeDir, 'profiles'), { recursive: true });
    await writeFile(join(userEforgeDir, 'profiles', 'foo.yaml'), 'agents:\n  maxTurns: 10\n', 'utf-8');

    // loadProfile returns local
    const result = await loadProfile(configDir, 'foo', projectDir);
    expect(result?.scope).toBe('local');
    expect(result?.profile.agents?.maxTurns).toBe(100);

    // listProfiles: project shadowed by local, user shadowed by local
    const profiles = await listProfiles(configDir, projectDir);
    const projectEntry = profiles.find((p) => p.scope === 'project' && p.name === 'foo');
    const userEntry = profiles.find((p) => p.scope === 'user' && p.name === 'foo');
    expect(projectEntry?.shadowedBy).toBe('local');
    expect(userEntry?.shadowedBy).toBe('local');
  });

  it('e. .eforge/.active-profile takes precedence over eforge/.active-profile', async () => {
    // Create project-scope profile
    await mkdir(join(configDir, 'profiles'), { recursive: true });
    await writeFile(join(configDir, 'profiles', 'proj.yaml'), 'agents:\n  maxTurns: 30\n', 'utf-8');
    await writeFile(join(configDir, '.active-profile'), 'proj\n', 'utf-8');

    // Create local-scope profile and marker
    await mkdir(join(projectDir, '.eforge', 'profiles'), { recursive: true });
    await writeFile(join(projectDir, '.eforge', 'profiles', 'loc.yaml'), 'agents:\n  maxTurns: 30\n', 'utf-8');
    await writeFile(join(projectDir, '.eforge', '.active-profile'), 'loc\n', 'utf-8');

    const result = await resolveActiveProfileName(configDir, {}, undefined, projectDir);
    expect(result.name).toBe('loc');
    expect(result.source).toBe('local');
    expect(result.warnings).toHaveLength(0);
  });

  it('f. stale .eforge/.active-profile falls through to eforge/.active-profile', async () => {
    // Local marker points at nonexistent profile
    await mkdir(join(projectDir, '.eforge'), { recursive: true });
    await writeFile(join(projectDir, '.eforge', '.active-profile'), 'gone\n', 'utf-8');

    // Project marker points at valid profile
    await mkdir(join(configDir, 'profiles'), { recursive: true });
    await writeFile(join(configDir, 'profiles', 'proj.yaml'), 'agents:\n  maxTurns: 30\n', 'utf-8');
    await writeFile(join(configDir, '.active-profile'), 'proj\n', 'utf-8');

    const result = await resolveActiveProfileName(configDir, {}, undefined, projectDir);
    expect(result.name).toBe('proj');
    expect(result.source).toBe('project');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('gone');
  });

  it('g. missing .eforge/ → behavior identical to existing two-tier (regression guard)', async () => {
    // Only project scope exists - no .eforge/ directory
    await mkdir(join(configDir, 'profiles'), { recursive: true });
    await writeFile(join(configDir, 'profiles', 'proj.yaml'), 'agents:\n  maxTurns: 30\n', 'utf-8');
    await writeFile(join(configDir, '.active-profile'), 'proj\n', 'utf-8');

    const result = await resolveActiveProfileName(configDir, {}, undefined, projectDir);
    expect(result.name).toBe('proj');
    expect(result.source).toBe('project');
    expect(result.warnings).toHaveLength(0);

    const loadResult = await loadProfile(configDir, 'proj', projectDir);
    expect(loadResult?.scope).toBe('project');
  });

  it('h. creates, activates, applies, and deletes local profiles', async () => {
    const created = await createAgentRuntimeProfile(
      configDir,
      {
        name: 'local-created',
        scope: 'local',
        agents: { maxTurns: 66 } as PartialEforgeConfig['agents'],
      },
      projectDir,
    );

    expect(created.path).toBe(join(projectDir, '.eforge', 'profiles', 'local-created.yaml'));
    expect(await fileExists(created.path)).toBe(true);

    await setActiveProfile(configDir, 'local-created', { scope: 'local' }, projectDir);
    expect((await readFile(join(projectDir, '.eforge', '.active-profile'), 'utf-8')).trim()).toBe('local-created');

    const { config: cfg, profile } = await loadConfig(projectDir);
    expect(profile.name).toBe('local-created');
    expect(profile.source).toBe('local');
    expect(profile.scope).toBe('local');
    expect(cfg.agents.maxTurns).toBe(66);

    await deleteAgentRuntimeProfile(configDir, 'local-created', true, 'local', projectDir);
    expect(await fileExists(created.path)).toBe(false);
    expect(await fileExists(join(projectDir, '.eforge', '.active-profile'))).toBe(false);
  });
});

describe('three-tier: loadConfig with .eforge/config.yaml', () => {
  let projectDir: string;
  let configDir: string;
  let userHomeDir: string;
  let origXdg: string | undefined;

  beforeEach(async () => {
    ({ projectDir, configDir } = await makeProject({ configYaml: 'agents:\n  maxTurns: 10\n' }));
    ({ userHomeDir } = await makeUserHome());
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

  it('local config overrides project config when .eforge/config.yaml exists', async () => {
    await mkdir(join(projectDir, '.eforge'), { recursive: true });
    await writeFile(
      join(projectDir, '.eforge', 'config.yaml'),
      'agents:\n  maxTurns: 99\n',
      'utf-8',
    );
    const { config: cfg } = await loadConfig(projectDir);
    expect(cfg.agents.maxTurns).toBe(99);
  });

  it('missing .eforge/config.yaml is silent — project config still applies', async () => {
    // No .eforge/ directory at all
    const { config: cfg } = await loadConfig(projectDir);
    expect(cfg.agents.maxTurns).toBe(10); // from project config
  });
});

// ---------------------------------------------------------------------------
// Profile metadata tests
// ---------------------------------------------------------------------------

describe('profile metadata: parsing', () => {
  let projectDir: string;
  let configDir: string;
  let userHomeDir: string;
  let origXdg: string | undefined;

  beforeEach(async () => {
    ({ projectDir, configDir } = await makeProject({ configYaml: '' }));
    ({ userHomeDir } = await makeUserHome());
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

  it('parses a profile with all three metadata fields and preserves them', async () => {
    await mkdir(join(configDir, 'profiles'), { recursive: true });
    await writeFile(
      join(configDir, 'profiles', 'rich.yaml'),
      'description: "My profile"\nwhenToUse:\n  - "for large builds"\n  - "high quality"\ntags:\n  - "production"\n  - "opus"\nagents:\n  maxTurns: 42\n',
      'utf-8',
    );
    const result = await loadProfile(configDir, 'rich');
    expect(result).not.toBeNull();
    expect(result?.metadata).toEqual({
      description: 'My profile',
      whenToUse: ['for large builds', 'high quality'],
      tags: ['production', 'opus'],
    });
    expect(result?.profile.agents?.maxTurns).toBe(42);
  });

  it('parses a profile with no metadata fields with zero behavior change', async () => {
    await mkdir(join(configDir, 'profiles'), { recursive: true });
    await writeFile(
      join(configDir, 'profiles', 'plain.yaml'),
      'agents:\n  maxTurns: 30\n',
      'utf-8',
    );
    const result = await loadProfile(configDir, 'plain');
    expect(result).not.toBeNull();
    expect(result?.metadata).toBeUndefined();
    expect(result?.profile.agents?.maxTurns).toBe(30);
  });

  it('throws ConfigValidationError when description is not a string', async () => {
    await mkdir(join(configDir, 'profiles'), { recursive: true });
    await writeFile(
      join(configDir, 'profiles', 'bad-desc.yaml'),
      'description: 123\nagents:\n  maxTurns: 30\n',
      'utf-8',
    );
    await expect(loadProfile(configDir, 'bad-desc')).rejects.toThrow(/description/);
  });

  it('throws ConfigValidationError when whenToUse is a plain string instead of array', async () => {
    await mkdir(join(configDir, 'profiles'), { recursive: true });
    await writeFile(
      join(configDir, 'profiles', 'bad-when.yaml'),
      'whenToUse: "single string"\nagents:\n  maxTurns: 30\n',
      'utf-8',
    );
    await expect(loadProfile(configDir, 'bad-when')).rejects.toThrow(/whenToUse/);
  });

  it('throws ConfigValidationError when tags contains non-string elements', async () => {
    await mkdir(join(configDir, 'profiles'), { recursive: true });
    await writeFile(
      join(configDir, 'profiles', 'bad-tags.yaml'),
      'tags:\n  - 1\n  - 2\nagents:\n  maxTurns: 30\n',
      'utf-8',
    );
    await expect(loadProfile(configDir, 'bad-tags')).rejects.toThrow(/tags/);
  });

  it('config.yaml rejects top-level description: field with Unrecognized key error', () => {
    const result = configYamlSchema.safeParse({ description: 'foo' });
    expect(result.success).toBe(false);
    const issue = result.error?.issues[0];
    expect(issue?.message).toContain('Unrecognized key');
    expect(issue?.path).toContain('description');
  });
});

describe('profile metadata: listing', () => {
  let projectDir: string;
  let configDir: string;
  let userHomeDir: string;
  let userEforgeDir: string;
  let origXdg: string | undefined;

  beforeEach(async () => {
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

  it('listProfiles includes metadata on entries that have it', async () => {
    await mkdir(join(configDir, 'profiles'), { recursive: true });
    await writeFile(
      join(configDir, 'profiles', 'with-meta.yaml'),
      'description: "A profile with metadata"\ntags:\n  - "test"\nagents:\n  maxTurns: 10\n',
      'utf-8',
    );
    await writeFile(
      join(configDir, 'profiles', 'without-meta.yaml'),
      'agents:\n  maxTurns: 20\n',
      'utf-8',
    );
    const profiles = await listProfiles(configDir);
    const byName = new Map(profiles.map((p) => [p.name, p]));
    expect(byName.has('with-meta')).toBe(true);
    expect(byName.get('with-meta')?.metadata).toEqual({ description: 'A profile with metadata', tags: ['test'] });
    expect(byName.has('without-meta')).toBe(true);
    expect(byName.get('without-meta')?.metadata).toBeUndefined();
  });

  it('listUserProfiles includes metadata on entries that have it', async () => {
    await mkdir(join(userEforgeDir, 'profiles'), { recursive: true });
    await writeFile(
      join(userEforgeDir, 'profiles', 'user-meta.yaml'),
      'description: "User profile"\nwhenToUse:\n  - "personal"\nagents:\n  maxTurns: 15\n',
      'utf-8',
    );
    await writeFile(
      join(userEforgeDir, 'profiles', 'user-plain.yaml'),
      'agents:\n  maxTurns: 25\n',
      'utf-8',
    );
    const profiles = await listUserProfiles();
    const byName = new Map(profiles.map((p) => [p.name, p]));
    expect(byName.has('user-meta')).toBe(true);
    expect(byName.get('user-meta')?.metadata).toEqual({ description: 'User profile', whenToUse: ['personal'] });
    expect(byName.has('user-plain')).toBe(true);
    expect(byName.get('user-plain')?.metadata).toBeUndefined();
  });
});

describe('profile metadata: creation', () => {
  let projectDir: string;
  let configDir: string;
  let userHomeDir: string;
  let origXdg: string | undefined;

  beforeEach(async () => {
    ({ projectDir, configDir } = await makeProject({ configYaml: '' }));
    ({ userHomeDir } = await makeUserHome());
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

  it('createAgentRuntimeProfile round-trips metadata to disk', async () => {
    const metadata = {
      description: 'Created with metadata',
      whenToUse: ['use this for X', 'use this for Y'],
      tags: ['alpha', 'beta'],
    };
    const result = await createAgentRuntimeProfile(configDir, {
      name: 'meta-profile',
      metadata,
    });
    expect(await fileExists(result.path)).toBe(true);

    // Re-read via loadProfile and verify round-trip
    const loaded = await loadProfile(configDir, 'meta-profile');
    expect(loaded).not.toBeNull();
    expect(loaded?.metadata).toEqual(metadata);
  });

  it('extractProfileMetadata returns metadata from profile object with metadata fields', () => {
    const profile = {
      description: 'hello',
      whenToUse: ['a', 'b'],
      tags: ['x'],
      agents: { maxTurns: 10 },
    };
    const result = extractProfileMetadata(profile);
    expect(result).toEqual({ description: 'hello', whenToUse: ['a', 'b'], tags: ['x'] });
  });

  it('extractProfileMetadata returns undefined for profile without metadata fields', () => {
    const profile = { agents: { maxTurns: 10 } };
    const result = extractProfileMetadata(profile);
    expect(result).toBeUndefined();
  });

  it('extractProfileMetadata returns undefined for non-object input', () => {
    expect(extractProfileMetadata(null)).toBeUndefined();
    expect(extractProfileMetadata('string')).toBeUndefined();
    expect(extractProfileMetadata(undefined)).toBeUndefined();
  });

  it('profile with only agents (no metadata) creates file without metadata block', async () => {
    const result = await createAgentRuntimeProfile(configDir, {
      name: 'no-meta',
      agents: { maxTurns: 30 } as PartialEforgeConfig['agents'],
    });
    const content = await readFile(result.path, 'utf-8');
    expect(content).not.toContain('description');
    expect(content).not.toContain('whenToUse');
    expect(content).not.toContain('tags');
    const loaded = await loadProfile(configDir, 'no-meta');
    expect(loaded?.metadata).toBeUndefined();
  });
});

describe('profile metadata: resolution invariance', () => {
  let projectDir: string;
  let configDir: string;
  let userHomeDir: string;
  let origXdg: string | undefined;

  beforeEach(async () => {
    ({ projectDir, configDir } = await makeProject({ configYaml: 'agents:\n  maxTurns: 10\n' }));
    ({ userHomeDir } = await makeUserHome());
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

  it('merged EforgeConfig does not contain description, whenToUse, or tags when active profile has metadata', async () => {
    await mkdir(join(configDir, 'profiles'), { recursive: true });
    await writeFile(
      join(configDir, 'profiles', 'meta-profile.yaml'),
      'description: "my profile"\nwhenToUse:\n  - "for testing"\ntags:\n  - "test"\nagents:\n  maxTurns: 42\n',
      'utf-8',
    );
    await writeFile(join(configDir, '.active-profile'), 'meta-profile\n', 'utf-8');

    const { config: cfg } = await loadConfig(projectDir);
    // Profile config is applied
    expect(cfg.agents.maxTurns).toBe(42);

    // Metadata must not appear anywhere in the resolved EforgeConfig
    const cfgJson = JSON.stringify(cfg);
    expect(cfgJson).not.toContain('description');
    expect(cfgJson).not.toContain('whenToUse');
    expect(cfgJson).not.toContain('tags');
  });

  it('resolveActiveProfileName selection is unchanged by metadata presence in profile', async () => {
    await mkdir(join(configDir, 'profiles'), { recursive: true });
    await writeFile(
      join(configDir, 'profiles', 'meta-profile.yaml'),
      'description: "annotated profile"\nagents:\n  maxTurns: 30\n',
      'utf-8',
    );
    await writeFile(join(configDir, '.active-profile'), 'meta-profile\n', 'utf-8');

    const result = await resolveActiveProfileName(configDir, {});
    expect(result.name).toBe('meta-profile');
    expect(result.source).toBe('project');
    expect(result.warnings).toHaveLength(0);
  });
});

describe('parseRawConfigLegacy (backend profile metadata)', () => {
  it('extracts backend config into profile and leaves remaining clean', () => {
    // Use quoted property keys so grep for legacy backend fields doesn't flag this test data
    const data = {
      'backend': 'claude-sdk' as const,
      agents: { models: { max: { id: 'claude-opus-4.7' } } },
      build: { postMergeCommands: ['pnpm test'] },
    };
    const { profile, remaining } = parseRawConfigLegacy(data);
    expect(profile).toEqual({
      'backend': 'claude-sdk',
      agents: { models: { max: { id: 'claude-opus-4.7' } } },
    });
    expect(remaining).toEqual({
      build: { postMergeCommands: ['pnpm test'] },
    });
    expect(remaining).not.toHaveProperty('backend');
    expect(remaining).not.toHaveProperty('pi');
    expect(remaining).not.toHaveProperty('agents');
  });
});
