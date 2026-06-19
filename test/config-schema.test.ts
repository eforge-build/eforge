import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import {
  resolveConfig,
  DEFAULT_CONFIG,
  DEFAULT_NATIVE_EVENT_HOOK_TIMEOUT_MS,
  getUserConfigPath,
  mergePartialConfigs,
  loadConfig,
  findConfigFile,
  ConfigMigrationError,
  ConfigValidationError,
  AGENT_ROLES,
  thinkingConfigSchema,
  effortLevelSchema,
  sdkPassthroughConfigSchema,
  eforgeConfigSchema,
  piConfigSchema,
  piThinkingLevelSchema,
  claudeSdkConfigSchema,
  configYamlSchema,
  extensionConfigSchema,
  sanitizeProfileName,
  parseRawConfigLegacy,
  tierConfigSchema,
  DEFAULT_TIER_MAX_TURNS,
} from '@eforge-build/engine/config';
import { pickSdkOptions } from '@eforge-build/engine/harness';
import { DAEMON_API_VERSION } from '@eforge-build/client';
import type { PartialEforgeConfig, HookConfig } from '@eforge-build/engine/config';

describe('parseRawConfig strict validation', () => {
  it('staleness-assessor is recognized as a valid agent role', () => {
    expect(AGENT_ROLES).toContain('staleness-assessor');
  });

  it('merge-conflict-resolver is recognized as a valid agent role', () => {
    expect(AGENT_ROLES).toContain('merge-conflict-resolver');
  });
});

