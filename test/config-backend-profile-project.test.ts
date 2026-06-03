import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
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

describe('resolveActiveProfileName', () => {
  let projectDir: string;
  let configDir: string;
  let userHomeDir: string;
  let origXdg: string | undefined;

  beforeEach(async () => {
    ({ projectDir, configDir } = await makeProject({ configYaml: 'agents:\n  maxTurns: 30\n' }));
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

  it('returns source=none when no marker and no matching team profile', async () => {
    const result = await resolveActiveProfileName(configDir, {});
    expect(result).toEqual({ name: null, source: 'none', warnings: [] });
  });

  it('marker present overrides config.yaml backend', async () => {
    // Create a team profile for claude-sdk
    await mkdir(join(configDir, 'profiles'), { recursive: true });
    await writeFile(join(configDir, 'profiles', 'claude-sdk.yaml'), 'agents:\n  maxTurns: 30\n', 'utf-8');
    await writeFile(join(configDir, 'profiles', 'pi-prod.yaml'), 'agents:\n  maxTurns: 30\n', 'utf-8');
    // Write marker pointing at pi-prod
    await writeFile(join(configDir, '.active-profile'), 'pi-prod\n', 'utf-8');

    const result = await resolveActiveProfileName(configDir, { backend: 'claude-sdk' } as unknown as PartialEforgeConfig);
    expect(result).toEqual({ name: 'pi-prod', source: 'project', warnings: [] });
  });

  it('marker absent + no matching profile → source=none (backend: in config.yaml no longer used for resolution)', async () => {
    await mkdir(join(configDir, 'profiles'), { recursive: true });
    await writeFile(join(configDir, 'profiles', 'pi.yaml'), 'agents:\n  maxTurns: 30\n', 'utf-8');

    // Even with a matching profile file, resolution no longer uses config.yaml backend: field
    const result = await resolveActiveProfileName(configDir, { backend: 'pi' } as unknown as PartialEforgeConfig);
    expect(result).toEqual({ name: null, source: 'none', warnings: [] });
  });

  it('unknown profile name in marker returns warning and missing when no user marker', async () => {
    await mkdir(join(configDir, 'profiles'), { recursive: true });
    await writeFile(join(configDir, 'profiles', 'claude-sdk.yaml'), 'agents:\n  maxTurns: 30\n', 'utf-8');
    await writeFile(join(configDir, '.active-profile'), 'nonexistent\n', 'utf-8');

    const result = await resolveActiveProfileName(configDir, {});
    // No team fallback, no user marker → missing
    expect(result.name).toBeNull();
    expect(result.source).toBe('missing');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('nonexistent');
  });

  it('unknown profile name in marker with no team fallback returns name=null source=missing', async () => {
    await writeFile(join(configDir, '.active-profile'), 'nonexistent\n', 'utf-8');

    const result = await resolveActiveProfileName(configDir, {});
    expect(result.name).toBeNull();
    expect(result.source).toBe('missing');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('nonexistent');
  });
});

describe('loadProfile', () => {
  let projectDir: string;
  let configDir: string;
  let userHomeDir: string;
  let origXdg: string | undefined;

  beforeEach(async () => {
    ({ projectDir, configDir } = await makeProject());
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

  it('returns null when profile file missing', async () => {
    const result = await loadProfile(configDir, 'nope');
    expect(result).toBeNull();
  });

  it('parses a valid profile file and returns scope', async () => {
    await mkdir(join(configDir, 'profiles'), { recursive: true });
    await writeFile(
      join(configDir, 'profiles', 'my-profile.yaml'),
      'agents:\n  tiers:\n    planning:\n      harness: claude-sdk\n      model: claude-opus-4-7\n      effort: high\n',
      'utf-8',
    );
    const result = await loadProfile(configDir, 'my-profile');
    expect(result).not.toBeNull();
    expect(result?.profile.agents?.tiers?.planning?.model).toBe('claude-opus-4-7');
    expect(result?.scope).toBe('project');
  });
});

describe('listProfiles', () => {
  let projectDir: string;
  let configDir: string;
  let userHomeDir: string;
  let origXdg: string | undefined;

  beforeEach(async () => {
    ({ projectDir, configDir } = await makeProject());
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

  it('returns [] when no profiles directory exists', async () => {
    const result = await listProfiles(configDir);
    expect(result).toEqual([]);
  });

  it('returns entries for each .yaml file with inferred harness from tier recipes', async () => {
    await mkdir(join(configDir, 'profiles'), { recursive: true });
    // pi-prod: pi harness in tier recipe
    await writeFile(
      join(configDir, 'profiles', 'pi-prod.yaml'),
      'agents:\n  tiers:\n    planning:\n      harness: pi\n      pi:\n        provider: openrouter\n      model: big-model\n      effort: high\n',
      'utf-8',
    );
    // claude: claude-sdk harness in tier recipe
    await writeFile(
      join(configDir, 'profiles', 'claude.yaml'),
      'agents:\n  tiers:\n    planning:\n      harness: claude-sdk\n      model: claude-opus-4-7\n      effort: high\n',
      'utf-8',
    );
    await writeFile(join(configDir, 'profiles', 'README.md'), '# skip me', 'utf-8');

    const result = await listProfiles(configDir);
    const projectEntries = result.filter((r) => r.scope === 'project');
    expect(projectEntries.length).toBe(2);
    const byName = new Map(projectEntries.map((r) => [r.name, r]));
    expect(byName.get('pi-prod')?.harness).toBe('pi');
    expect(byName.get('claude')?.harness).toBe('claude-sdk');
  });
});

describe('setActiveProfile', () => {
  let projectDir: string;
  let configDir: string;
  let userHomeDir: string;
  let origXdg: string | undefined;

  beforeEach(async () => {
    // Empty project config — fixture only needs eforge/ to exist; setActiveProfile
    // tests don't depend on project config content. (Legacy `backend: claude-sdk`
    // was previously here but is now rejected by ConfigMigrationError.)
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

  it('rejects when the profile file is missing', async () => {
    await expect(setActiveProfile(configDir, 'ghost')).rejects.toThrow(/not found/);
  });

  it('writes the marker when the profile exists and merged config validates', async () => {
    await mkdir(join(configDir, 'profiles'), { recursive: true });
    // Write a valid tier-recipe profile
    await writeFile(
      join(configDir, 'profiles', 'my-profile.yaml'),
      'agents:\n  tiers:\n    planning:\n      harness: claude-sdk\n      model: claude-opus-4-7\n      effort: high\n    implementation:\n      harness: claude-sdk\n      model: claude-sonnet-4-6\n      effort: medium\n    review:\n      harness: claude-sdk\n      model: claude-opus-4-7\n      effort: high\n    evaluation:\n      harness: claude-sdk\n      model: claude-opus-4-7\n      effort: high\n',
      'utf-8',
    );

    await setActiveProfile(configDir, 'my-profile');
    const marker = await readFile(join(configDir, '.active-profile'), 'utf-8');
    expect(marker.trim()).toBe('my-profile');
  });
});

describe('createAgentRuntimeProfile', () => {
  let projectDir: string;
  let configDir: string;
  let userHomeDir: string;
  let origXdg: string | undefined;

  beforeEach(async () => {
    ({ projectDir, configDir } = await makeProject());
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

  it('accepts pi profile with pi.provider', async () => {
    const result = await createAgentRuntimeProfile(configDir, {
      name: 'pi-with-provider',
      agents: {
        tiers: {
          planning: { harness: 'pi', pi: { provider: 'openrouter' }, model: 'claude-opus-4-7', effort: 'high' },
          implementation: { harness: 'pi', pi: { provider: 'openrouter' }, model: 'claude-sonnet-4-6', effort: 'medium' },
          review: { harness: 'pi', pi: { provider: 'openrouter' }, model: 'claude-opus-4-7', effort: 'high' },
          evaluation: { harness: 'pi', pi: { provider: 'openrouter' }, model: 'claude-opus-4-7', effort: 'high' },
        },
      } as PartialEforgeConfig['agents'],
    });
    expect(await fileExists(result.path)).toBe(true);
  });

  it('creates a valid pi profile with provider in pi config', async () => {
    const result = await createAgentRuntimeProfile(configDir, {
      name: 'pi-prod',
      agents: {
        tiers: {
          planning: { harness: 'pi', pi: { provider: 'openrouter' }, model: 'anthropic/claude-sonnet-4', effort: 'high' },
          implementation: { harness: 'pi', pi: { provider: 'openrouter' }, model: 'anthropic/claude-sonnet-4', effort: 'medium' },
          review: { harness: 'pi', pi: { provider: 'openrouter' }, model: 'anthropic/claude-sonnet-4', effort: 'high' },
          evaluation: { harness: 'pi', pi: { provider: 'openrouter' }, model: 'anthropic/claude-sonnet-4', effort: 'high' },
        },
      } as PartialEforgeConfig['agents'],
    });
    expect(await fileExists(result.path)).toBe(true);
    const written = await readFile(result.path, 'utf-8');
    expect(written).toContain('harness: pi');
    expect(written).toContain('openrouter');
  });

  it('refuses overwrite without overwrite: true', async () => {
    await createAgentRuntimeProfile(configDir, { name: 'my-profile' });
    await expect(
      createAgentRuntimeProfile(configDir, { name: 'my-profile' }),
    ).rejects.toThrow(/already exists/);
  });

  it('with overwrite: true replaces the file', async () => {
    await createAgentRuntimeProfile(configDir, { name: 'my-profile' });
    const again = await createAgentRuntimeProfile(configDir, {
      name: 'my-profile',
      agents: {
        tiers: {
          planning: { harness: 'pi', pi: { provider: 'openrouter' }, model: 'x', effort: 'high' },
          implementation: { harness: 'pi', pi: { provider: 'openrouter' }, model: 'x', effort: 'medium' },
          review: { harness: 'pi', pi: { provider: 'openrouter' }, model: 'x', effort: 'high' },
          evaluation: { harness: 'pi', pi: { provider: 'openrouter' }, model: 'x', effort: 'high' },
        },
      } as PartialEforgeConfig['agents'],
      overwrite: true,
    });
    const content = await readFile(again.path, 'utf-8');
    expect(content).toContain('harness: pi');
    expect(content).toContain('openrouter');
  });

  it('rejects invalid profile names', async () => {
    await expect(
      createAgentRuntimeProfile(configDir, { name: 'has spaces' }),
    ).rejects.toThrow(/Invalid profile name/);
  });

  it('tier recipe round-trips: writes correct agents.tiers', async () => {
    const result = await createAgentRuntimeProfile(configDir, {
      name: 'mixed',
      agents: {
        tiers: {
          planning: { harness: 'claude-sdk', model: 'claude-opus-4-7', effort: 'high' },
          implementation: { harness: 'pi', pi: { provider: 'openrouter' }, model: 'qwen-coder', effort: 'medium' },
          review: { harness: 'claude-sdk', model: 'claude-opus-4-7', effort: 'high' },
          evaluation: { harness: 'claude-sdk', model: 'claude-opus-4-7', effort: 'high' },
        },
      } as PartialEforgeConfig['agents'],
    });
    expect(await fileExists(result.path)).toBe(true);
    const written = await readFile(result.path, 'utf-8');
    expect(written).toContain('agents:');
    expect(written).toContain('tiers:');
    expect(written).toContain('claude-sdk');
    expect(written).toContain('pi');
    expect(written).toContain('openrouter');
  });

  it('pi tier requires non-empty pi.provider', async () => {
    await expect(
      createAgentRuntimeProfile(configDir, {
        name: 'broken-pi',
        agents: {
          tiers: {
            planning: { harness: 'pi', model: 'x', effort: 'high' }, // missing pi.provider
          },
        } as PartialEforgeConfig['agents'],
      }),
    ).rejects.toThrow(/provider/);
  });

  it('claude-sdk tier cannot include pi config', async () => {
    await expect(
      createAgentRuntimeProfile(configDir, {
        name: 'bad-tier',
        agents: {
          tiers: {
            planning: { harness: 'claude-sdk', pi: { provider: 'x' }, model: 'y', effort: 'high' },
          },
        } as unknown as PartialEforgeConfig['agents'],
      }),
    ).rejects.toThrow();
  });
});

describe('deriveProfileName', () => {
  it('single harness, same model id across all tiers → sanitized model id (strips claude- prefix, dots to dashes)', () => {
    const result = deriveProfileName({
      agents: {
        tiers: {
          planning: { harness: 'claude-sdk', model: 'claude-opus-4-7' },
          implementation: { harness: 'claude-sdk', model: 'claude-opus-4-7' },
          review: { harness: 'claude-sdk', model: 'claude-opus-4-7' },
          evaluation: { harness: 'claude-sdk', model: 'claude-opus-4-7' },
        },
      },
    });
    expect(result).toBe('opus-4-7');
  });

  it('single harness, same model id across tiers, non-claude prefix', () => {
    const result = deriveProfileName({
      agents: {
        tiers: {
          planning: { harness: 'pi', pi: { provider: 'zai' }, model: 'glm-4.6' },
          implementation: { harness: 'pi', pi: { provider: 'zai' }, model: 'glm-4.6' },
          review: { harness: 'pi', pi: { provider: 'zai' }, model: 'glm-4.6' },
          evaluation: { harness: 'pi', pi: { provider: 'zai' }, model: 'glm-4.6' },
        },
      },
    });
    expect(result).toBe('glm-4-6');
  });

  it('single harness, model varies across tiers, claude-sdk harness, no provider → harness name', () => {
    const result = deriveProfileName({
      agents: {
        tiers: {
          planning: { harness: 'claude-sdk', model: 'claude-opus-4-7' },
          implementation: { harness: 'claude-sdk', model: 'claude-sonnet-4-6' },
          review: { harness: 'claude-sdk', model: 'claude-opus-4-7' },
          evaluation: { harness: 'claude-sdk', model: 'claude-opus-4-7' },
        },
      },
    });
    expect(result).toBe('claude-sdk');
  });

  it('single harness, model varies, pi harness with provider → harness-provider', () => {
    const result = deriveProfileName({
      agents: {
        tiers: {
          planning: { harness: 'pi', pi: { provider: 'anthropic' }, model: 'claude-opus-4-7' },
          implementation: { harness: 'pi', pi: { provider: 'anthropic' }, model: 'claude-sonnet-4-6' },
          review: { harness: 'pi', pi: { provider: 'anthropic' }, model: 'claude-opus-4-7' },
          evaluation: { harness: 'pi', pi: { provider: 'anthropic' }, model: 'claude-opus-4-7' },
        },
      },
    });
    expect(result).toBe('pi-anthropic');
  });

  it('multiple harnesses, planning tier uses claude-sdk → mixed-claude-sdk', () => {
    const result = deriveProfileName({
      agents: {
        tiers: {
          planning: { harness: 'claude-sdk', model: 'claude-opus-4-7' },
          implementation: { harness: 'pi', pi: { provider: 'openrouter' }, model: 'qwen-coder' },
          review: { harness: 'claude-sdk', model: 'claude-opus-4-7' },
          evaluation: { harness: 'claude-sdk', model: 'claude-opus-4-7' },
        },
      },
    });
    expect(result).toBe('mixed-claude-sdk');
  });

  it('multiple harnesses, planning tier uses pi → mixed-pi-openrouter', () => {
    const result = deriveProfileName({
      agents: {
        tiers: {
          planning: { harness: 'pi', pi: { provider: 'openrouter' }, model: 'big-model' },
          implementation: { harness: 'claude-sdk', model: 'claude-sonnet-4-6' },
          review: { harness: 'pi', pi: { provider: 'openrouter' }, model: 'big-model' },
          evaluation: { harness: 'pi', pi: { provider: 'openrouter' }, model: 'big-model' },
        },
      },
    });
    expect(result).toBe('mixed-pi-openrouter');
  });
});

describe('deleteAgentRuntimeProfile', () => {
  let projectDir: string;
  let configDir: string;
  let userHomeDir: string;
  let origXdg: string | undefined;

  beforeEach(async () => {
    ({ projectDir, configDir } = await makeProject());
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

  it('refuses to delete the currently active profile without force', async () => {
    await mkdir(join(configDir, 'profiles'), { recursive: true });
    await writeFile(join(configDir, 'profiles', 'active.yaml'), 'agents:\n  maxTurns: 30\n', 'utf-8');
    await writeFile(join(configDir, '.active-profile'), 'active\n', 'utf-8');
    await expect(deleteAgentRuntimeProfile(configDir, 'active')).rejects.toThrow(/currently active/);
  });

  it('with force: true removes the file and clears the marker', async () => {
    await mkdir(join(configDir, 'profiles'), { recursive: true });
    await writeFile(join(configDir, 'profiles', 'active.yaml'), 'agents:\n  maxTurns: 30\n', 'utf-8');
    await writeFile(join(configDir, '.active-profile'), 'active\n', 'utf-8');

    await deleteAgentRuntimeProfile(configDir, 'active', true);
    expect(await fileExists(join(configDir, 'profiles', 'active.yaml'))).toBe(false);
    expect(await fileExists(join(configDir, '.active-profile'))).toBe(false);
  });

  it('errors when the profile file does not exist', async () => {
    await expect(deleteAgentRuntimeProfile(configDir, 'ghost')).rejects.toThrow(/not found/);
  });
});

describe('loadConfig integration with backend profiles', () => {
  let projectDir: string;
  let configDir: string;
  let userHomeDir: string;
  let origXdg: string | undefined;

  beforeEach(async () => {
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
    if (projectDir) {
      await rm(projectDir, { recursive: true, force: true });
    }
    if (userHomeDir) {
      await rm(userHomeDir, { recursive: true, force: true });
    }
  });

  it('no profiles/ dir: resolved config uses project settings without profile', async () => {
    ({ projectDir, configDir } = await makeProject({
      configYaml: 'agents:\n  maxTurns: 25\n',
    }));
    const { config: cfg } = await loadConfig(projectDir);
    expect(cfg.agents.maxTurns).toBe(25);
  });

  it('profile merges on top of project config when marker is active', async () => {
    ({ projectDir, configDir } = await makeProject({
      configYaml: 'agents:\n  maxTurns: 20\n',
    }));
    await mkdir(join(configDir, 'profiles'), { recursive: true });
    await writeFile(
      join(configDir, 'profiles', 'fast.yaml'),
      'agents:\n  maxTurns: 40\n',
      'utf-8',
    );
    // Profile is only loaded when a marker is present
    await writeFile(join(configDir, '.active-profile'), 'fast\n', 'utf-8');
    const { config: cfg } = await loadConfig(projectDir);
    expect(cfg.agents.maxTurns).toBe(40);
  });

  it('active profile tier preserves default implementation maxTurns when omitted', async () => {
    ({ projectDir, configDir } = await makeProject({
      configYaml: 'agents:\n  maxTurns: 30\n',
    }));
    await mkdir(join(configDir, 'profiles'), { recursive: true });
    await writeFile(
      join(configDir, 'profiles', 'combo.yaml'),
      [
        'agents:',
        '  tiers:',
        '    implementation:',
        '      harness: claude-sdk',
        '      model: claude-sonnet-4-6',
        '      effort: medium',
        '',
      ].join('\n'),
      'utf-8',
    );
    await writeFile(join(configDir, '.active-profile'), 'combo\n', 'utf-8');

    const { config: cfg } = await loadConfig(projectDir);
    expect(cfg.agents.maxTurns).toBe(30);
    expect(cfg.agents.tiers.implementation?.maxTurns).toBe(DEFAULT_TIER_MAX_TURNS.implementation);
  });

  it('marker selects specific profile', async () => {
    ({ projectDir, configDir } = await makeProject({
      configYaml: '',
    }));
    await mkdir(join(configDir, 'profiles'), { recursive: true });
    await writeFile(
      join(configDir, 'profiles', 'fast.yaml'),
      'agents:\n  maxTurns: 40\n',
      'utf-8',
    );
    await writeFile(
      join(configDir, 'profiles', 'local.yaml'),
      'agents:\n  maxTurns: 99\n',
      'utf-8',
    );
    await writeFile(join(configDir, '.active-profile'), 'local\n', 'utf-8');

    const { config: cfg } = await loadConfig(projectDir);
    expect(cfg.agents.maxTurns).toBe(99);
  });
});

describe('getConfigDir', () => {
  it('returns null when no config file is found', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'eforge-nocfg-'));
    try {
      const result = await getConfigDir(tmpDir);
      expect(result).toBeNull();
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns the eforge/ directory when config.yaml is present', async () => {
    const { projectDir, configDir } = await makeProject({ configYaml: 'agents:\n  maxTurns: 30\n' });
    try {
      const result = await getConfigDir(projectDir);
      expect(result).toBe(configDir);
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// User-scope backend profile tests
// ---------------------------------------------------------------------------
