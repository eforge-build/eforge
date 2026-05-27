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

describe('resolveConfig', () => {
  it('returns defaults for empty inputs', () => {
    const config = resolveConfig({}, {});
    expect(config.agents.maxTurns).toBe(DEFAULT_CONFIG.agents.maxTurns);
    expect(config.maxConcurrentBuilds).toBe(DEFAULT_CONFIG.maxConcurrentBuilds);
    expect(config.plan).toEqual(DEFAULT_CONFIG.plan);
    expect(config.langfuse.enabled).toBe(false);
  });

  it('propagates file config values', () => {
    const config = resolveConfig(
      {
        agents: { maxTurns: 40, permissionMode: 'default' },
        plan: { outputDir: 'custom-plans' },
      },
      {},
    );
    expect(config.agents.maxTurns).toBe(40);
    expect(config.agents.permissionMode).toBe('default');
    expect(config.plan.outputDir).toBe('custom-plans');
  });

  it('propagates agents.promptDir', () => {
    const config = resolveConfig(
      { agents: { promptDir: 'eforge/prompts' } },
      {},
    );
    expect(config.agents.promptDir).toBe('eforge/prompts');
  });

  it('preserves default tier fields when a profile tier omits them', () => {
    const config = resolveConfig(
      {
        agents: {
          tiers: {
            implementation: {
              harness: 'claude-sdk',
              model: 'claude-sonnet-4-6',
              effort: 'medium',
            },
          },
        },
      },
      {},
    );

    expect(config.agents.tiers.implementation?.maxTurns).toBe(DEFAULT_TIER_MAX_TURNS.implementation);
  });

  it('lets profile tiers override default tier fields explicitly', () => {
    const config = resolveConfig(
      {
        agents: {
          tiers: {
            implementation: {
              harness: 'claude-sdk',
              model: 'claude-sonnet-4-6',
              effort: 'medium',
              maxTurns: 120,
            },
          },
        },
      },
      {},
    );

    expect(config.agents.tiers.implementation?.maxTurns).toBe(120);
  });

  it('env overrides file for langfuse keys', () => {
    const config = resolveConfig(
      { langfuse: { enabled: false, publicKey: 'file-pk', secretKey: 'file-sk', host: 'https://file.host' } },
      { LANGFUSE_PUBLIC_KEY: 'env-pk', LANGFUSE_SECRET_KEY: 'env-sk' },
    );
    expect(config.langfuse.publicKey).toBe('env-pk');
    expect(config.langfuse.secretKey).toBe('env-sk');
    expect(config.langfuse.enabled).toBe(true);
  });

  it('hooks defaults to empty array when not set', () => {
    const config = resolveConfig({}, {});
    expect(config.hooks).toEqual([]);
  });

  it('extensions default to enabled without project trust and absent filters', () => {
    const config = resolveConfig({}, {});
    expect(config.extensions).toEqual({
      enabled: true,
      trustProjectExtensions: false,
      eventHookTimeoutMs: DEFAULT_NATIVE_EVENT_HOOK_TIMEOUT_MS,
      agentContextHookTimeoutMs: DEFAULT_NATIVE_EVENT_HOOK_TIMEOUT_MS,
      policyGateTimeoutMs: DEFAULT_NATIVE_EVENT_HOOK_TIMEOUT_MS,
      policyGateFailurePolicy: 'fail-closed',
      profileRouterTimeoutMs: DEFAULT_NATIVE_EVENT_HOOK_TIMEOUT_MS,
      validationProviderTimeoutMs: DEFAULT_NATIVE_EVENT_HOOK_TIMEOUT_MS,
      include: undefined,
      exclude: undefined,
      paths: undefined,
    });
  });

  it('propagates extensions.eventHookTimeoutMs from file config', () => {
    const config = resolveConfig({ extensions: { eventHookTimeoutMs: 2500 } }, {});
    expect(config.extensions.eventHookTimeoutMs).toBe(2500);
    expect(config.extensions.policyGateTimeoutMs).toBe(2500);
  });

  it('supports explicit policy gate timeout and failure policy config', () => {
    const config = resolveConfig({ extensions: { policyGateTimeoutMs: 1500, policyGateFailurePolicy: 'fail-open' } }, {});
    expect(config.extensions.policyGateTimeoutMs).toBe(1500);
    expect(config.extensions.policyGateFailurePolicy).toBe('fail-open');
  });

  it('prefers explicit policy gate timeout over event hook timeout inheritance', () => {
    const config = resolveConfig({ extensions: { eventHookTimeoutMs: 2500, policyGateTimeoutMs: 1500 } }, {});
    expect(config.extensions.eventHookTimeoutMs).toBe(2500);
    expect(config.extensions.policyGateTimeoutMs).toBe(1500);
  });

  it('postMergeCommands parsed from file config', () => {
    const config = resolveConfig(
      { build: { postMergeCommands: ['pnpm test'] } },
      {},
    );
    expect(config.build.postMergeCommands).toEqual(['pnpm test']);
  });

  it('result is frozen', () => {
    const config = resolveConfig({}, {});
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.agents)).toBe(true);
  });

  // --- eforge:region plan-01-pre-compile-trunk-sync-gate ---
  describe('build.trunkSync defaults', () => {
    it('resolveConfig({}) returns default trunkSync values', () => {
      const config = resolveConfig({}, {});
      expect(config.build.trunkSync).toEqual({
        enabled: true,
        remote: 'origin',
        strategy: 'fetchedRemoteRef',
        onDiverged: 'warn',
      });
    });

    it('partial trunkSync config retains defaults for omitted fields', () => {
      const config = resolveConfig(
        { build: { trunkSync: { enabled: false } } },
        {},
      );
      expect(config.build.trunkSync.enabled).toBe(false);
      expect(config.build.trunkSync.remote).toBe('origin');
      expect(config.build.trunkSync.strategy).toBe('fetchedRemoteRef');
      expect(config.build.trunkSync.onDiverged).toBe('warn');
    });

    it('full trunkSync block is parsed correctly', () => {
      const config = resolveConfig(
        {
          build: {
            trunkSync: {
              enabled: true,
              remote: 'upstream',
              strategy: 'fetchedRemoteRef',
              onDiverged: 'fail',
            },
          },
        },
        {},
      );
      expect(config.build.trunkSync).toEqual({
        enabled: true,
        remote: 'upstream',
        strategy: 'fetchedRemoteRef',
        onDiverged: 'fail',
      });
    });

    it('postMergeCommands are unaffected by trunkSync resolution', () => {
      const config = resolveConfig(
        {
          build: {
            postMergeCommands: ['pnpm install', 'pnpm build', 'pnpm type-check', 'pnpm test'],
            trunkSync: { enabled: false },
          },
        },
        {},
      );
      expect(config.build.postMergeCommands).toEqual(['pnpm install', 'pnpm build', 'pnpm type-check', 'pnpm test']);
      expect(config.build.trunkSync.enabled).toBe(false);
    });
  });
  // --- eforge:endregion plan-01-pre-compile-trunk-sync-gate ---
});

