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

describe('auto-migration: backends/ to profiles/', () => {
  let projectDir: string;
  let configDir: string;
  let userXdgDir: string;
  let origXdg: string | undefined;

  beforeEach(async () => {
    ({ projectDir, configDir } = await makeProject({ configYaml: 'agents:\n  maxTurns: 10\n' }));
    origXdg = process.env.XDG_CONFIG_HOME;
    // Use an isolated XDG home to avoid touching real user config
    userXdgDir = await mkdtemp(join(tmpdir(), 'eforge-xdg-'));
    process.env.XDG_CONFIG_HOME = userXdgDir;
  });

  afterEach(async () => {
    if (origXdg === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = origXdg;
    }
    await rm(projectDir, { recursive: true, force: true });
    await rm(userXdgDir, { recursive: true, force: true });
  });

  it('migrates eforge/backends/ to eforge/profiles/ and .active-backend to .active-profile on loadConfig', async () => {
    // Set up legacy layout: eforge/backends/a.yaml + .active-backend
    await mkdir(join(configDir, 'backends'), { recursive: true });
    await writeFile(join(configDir, 'backends', 'a.yaml'), 'agents:\n  maxTurns: 30\n', 'utf-8');
    await writeFile(join(configDir, '.active-backend'), 'a\n', 'utf-8');

    // Invoke loadConfig — migration runs inside and resolves the migrated marker
    const loaded = await loadConfig(projectDir);
    expect(loaded.profile.name).toBe('a');
    expect(loaded.profile.source).toBe('project');
    expect(loaded.profile.scope).toBe('project');
    expect(loaded.config.agents.maxTurns).toBe(30);

    // After migration: profiles/a.yaml exists, backends/ is gone
    expect(await fileExists(join(configDir, 'profiles', 'a.yaml'))).toBe(true);
    expect(await fileExists(join(configDir, 'backends', 'a.yaml'))).toBe(false);
    expect(await fileExists(join(configDir, 'backends'))).toBe(false);

    // Marker migrated: .active-profile exists, .active-backend is gone
    expect(await fileExists(join(configDir, '.active-profile'))).toBe(true);
    const newMarker = await readFile(join(configDir, '.active-profile'), 'utf-8');
    expect(newMarker.trim()).toBe('a');
    expect(await fileExists(join(configDir, '.active-backend'))).toBe(false);
  });

  it('does not touch eforge/backends/ when both backends/ and profiles/ exist, logs warning', async () => {
    // Set up both directories
    await mkdir(join(configDir, 'backends'), { recursive: true });
    await writeFile(join(configDir, 'backends', 'old.yaml'), 'agents:\n  maxTurns: 30\n', 'utf-8');
    await mkdir(join(configDir, 'profiles'), { recursive: true });
    await writeFile(join(configDir, 'profiles', 'new.yaml'), 'agents:\n  maxTurns: 30\n', 'utf-8');

    // Invoke loadConfig — migration should skip with warning
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      await loadConfig(projectDir);
      const warningText = stderrWrite.mock.calls.map((call) => String(call[0])).join('');
      expect(warningText).toContain('Both eforge/backends/ and eforge/profiles/ exist');
      expect(warningText).toContain('Migration skipped');
    } finally {
      stderrWrite.mockRestore();
    }

    // Both directories still exist unchanged
    expect(await fileExists(join(configDir, 'backends', 'old.yaml'))).toBe(true);
    expect(await fileExists(join(configDir, 'profiles', 'new.yaml'))).toBe(true);
  });

  it('is idempotent: subsequent loadConfig calls do not re-migrate', async () => {
    // Set up already-migrated layout: profiles/ only, no backends/
    await mkdir(join(configDir, 'profiles'), { recursive: true });
    await writeFile(join(configDir, 'profiles', 'a.yaml'), 'agents:\n  maxTurns: 30\n', 'utf-8');
    await writeFile(join(configDir, '.active-profile'), 'a\n', 'utf-8');

    // Call loadConfig twice
    await loadConfig(projectDir);
    await loadConfig(projectDir);

    // Still only profiles/ exists
    expect(await fileExists(join(configDir, 'profiles', 'a.yaml'))).toBe(true);
    expect(await fileExists(join(configDir, 'backends'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Auto-migration: user-scope ~/.config/eforge/backends/ -> profiles/
// ---------------------------------------------------------------------------

describe('auto-migration: user-scope backends/ to profiles/', () => {
  let projectDir: string;
  let userXdgDir: string;
  let origXdg: string | undefined;

  beforeEach(async () => {
    ({ projectDir } = await makeProject({ configYaml: 'agents:\n  maxTurns: 10\n' }));
    userXdgDir = await mkdtemp(join(tmpdir(), 'eforge-user-xdg-'));
    origXdg = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = userXdgDir;
  });

  afterEach(async () => {
    if (origXdg === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = origXdg;
    }
    await rm(projectDir, { recursive: true, force: true });
    await rm(userXdgDir, { recursive: true, force: true });
  });

  it('migrates ~/.config/eforge/backends/ to ~/.config/eforge/profiles/ and .active-backend to .active-profile on loadConfig', async () => {
    const userEforgeDir = join(userXdgDir, 'eforge');
    await mkdir(join(userEforgeDir, 'backends'), { recursive: true });
    await writeFile(join(userEforgeDir, 'backends', 'shared.yaml'), 'agents:\n  maxTurns: 30\n', 'utf-8');
    await writeFile(join(userEforgeDir, '.active-backend'), 'shared\n', 'utf-8');

    const loaded = await loadConfig(projectDir);
    expect(loaded.profile.name).toBe('shared');
    expect(loaded.profile.source).toBe('user-local');
    expect(loaded.profile.scope).toBe('user');
    expect(loaded.config.agents.maxTurns).toBe(30);

    expect(await fileExists(join(userEforgeDir, 'profiles', 'shared.yaml'))).toBe(true);
    expect(await fileExists(join(userEforgeDir, 'backends', 'shared.yaml'))).toBe(false);
    expect(await fileExists(join(userEforgeDir, 'backends'))).toBe(false);
    expect(await fileExists(join(userEforgeDir, '.active-profile'))).toBe(true);
    const newMarker = await readFile(join(userEforgeDir, '.active-profile'), 'utf-8');
    expect(newMarker.trim()).toBe('shared');
    expect(await fileExists(join(userEforgeDir, '.active-backend'))).toBe(false);
  });

  it('skips user-scope migration when both backends/ and profiles/ exist and logs warning', async () => {
    const userEforgeDir = join(userXdgDir, 'eforge');
    await mkdir(join(userEforgeDir, 'backends'), { recursive: true });
    await writeFile(join(userEforgeDir, 'backends', 'old.yaml'), 'agents:\n  maxTurns: 30\n', 'utf-8');
    await mkdir(join(userEforgeDir, 'profiles'), { recursive: true });
    await writeFile(join(userEforgeDir, 'profiles', 'new.yaml'), 'agents:\n  maxTurns: 30\n', 'utf-8');

    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      await loadConfig(projectDir);
      const warningText = stderrWrite.mock.calls.map((call) => String(call[0])).join('');
      expect(warningText).toContain('Both ~/.config/eforge/backends/ and ~/.config/eforge/profiles/ exist');
      expect(warningText).toContain('Migration skipped');
    } finally {
      stderrWrite.mockRestore();
    }

    expect(await fileExists(join(userEforgeDir, 'backends', 'old.yaml'))).toBe(true);
    expect(await fileExists(join(userEforgeDir, 'profiles', 'new.yaml'))).toBe(true);
  });

  it('is idempotent for user scope: subsequent loadConfig calls do not re-migrate', async () => {
    const userEforgeDir = join(userXdgDir, 'eforge');
    await mkdir(join(userEforgeDir, 'profiles'), { recursive: true });
    await writeFile(join(userEforgeDir, 'profiles', 'shared.yaml'), 'agents:\n  maxTurns: 30\n', 'utf-8');
    await writeFile(join(userEforgeDir, '.active-profile'), 'shared\n', 'utf-8');

    await loadConfig(projectDir);
    await loadConfig(projectDir);

    expect(await fileExists(join(userEforgeDir, 'profiles', 'shared.yaml'))).toBe(true);
    expect(await fileExists(join(userEforgeDir, 'backends'))).toBe(false);
  });

  it('recovers orphaned user-scope .active-backend marker when profiles/ already exists', async () => {
    // Simulate partial migration: directory was moved but marker rename failed
    const userEforgeDir = join(userXdgDir, 'eforge');
    await mkdir(join(userEforgeDir, 'profiles'), { recursive: true });
    await writeFile(join(userEforgeDir, 'profiles', 'shared.yaml'), 'agents:\n  maxTurns: 30\n', 'utf-8');
    // Old marker still present, new marker absent
    await writeFile(join(userEforgeDir, '.active-backend'), 'shared\n', 'utf-8');

    await loadConfig(projectDir);

    expect(await fileExists(join(userEforgeDir, '.active-profile'))).toBe(true);
    const newMarker = await readFile(join(userEforgeDir, '.active-profile'), 'utf-8');
    expect(newMarker.trim()).toBe('shared');
    expect(await fileExists(join(userEforgeDir, '.active-backend'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Auto-migration: orphaned marker recovery for project scope
// ---------------------------------------------------------------------------

describe('auto-migration: orphaned project-scope .active-backend marker recovery', () => {
  let projectDir: string;
  let configDir: string;
  let userXdgDir: string;
  let origXdg: string | undefined;

  beforeEach(async () => {
    ({ projectDir, configDir } = await makeProject({ configYaml: 'agents:\n  maxTurns: 10\n' }));
    userXdgDir = await mkdtemp(join(tmpdir(), 'eforge-xdg-orphan-'));
    origXdg = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = userXdgDir;
  });

  afterEach(async () => {
    if (origXdg === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = origXdg;
    }
    await rm(projectDir, { recursive: true, force: true });
    await rm(userXdgDir, { recursive: true, force: true });
  });

  it('recovers orphaned eforge/.active-backend marker when profiles/ already exists but .active-profile is absent', async () => {
    // Simulate partial migration: directory already moved but marker rename failed
    await mkdir(join(configDir, 'profiles'), { recursive: true });
    await writeFile(join(configDir, 'profiles', 'a.yaml'), 'agents:\n  maxTurns: 30\n', 'utf-8');
    // Old marker still present, new marker absent, old directory gone
    await writeFile(join(configDir, '.active-backend'), 'a\n', 'utf-8');

    await loadConfig(projectDir);

    expect(await fileExists(join(configDir, '.active-profile'))).toBe(true);
    const newMarker = await readFile(join(configDir, '.active-profile'), 'utf-8');
    expect(newMarker.trim()).toBe('a');
    expect(await fileExists(join(configDir, '.active-backend'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// user-scope helpers without configDir
// ---------------------------------------------------------------------------
