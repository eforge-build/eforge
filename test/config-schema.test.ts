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
        trustProjectExtensions: false,
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

describe('extensions.trustProjectExtensions stripping from project/team config', () => {
  it('project-team config file with trustProjectExtensions: true is stripped and emits a warning', async () => {
    const { writeFile, mkdir, mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const tmpDir = await mkdtemp(join(tmpdir(), 'eforge-trust-strip-'));
    const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = join(tmpDir, 'xdg');
    try {
      // Write project-team config with trustProjectExtensions: true
      await mkdir(join(tmpDir, 'eforge'), { recursive: true });
      await writeFile(join(tmpDir, 'eforge', 'config.yaml'), 'extensions:\n  trustProjectExtensions: true\n', 'utf-8');

      const { config, warnings } = await loadConfig(tmpDir);

      // The setting must be stripped: final resolved config has the default (false)
      expect(config.extensions.trustProjectExtensions).toBe(false);
      // A warning must have been emitted
      expect(warnings.some((w) => w.includes('trustProjectExtensions'))).toBe(true);
      expect(warnings.some((w) => w.includes('project-team config'))).toBe(true);
    } finally {
      if (originalXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
      await rm(tmpDir, { recursive: true });
    }
  });

  it('project-team profiles with trustProjectExtensions: true are stripped and emit a warning', async () => {
    const { writeFile, mkdir, mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const tmpDir = await mkdtemp(join(tmpdir(), 'eforge-trust-profile-strip-'));
    const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = join(tmpDir, 'xdg');
    try {
      await mkdir(join(tmpDir, 'eforge', 'profiles'), { recursive: true });
      await writeFile(join(tmpDir, 'eforge', 'config.yaml'), 'agents:\n  maxTurns: 10\n', 'utf-8');
      await writeFile(join(tmpDir, 'eforge', '.active-profile'), 'team-profile\n', 'utf-8');
      await writeFile(join(tmpDir, 'eforge', 'profiles', 'team-profile.yaml'), 'extensions:\n  trustProjectExtensions: true\n', 'utf-8');

      const { config, warnings, profile } = await loadConfig(tmpDir);

      expect(profile).toMatchObject({ name: 'team-profile', scope: 'project' });
      expect(profile.config?.extensions?.trustProjectExtensions).toBeUndefined();
      expect(config.extensions.trustProjectExtensions).toBe(false);
      expect(warnings.some((w) => w.includes('project-team profile "team-profile"'))).toBe(true);
    } finally {
      if (originalXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
      await rm(tmpDir, { recursive: true });
    }
  });

  it('project-local config file with trustProjectExtensions: true is NOT stripped (project-local can set it)', async () => {
    const { writeFile, mkdir, mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const tmpDir = await mkdtemp(join(tmpdir(), 'eforge-trust-local-'));
    const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = join(tmpDir, 'xdg');
    try {
      // Write project-local config with trustProjectExtensions: true
      await mkdir(join(tmpDir, '.eforge'), { recursive: true });
      await writeFile(join(tmpDir, '.eforge', 'config.yaml'), 'extensions:\n  trustProjectExtensions: true\n', 'utf-8');

      const { config, warnings } = await loadConfig(tmpDir);

      // Project-local is not stripped: final resolved config respects the value
      expect(config.extensions.trustProjectExtensions).toBe(true);
      // No warning about trustProjectExtensions
      expect(warnings.some((w) => w.includes('trustProjectExtensions'))).toBe(false);
    } finally {
      if (originalXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
      await rm(tmpDir, { recursive: true });
    }
  });

  it('extensionConfigSchema accepts trustProjectExtensions as a valid schema field', () => {
    const result = extensionConfigSchema.safeParse({ trustProjectExtensions: true });
    expect(result.success).toBe(true);
  });

  it('mergePartialConfigs preserves trustProjectExtensions for user-level merge', () => {
    const user: PartialEforgeConfig = { extensions: { trustProjectExtensions: true } };
    const project: PartialEforgeConfig = { extensions: { include: ['alpha'] } };
    const merged = mergePartialConfigs(user, project);
    // User-level setting is preserved through merge
    expect(merged.extensions?.trustProjectExtensions).toBe(true);
  });
});