describe('getUserConfigPath', () => {
  it('returns ~/.config/eforge/config.yaml by default', () => {
    const path = getUserConfigPath({});
    expect(path).toBe(resolve(homedir(), '.config', 'eforge', 'config.yaml'));
  });

  it('respects XDG_CONFIG_HOME override', () => {
    const path = getUserConfigPath({ XDG_CONFIG_HOME: '/tmp/xdg-config' });
    expect(path).toBe(resolve('/tmp/xdg-config', 'eforge', 'config.yaml'));
  });
});

describe('mergePartialConfigs', () => {
  it('empty + empty → empty', () => {
    const merged = mergePartialConfigs({}, {});
    expect(merged).toEqual({});
  });

  it('project fields override global scalars', () => {
    const global: PartialEforgeConfig = { agents: { maxTurns: 50, permissionMode: 'bypass' } };
    const project: PartialEforgeConfig = { agents: { maxTurns: 10 } };
    const merged = mergePartialConfigs(global, project);
    expect(merged.agents?.maxTurns).toBe(10);
    expect(merged.agents?.permissionMode).toBe('bypass');
  });

  it('hooks concatenate (global first, then project)', () => {
    const globalHook: HookConfig = { event: '*', command: 'global.sh', timeout: 5000 };
    const projectHook: HookConfig = { event: 'build:*', command: 'project.sh', timeout: 3000 };
    const merged = mergePartialConfigs({ hooks: [globalHook] }, { hooks: [projectHook] });
    expect(merged.hooks).toEqual([globalHook, projectHook]);
  });

  it('agents.tiers shallow-merge per tier', () => {
    const global: PartialEforgeConfig = {
      agents: {
        tiers: {
          planning: { harness: 'claude-sdk' as const, model: 'claude-opus-4-7', effort: 'high' as const },
        },
      },
    };
    const project: PartialEforgeConfig = {
      agents: {
        tiers: {
          implementation: { harness: 'claude-sdk' as const, model: 'claude-sonnet-4-6', effort: 'medium' as const },
        },
      },
    };
    const merged = mergePartialConfigs(global, project);
    expect(merged.agents?.tiers?.planning?.model).toBe('claude-opus-4-7');
    expect(merged.agents?.tiers?.implementation?.model).toBe('claude-sonnet-4-6');
  });

  it('agents.roles deep-merge: per-role shallow merge', () => {
    const global: PartialEforgeConfig = {
      agents: {
        roles: {
          builder: { effort: 'high' },
          reviewer: { effort: 'low' },
        },
      },
    };
    const project: PartialEforgeConfig = {
      agents: {
        roles: {
          builder: { maxTurns: 100 },
        },
      },
    };
    const merged = mergePartialConfigs(global, project);
    expect(merged.agents?.roles?.builder?.effort).toBe('high');
    expect(merged.agents?.roles?.builder?.maxTurns).toBe(100);
    expect(merged.agents?.roles?.reviewer?.effort).toBe('low');
  });

  it('extensions arrays replace while scalar fields are preserved', () => {
    const global: PartialEforgeConfig = {
      extensions: {
        enabled: false,
        trustProjectExtensions: true,
        include: ['global'],
        exclude: ['old'],
        paths: ['./global.ts'],
        eventHookTimeoutMs: 1234,
        policyGateTimeoutMs: 4321,
        policyGateFailurePolicy: 'fail-open',
      },
    };
    const project: PartialEforgeConfig = {
      extensions: {
        include: ['project'],
      },
    };
    const merged = mergePartialConfigs(global, project);
    expect(merged.extensions?.enabled).toBe(false);
    expect(merged.extensions?.trustProjectExtensions).toBe(true);
    expect(merged.extensions?.include).toEqual(['project']);
    expect(merged.extensions?.exclude).toEqual(['old']);
    expect(merged.extensions?.paths).toEqual(['./global.ts']);
    expect(merged.extensions?.eventHookTimeoutMs).toBe(1234);
    expect(merged.extensions?.policyGateTimeoutMs).toBe(4321);
    expect(merged.extensions?.policyGateFailurePolicy).toBe('fail-open');
  });

  it('project extensions.eventHookTimeoutMs overrides the global value', () => {
    const merged = mergePartialConfigs(
      { extensions: { eventHookTimeoutMs: 1000 } },
      { extensions: { eventHookTimeoutMs: 2000 } },
    );
    expect(merged.extensions?.eventHookTimeoutMs).toBe(2000);
  });

  it('project policy gate timeout and failure policy override global values', () => {
    const merged = mergePartialConfigs(
      { extensions: { policyGateTimeoutMs: 1000, policyGateFailurePolicy: 'fail-open' } },
      { extensions: { policyGateTimeoutMs: 2000, policyGateFailurePolicy: 'fail-closed' } },
    );
    expect(merged.extensions?.policyGateTimeoutMs).toBe(2000);
    expect(merged.extensions?.policyGateFailurePolicy).toBe('fail-closed');
  });
});

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

