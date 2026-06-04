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

  it('finds and loads parent eforge/config.yaml from a nested working directory', async () => {
    const { writeFile, mkdir, mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const tmpDir = await mkdtemp(join(tmpdir(), 'eforge-config-find-parent-'));
    const userXdgDir = await mkdtemp(join(tmpdir(), 'eforge-config-find-parent-xdg-'));
    const origXdg = process.env.XDG_CONFIG_HOME;
    const nestedDir = join(tmpDir, 'packages', 'app', 'src');
    await mkdir(join(tmpDir, 'eforge'), { recursive: true });
    await mkdir(nestedDir, { recursive: true });
    await writeFile(join(tmpDir, 'eforge', 'config.yaml'), 'agents:\n  maxTurns: 12\n', 'utf-8');

    try {
      process.env.XDG_CONFIG_HOME = userXdgDir;
      const found = await findConfigFile(nestedDir);
      expect(found).toBe(join(tmpDir, 'eforge', 'config.yaml'));
      const { config } = await loadConfig(nestedDir);
      expect(config.agents.maxTurns).toBe(12);
    } finally {
      if (origXdg === undefined) {
        delete process.env.XDG_CONFIG_HOME;
      } else {
        process.env.XDG_CONFIG_HOME = origXdg;
      }
      await rm(tmpDir, { recursive: true });
      await rm(userXdgDir, { recursive: true });
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
    const userXdgDir = await mkdtemp(join(tmpdir(), 'eforge-no-legacy-xdg-'));
    const origXdg = process.env.XDG_CONFIG_HOME;
    await mkdir(join(tmpDir, 'eforge'), { recursive: true });
    await writeFile(join(tmpDir, 'eforge', 'config.yaml'), 'agents:\n  maxTurns: 10\nextensions:\n  eventHookTimeoutMs: 2500\n', 'utf-8');

    try {
      process.env.XDG_CONFIG_HOME = userXdgDir;
      const { config } = await loadConfig(tmpDir);
      expect(config.agents.maxTurns).toBe(10);
      expect(config.extensions.eventHookTimeoutMs).toBe(2500);
    } finally {
      if (origXdg === undefined) {
        delete process.env.XDG_CONFIG_HOME;
      } else {
        process.env.XDG_CONFIG_HOME = origXdg;
      }
      await rm(tmpDir, { recursive: true });
      await rm(userXdgDir, { recursive: true });
    }
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
  it('DEFAULT_CONFIG.monitor.retentionCount equals 100', () => {
    expect(DEFAULT_CONFIG.monitor.retentionCount).toBe(100);
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