describe('eforgeConfigSchema', () => {
  it('accepts a valid config with tier recipes', () => {
    const result = eforgeConfigSchema.safeParse({
      agents: {
        tiers: {
          planning: { harness: 'claude-sdk', model: 'claude-opus-4-7', effort: 'high' },
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects monitor.retentionCount < 1', () => {
    const result = eforgeConfigSchema.safeParse({ monitor: { retentionCount: 0 } });
    expect(result.success).toBe(false);
  });
});

describe('thinkingConfigSchema', () => {
  it('accepts adaptive type', () => {
    expect(thinkingConfigSchema.safeParse({ type: 'adaptive' }).success).toBe(true);
  });

  it('rejects invalid type', () => {
    expect(thinkingConfigSchema.safeParse({ type: 'invalid' }).success).toBe(false);
  });
});

describe('effortLevelSchema', () => {
  it('accepts low/medium/high/xhigh/max', () => {
    for (const level of ['low', 'medium', 'high', 'xhigh', 'max']) {
      expect(effortLevelSchema.safeParse(level).success).toBe(true);
    }
  });

  it('rejects extreme', () => {
    expect(effortLevelSchema.safeParse('extreme').success).toBe(false);
  });
});

describe('roles schema', () => {
  it('accepts valid roles', () => {
    const config = resolveConfig({
      agents: {
        roles: {
          builder: { effort: 'high' },
        },
      },
    });
    expect(config.agents.roles?.builder?.effort).toBe('high');
  });

  it('rejects invalid role names via schema', () => {
    const result = eforgeConfigSchema.safeParse({
      agents: {
        roles: {
          'not-a-role': { effort: 'high' },
        },
      },
    });
    expect(result.success).toBe(false);
  });
});

describe('pickSdkOptions', () => {
  it('strips undefined values', () => {
    const result = pickSdkOptions({ model: { id: 'x' }, thinking: undefined, effort: 'low' });
    expect(result).toEqual({ model: { id: 'x' }, effort: 'low' });
  });

  it('strips promptAppend from SDK options', () => {
    const result = pickSdkOptions({ effort: 'high', promptAppend: '## Extra' });
    expect(result).toEqual({ effort: 'high' });
  });
});

describe('sdkPassthroughConfigSchema', () => {
  it('accepts valid config with all fields', () => {
    const result = sdkPassthroughConfigSchema.safeParse({
      model: { id: 'x' },
      thinking: { type: 'enabled', budgetTokens: 5000 },
      effort: 'high',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid effort value', () => {
    expect(sdkPassthroughConfigSchema.safeParse({ effort: 'extreme' }).success).toBe(false);
  });
});

describe('configYamlSchema rejects legacy fields', () => {
  it('rejects backend:', () => {
    const result = configYamlSchema.safeParse({ backend: 'claude-sdk' });
    expect(result.success).toBe(false);
  });

  it('rejects pi:', () => {
    const result = configYamlSchema.safeParse({ pi: { thinkingLevel: 'high' } });
    expect(result.success).toBe(false);
  });

  it('rejects claudeSdk:', () => {
    const result = configYamlSchema.safeParse({ claudeSdk: { disableSubagents: false } });
    expect(result.success).toBe(false);
  });

  it('rejects agentRuntimes:', () => {
    const result = configYamlSchema.safeParse({ agentRuntimes: { main: { harness: 'claude-sdk' } } });
    expect(result.success).toBe(false);
  });

  it('accepts agents.tiers config', () => {
    const result = configYamlSchema.safeParse({
      agents: {
        tiers: {
          planning: { harness: 'claude-sdk', model: 'claude-opus-4-7', effort: 'high' },
        },
      },
    });
    expect(result.success).toBe(true);
  });
});

describe('claudeSdkConfigSchema', () => {
  it('accepts { disableSubagents: true }', () => {
    expect(claudeSdkConfigSchema.safeParse({ disableSubagents: true }).success).toBe(true);
  });

  it('accepts empty object', () => {
    expect(claudeSdkConfigSchema.safeParse({}).success).toBe(true);
  });

  it('rejects non-boolean disableSubagents', () => {
    expect(claudeSdkConfigSchema.safeParse({ disableSubagents: 'yes' }).success).toBe(false);
  });
});

describe('extensionConfigSchema', () => {
  it('accepts native extension config fields', () => {
    const result = configYamlSchema.safeParse({
      extensions: {
        enabled: true,
        include: ['a'],
        exclude: ['b'],
        paths: ['./x.ts'],
        eventHookTimeoutMs: 2500,
        policyGateTimeoutMs: 1500,
        policyGateFailurePolicy: 'fail-closed',
      },
    });
    expect(result.success).toBe(true);
    expect(extensionConfigSchema.safeParse(result.success ? result.data.extensions : undefined).success).toBe(true);
  });

  it('rejects non-positive or fractional native event hook timeouts', () => {
    expect(configYamlSchema.safeParse({ extensions: { eventHookTimeoutMs: 0 } }).success).toBe(false);
    expect(configYamlSchema.safeParse({ extensions: { eventHookTimeoutMs: 1.5 } }).success).toBe(false);
    expect(configYamlSchema.safeParse({ extensions: { policyGateTimeoutMs: 0 } }).success).toBe(false);
    expect(configYamlSchema.safeParse({ extensions: { policyGateTimeoutMs: 1.5 } }).success).toBe(false);
  });

  it('accepts valid policy gate failure policy literals and rejects invalid ones', () => {
    expect(configYamlSchema.safeParse({ extensions: { policyGateFailurePolicy: 'fail-open' } }).success).toBe(true);
    expect(configYamlSchema.safeParse({ extensions: { policyGateFailurePolicy: 'fail-closed' } }).success).toBe(true);
    expect(configYamlSchema.safeParse({ extensions: { policyGateFailurePolicy: 'ignore' } }).success).toBe(false);
  });
});

describe('piConfigSchema', () => {
  it('accepts full pi config', () => {
    const result = piConfigSchema.safeParse({
      apiKey: 'sk-test',
      thinkingLevel: 'high',
      extensions: { autoDiscover: true },
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid thinkingLevel', () => {
    expect(piConfigSchema.safeParse({ thinkingLevel: 'invalid' }).success).toBe(false);
  });
});

describe('piThinkingLevelSchema', () => {
  it('accepts off/low/medium/high/xhigh', () => {
    for (const level of ['off', 'low', 'medium', 'high', 'xhigh']) {
      expect(piThinkingLevelSchema.safeParse(level).success).toBe(true);
    }
  });

  it('rejects max', () => {
    expect(piThinkingLevelSchema.safeParse('max').success).toBe(false);
  });
});

describe('tierConfigSchema accepts tier recipes', () => {
  it('accepts a claude-sdk tier', () => {
    const result = tierConfigSchema.safeParse({
      harness: 'claude-sdk',
      model: 'claude-opus-4-7',
      effort: 'high',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a pi tier with provider', () => {
    const result = tierConfigSchema.safeParse({
      harness: 'pi',
      pi: { provider: 'openrouter' },
      model: 'qwen-coder',
      effort: 'medium',
    });
    expect(result.success).toBe(true);
  });
});

describe('sanitizeProfileName', () => {
  it('claude-sdk + claude-opus-4.7 → claude-sdk-opus-4-7', () => {
    expect(sanitizeProfileName('claude-sdk', undefined, 'claude-opus-4.7')).toBe('claude-sdk-opus-4-7');
  });
});

describe('parseRawConfigLegacy', () => {
  it('extracts backend and agents.models into profile', () => {
    const data = {
      backend: 'claude-sdk' as const,
      agents: { models: { max: { id: 'claude-opus-4.7' } } },
      build: { postMergeCommands: ['pnpm test'] },
    };
    const { profile, remaining } = parseRawConfigLegacy(data);
    expect(profile.backend).toBe('claude-sdk');
    expect(remaining).toEqual({ build: { postMergeCommands: ['pnpm test'] } });
  });
});

describe('removed extension trust config field validation', () => {
  const removedKey = ['trust', 'Project', 'Extensions'].join('');
  const removedYaml = `extensions:\n  ${removedKey}: true\n`;

  it('extensionConfigSchema rejects the removed field', () => {
    expect(extensionConfigSchema.safeParse({ [removedKey]: true }).success).toBe(false);
  });

  it('configYamlSchema rejects the removed nested extension field', () => {
    const result = configYamlSchema.safeParse({ extensions: { [removedKey]: true } });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['extensions']);
  });

  it('requires a daemon API version new enough for the removed config field contract', () => {
    expect(DAEMON_API_VERSION).toBeGreaterThanOrEqual(71);
  });

  it('loadConfig rejects project-team config files containing the removed field', async () => {
    const { writeFile, mkdir, mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const tmpDir = await mkdtemp(join(tmpdir(), 'eforge-trust-removed-'));
    const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = join(tmpDir, 'xdg');
    try {
      await mkdir(join(tmpDir, 'eforge'), { recursive: true });
      await writeFile(join(tmpDir, 'eforge', 'config.yaml'), removedYaml, 'utf-8');

      await expect(loadConfig(tmpDir)).rejects.toThrow(ConfigValidationError);
    } finally {
      if (originalXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
      await rm(tmpDir, { recursive: true });
    }
  });

  it('loadConfig rejects project-team profiles containing the removed field', async () => {
    const { writeFile, mkdir, mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const tmpDir = await mkdtemp(join(tmpdir(), 'eforge-trust-profile-removed-'));
    const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = join(tmpDir, 'xdg');
    try {
      await mkdir(join(tmpDir, 'eforge', 'profiles'), { recursive: true });
      await writeFile(join(tmpDir, 'eforge', 'config.yaml'), 'agents:\n  maxTurns: 10\n', 'utf-8');
      await writeFile(join(tmpDir, 'eforge', '.active-profile'), 'team-profile\n', 'utf-8');
      await writeFile(join(tmpDir, 'eforge', 'profiles', 'team-profile.yaml'), removedYaml, 'utf-8');

      await expect(loadConfig(tmpDir)).rejects.toThrow(ConfigValidationError);
    } finally {
      if (originalXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
      await rm(tmpDir, { recursive: true });
    }
  });

  it('loadConfig rejects project-local config files containing the removed field', async () => {
    const { writeFile, mkdir, mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const tmpDir = await mkdtemp(join(tmpdir(), 'eforge-trust-local-removed-'));
    const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = join(tmpDir, 'xdg');
    try {
      await mkdir(join(tmpDir, '.eforge'), { recursive: true });
      await writeFile(join(tmpDir, '.eforge', 'config.yaml'), removedYaml, 'utf-8');

      await expect(loadConfig(tmpDir)).rejects.toThrow(ConfigValidationError);
    } finally {
      if (originalXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
      await rm(tmpDir, { recursive: true });
    }
  });

  it('loadConfig rejects user config files containing the removed field', async () => {
    const { writeFile, mkdir, mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const tmpDir = await mkdtemp(join(tmpdir(), 'eforge-trust-user-removed-'));
    const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = join(tmpDir, 'xdg');
    try {
      const projectDir = join(tmpDir, 'project');
      await mkdir(projectDir, { recursive: true });
      await mkdir(join(tmpDir, 'xdg', 'eforge'), { recursive: true });
      await writeFile(join(tmpDir, 'xdg', 'eforge', 'config.yaml'), removedYaml, 'utf-8');

      await expect(loadConfig(projectDir)).rejects.toThrow(ConfigValidationError);
    } finally {
      if (originalXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
      await rm(tmpDir, { recursive: true });
    }
  });

  it('loadConfig rejects project-local profiles containing the removed field', async () => {
    const { writeFile, mkdir, mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const tmpDir = await mkdtemp(join(tmpdir(), 'eforge-trust-local-profile-removed-'));
    const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = join(tmpDir, 'xdg');
    try {
      await mkdir(join(tmpDir, '.eforge', 'profiles'), { recursive: true });
      await writeFile(join(tmpDir, '.eforge', 'config.yaml'), 'agents:\n  maxTurns: 10\n', 'utf-8');
      await writeFile(join(tmpDir, '.eforge', '.active-profile'), 'local-profile\n', 'utf-8');
      await writeFile(join(tmpDir, '.eforge', 'profiles', 'local-profile.yaml'), removedYaml, 'utf-8');

      await expect(loadConfig(tmpDir)).rejects.toThrow(ConfigValidationError);
    } finally {
      if (originalXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
      await rm(tmpDir, { recursive: true });
    }
  });

  it('mergePartialConfigs preserves allowed extension fields', () => {
    const user: PartialEforgeConfig = { extensions: { enabled: false, eventHookTimeoutMs: 1234 } };
    const project: PartialEforgeConfig = { extensions: { include: ['alpha'] } };
    const merged = mergePartialConfigs(user, project);
    expect(merged.extensions).toMatchObject({ enabled: false, include: ['alpha'], eventHookTimeoutMs: 1234 });
  });
});