describe('findConfigFile', () => {
  it('returns null when only legacy eforge.yaml exists', async () => {
    const { writeFile, mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const tmpDir = await mkdtemp(join(tmpdir(), 'eforge-config-find-'));
    await writeFile(join(tmpDir, 'eforge.yaml'), 'agents:\n  maxTurns: 10\n', 'utf-8');

    try {
      const result = await findConfigFile(tmpDir);
      expect(result).toBeNull();
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });
});

describe('loadConfig legacy eforge.yaml detection', () => {
  it('throws ConfigMigrationError when only legacy eforge.yaml exists', async () => {
    const { writeFile, mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const tmpDir = await mkdtemp(join(tmpdir(), 'eforge-legacy-error-'));
    await writeFile(join(tmpDir, 'eforge.yaml'), 'agents:\n  maxTurns: 10\n', 'utf-8');

    try {
      await expect(loadConfig(tmpDir)).rejects.toThrow(ConfigMigrationError);
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  it('loads eforge/config.yaml successfully when present', async () => {
    const { writeFile, mkdir, mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const tmpDir = await mkdtemp(join(tmpdir(), 'eforge-no-legacy-'));
    await mkdir(join(tmpDir, 'eforge'), { recursive: true });
    await writeFile(join(tmpDir, 'eforge', 'config.yaml'), 'agents:\n  maxTurns: 10\nextensions:\n  eventHookTimeoutMs: 2500\n', 'utf-8');

    try {
      const { config } = await loadConfig(tmpDir);
      expect(config.agents.maxTurns).toBe(10);
      expect(config.extensions.eventHookTimeoutMs).toBe(2500);
    } finally {
      await rm(tmpDir, { recursive: true });
    }
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

describe('DEFAULT_CONFIG', () => {
  it('has tier recipes for every tier', () => {
    expect(DEFAULT_CONFIG.agents.tiers?.planning).toBeDefined();
    expect(DEFAULT_CONFIG.agents.tiers?.implementation).toBeDefined();
    expect(DEFAULT_CONFIG.agents.tiers?.review).toBeDefined();
    expect(DEFAULT_CONFIG.agents.tiers?.evaluation).toBeDefined();
  });

  it('planning tier defaults to claude-opus-4-7 + high effort', () => {
    const p = DEFAULT_CONFIG.agents.tiers?.planning;
    expect(p?.harness).toBe('claude-sdk');
    expect(p?.model).toBe('claude-opus-4-7');
    expect(p?.effort).toBe('high');
  });

  it('implementation tier defaults to claude-sonnet-4-6 + medium effort', () => {
    const i = DEFAULT_CONFIG.agents.tiers?.implementation;
    expect(i?.harness).toBe('claude-sdk');
    expect(i?.model).toBe('claude-sonnet-4-6');
    expect(i?.effort).toBe('medium');
  });

  it('prdQueue.dir defaults to .eforge/queue', () => {
    expect(DEFAULT_CONFIG.prdQueue.dir).toBe('.eforge/queue');
  });

  it('build.allowLocalMergeToTrunk defaults to false', () => {
    expect(DEFAULT_CONFIG.build.allowLocalMergeToTrunk).toBe(false);
  });

  it('build.trunkBranch defaults to undefined', () => {
    expect(DEFAULT_CONFIG.build.trunkBranch).toBeUndefined();
  });
});

describe('resolveConfig new build fields', () => {
  it('resolveConfig({}) prdQueue.dir equals .eforge/queue', () => {
    const config = resolveConfig({});
    expect(config.prdQueue.dir).toBe('.eforge/queue');
  });

  it('resolveConfig({}) build.allowLocalMergeToTrunk equals false', () => {
    const config = resolveConfig({});
    expect(config.build.allowLocalMergeToTrunk).toBe(false);
  });

  it('resolveConfig({}) build.trunkBranch equals undefined', () => {
    const config = resolveConfig({});
    expect(config.build.trunkBranch).toBeUndefined();
  });

  it('trunkBranch and allowLocalMergeToTrunk round-trip through resolveConfig', () => {
    const config = resolveConfig({ build: { trunkBranch: 'develop', allowLocalMergeToTrunk: true } });
    expect(config.build.trunkBranch).toBe('develop');
    expect(config.build.allowLocalMergeToTrunk).toBe(true);
  });

  it('user-provided prdQueue.dir eforge/queue round-trips (back-compat)', () => {
    const config = resolveConfig({ prdQueue: { dir: 'eforge/queue' } });
    expect(config.prdQueue.dir).toBe('eforge/queue');
  });
});

describe('monitor config', () => {
  it('DEFAULT_CONFIG.monitor.retentionCount equals 20', () => {
    expect(DEFAULT_CONFIG.monitor.retentionCount).toBe(20);
  });

  it('resolveConfig preserves monitor.retentionCount', () => {
    const config = resolveConfig({ monitor: { retentionCount: 50 } }, {});
    expect(config.monitor.retentionCount).toBe(50);
  });
});

describe('mergePartialConfigs chained-twice', () => {
  it('local wins over project wins over user for scalar at leaf', () => {
    const user: PartialEforgeConfig = { agents: { maxTurns: 10 } };
    const project: PartialEforgeConfig = { agents: { maxTurns: 20 } };
    const local: PartialEforgeConfig = { agents: { maxTurns: 99 } };
    const merged = mergePartialConfigs(mergePartialConfigs(user, project), local);
    expect(merged.agents?.maxTurns).toBe(99);
  });

  it('array replacement at leaf', () => {
    const user: PartialEforgeConfig = { build: { postMergeCommands: ['user-cmd'] } };
    const project: PartialEforgeConfig = { build: { postMergeCommands: ['project-cmd'] } };
    const local: PartialEforgeConfig = { build: { postMergeCommands: ['local-cmd'] } };
    const merged = mergePartialConfigs(mergePartialConfigs(user, project), local);
    expect(merged.build?.postMergeCommands).toEqual(['local-cmd']);
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

// --- eforge:region plan-02-final-validation-gates ---
describe('validation waiver config — schema validation and merge/defaults', () => {
  it('rejects allowNoCommands: true without noCommandsReason', () => {
    const result = eforgeConfigSchema.safeParse({
      build: { validation: { allowNoCommands: true } },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const hasIssue = result.error.issues.some(
        (i) => Array.isArray(i.path) && i.path.includes('noCommandsReason'),
      );
      expect(hasIssue).toBe(true);
    }
  });

  it('accepts allowNoCommands: true with non-empty noCommandsReason', () => {
    const result = eforgeConfigSchema.safeParse({
      build: { validation: { allowNoCommands: true, noCommandsReason: 'Shared monorepo; type checking happens in CI' } },
    });
    expect(result.success).toBe(true);
  });

  it('rejects allowNoCommands: true with a whitespace-only noCommandsReason', () => {
    const result = eforgeConfigSchema.safeParse({
      build: { validation: { allowNoCommands: true, noCommandsReason: '   ' } },
    });
    expect(result.success).toBe(false);
  });

  it('rejects allowEmptyPrdDiff: true without emptyPrdDiffReason', () => {
    const result = eforgeConfigSchema.safeParse({
      build: { validation: { allowEmptyPrdDiff: true } },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const hasIssue = result.error.issues.some(
        (i) => Array.isArray(i.path) && i.path.includes('emptyPrdDiffReason'),
      );
      expect(hasIssue).toBe(true);
    }
  });

  it('accepts allowEmptyPrdDiff: true with non-empty emptyPrdDiffReason', () => {
    const result = eforgeConfigSchema.safeParse({
      build: { validation: { allowEmptyPrdDiff: true, emptyPrdDiffReason: 'Config-only change; no source diff expected' } },
    });
    expect(result.success).toBe(true);
  });

  it('rejects allowEmptyPrdDiff: true with a whitespace-only emptyPrdDiffReason', () => {
    const result = eforgeConfigSchema.safeParse({
      build: { validation: { allowEmptyPrdDiff: true, emptyPrdDiffReason: '\t  ' } },
    });
    expect(result.success).toBe(false);
  });

  it('resolveConfig returns false defaults for validation waiver fields', () => {
    const config = resolveConfig({}, {});
    expect(config.build.validation.allowNoCommands).toBe(false);
    expect(config.build.validation.allowEmptyPrdDiff).toBe(false);
    expect(config.build.validation.noCommandsReason).toBeUndefined();
    expect(config.build.validation.emptyPrdDiffReason).toBeUndefined();
  });

  it('resolveConfig propagates allowNoCommands and noCommandsReason from file config', () => {
    const config = resolveConfig(
      { build: { validation: { allowNoCommands: true, noCommandsReason: 'CI handles this' } } },
      {},
    );
    expect(config.build.validation.allowNoCommands).toBe(true);
    expect(config.build.validation.noCommandsReason).toBe('CI handles this');
    // Other waiver fields default to false/undefined
    expect(config.build.validation.allowEmptyPrdDiff).toBe(false);
    expect(config.build.validation.emptyPrdDiffReason).toBeUndefined();
  });

  it('resolveConfig propagates allowEmptyPrdDiff and emptyPrdDiffReason from file config', () => {
    const config = resolveConfig(
      { build: { validation: { allowEmptyPrdDiff: true, emptyPrdDiffReason: 'Docs-only change' } } },
      {},
    );
    expect(config.build.validation.allowEmptyPrdDiff).toBe(true);
    expect(config.build.validation.emptyPrdDiffReason).toBe('Docs-only change');
    expect(config.build.validation.allowNoCommands).toBe(false);
  });

  it('mergePartialConfigs preserves distinct build.validation waiver fields from both layers', () => {
    const merged = mergePartialConfigs(
      { build: { validation: { allowNoCommands: true, noCommandsReason: 'CI runs command validation' } } },
      { build: { validation: { allowEmptyPrdDiff: true, emptyPrdDiffReason: 'Generated docs-only queue item' } } },
    );

    expect(merged.build?.validation).toEqual({
      allowNoCommands: true,
      noCommandsReason: 'CI runs command validation',
      allowEmptyPrdDiff: true,
      emptyPrdDiffReason: 'Generated docs-only queue item',
    });
  });
});
// --- eforge:endregion plan-02-final-validation-gates ---

// --- eforge:region plan-01-acceptance-evidence-model ---
describe('validation waiver config — acceptance criteria and committed changes waivers', () => {
  it('resolveConfig sets allowNoAcceptanceCriteria to false by default', () => {
    const config = resolveConfig({}, {});
    expect(config.build.validation.allowNoAcceptanceCriteria).toBe(false);
  });

  it('resolveConfig sets allowNoCommittedChanges to false by default', () => {
    const config = resolveConfig({}, {});
    expect(config.build.validation.allowNoCommittedChanges).toBe(false);
  });

  it('resolveConfig sets noAcceptanceCriteriaReason to undefined by default', () => {
    const config = resolveConfig({}, {});
    expect(config.build.validation.noAcceptanceCriteriaReason).toBeUndefined();
  });

  it('resolveConfig sets noCommittedChangesReason to undefined by default', () => {
    const config = resolveConfig({}, {});
    expect(config.build.validation.noCommittedChangesReason).toBeUndefined();
  });

  it('rejects allowNoAcceptanceCriteria: true without a noAcceptanceCriteriaReason', () => {
    const result = eforgeConfigSchema.safeParse({
      build: { validation: { allowNoAcceptanceCriteria: true } },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const hasIssue = result.error.issues.some(
        (i) => Array.isArray(i.path) && i.path.includes('noAcceptanceCriteriaReason'),
      );
      expect(hasIssue).toBe(true);
    }
  });

  it('accepts allowNoAcceptanceCriteria: true with a non-empty noAcceptanceCriteriaReason', () => {
    const result = eforgeConfigSchema.safeParse({
      build: { validation: { allowNoAcceptanceCriteria: true, noAcceptanceCriteriaReason: 'Exploratory build; criteria defined post-hoc' } },
    });
    expect(result.success).toBe(true);
  });

  it('rejects allowNoAcceptanceCriteria: true with a whitespace-only noAcceptanceCriteriaReason', () => {
    const result = eforgeConfigSchema.safeParse({
      build: { validation: { allowNoAcceptanceCriteria: true, noAcceptanceCriteriaReason: '   ' } },
    });
    expect(result.success).toBe(false);
  });

  it('rejects allowNoCommittedChanges: true without a noCommittedChangesReason', () => {
    const result = eforgeConfigSchema.safeParse({
      build: { validation: { allowNoCommittedChanges: true } },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const hasIssue = result.error.issues.some(
        (i) => Array.isArray(i.path) && i.path.includes('noCommittedChangesReason'),
      );
      expect(hasIssue).toBe(true);
    }
  });

  it('accepts allowNoCommittedChanges: true with a non-empty noCommittedChangesReason', () => {
    const result = eforgeConfigSchema.safeParse({
      build: { validation: { allowNoCommittedChanges: true, noCommittedChangesReason: 'Config-only change recorded in parent PR' } },
    });
    expect(result.success).toBe(true);
  });

  it('rejects allowNoCommittedChanges: true with a whitespace-only noCommittedChangesReason', () => {
    const result = eforgeConfigSchema.safeParse({
      build: { validation: { allowNoCommittedChanges: true, noCommittedChangesReason: '\t  ' } },
    });
    expect(result.success).toBe(false);
  });

  it('resolveConfig propagates allowNoAcceptanceCriteria and noAcceptanceCriteriaReason', () => {
    const config = resolveConfig(
      { build: { validation: { allowNoAcceptanceCriteria: true, noAcceptanceCriteriaReason: 'Exploratory task' } } },
      {},
    );
    expect(config.build.validation.allowNoAcceptanceCriteria).toBe(true);
    expect(config.build.validation.noAcceptanceCriteriaReason).toBe('Exploratory task');
    expect(config.build.validation.allowNoCommittedChanges).toBe(false);
  });

  it('resolveConfig propagates allowNoCommittedChanges and noCommittedChangesReason', () => {
    const config = resolveConfig(
      { build: { validation: { allowNoCommittedChanges: true, noCommittedChangesReason: 'Docs-only sync' } } },
      {},
    );
    expect(config.build.validation.allowNoCommittedChanges).toBe(true);
    expect(config.build.validation.noCommittedChangesReason).toBe('Docs-only sync');
    expect(config.build.validation.allowNoAcceptanceCriteria).toBe(false);
  });

  it('mergePartialConfigs preserves acceptance criteria and committed changes waiver fields across layers', () => {
    const merged = mergePartialConfigs(
      { build: { validation: { allowNoAcceptanceCriteria: true, noAcceptanceCriteriaReason: 'Exploratory' } } },
      { build: { validation: { allowNoCommittedChanges: true, noCommittedChangesReason: 'Docs-only' } } },
    );
    expect(merged.build?.validation).toEqual({
      allowNoAcceptanceCriteria: true,
      noAcceptanceCriteriaReason: 'Exploratory',
      allowNoCommittedChanges: true,
      noCommittedChangesReason: 'Docs-only',
    });
  });
});

// --- eforge:region plan-01-core-daemon-stack-sync ---
describe('stacking.sync.afterBuild config', () => {
  it('DEFAULT_CONFIG.stacking.sync.afterBuild defaults to false', () => {
    expect(DEFAULT_CONFIG.stacking.sync.afterBuild).toBe(false);
  });

  it('resolveConfig({}) stacking.sync.afterBuild equals false', () => {
    const config = resolveConfig({});
    expect(config.stacking.sync.afterBuild).toBe(false);
  });

  it('resolveConfig propagates stacking.sync.afterBuild: true', () => {
    const config = resolveConfig({ stacking: { enabled: true, sync: { afterBuild: true } } });
    expect(config.stacking.sync.afterBuild).toBe(true);
  });

  it('stacking.sync.afterBuild false does not enable itself when stacking is enabled', () => {
    const config = resolveConfig({ stacking: { enabled: true, sync: { afterBuild: false } } });
    expect(config.stacking.sync.afterBuild).toBe(false);
    expect(config.stacking.enabled).toBe(true);
  });

  it('eforgeConfigSchema accepts stacking.sync.afterBuild: true', () => {
    const result = eforgeConfigSchema.safeParse({
      stacking: { enabled: true, sync: { afterBuild: true } },
    });
    expect(result.success).toBe(true);
  });

  it('eforgeConfigSchema accepts stacking.sync.afterBuild: false', () => {
    const result = eforgeConfigSchema.safeParse({
      stacking: { enabled: false, sync: { afterBuild: false } },
    });
    expect(result.success).toBe(true);
  });

  it('mergePartialConfigs merges stacking.sync across layers', () => {
    const base: PartialEforgeConfig = { stacking: { enabled: true } };
    const overlay: PartialEforgeConfig = { stacking: { sync: { afterBuild: true } } };
    const merged = mergePartialConfigs(base, overlay);
    expect(merged.stacking?.enabled).toBe(true);
    expect(merged.stacking?.sync?.afterBuild).toBe(true);
  });
});
// --- eforge:endregion plan-01-core-daemon-stack-sync ---
// --- eforge:endregion plan-01-acceptance-evidence-model ---
