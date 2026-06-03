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
