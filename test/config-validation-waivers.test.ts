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

  it('resolveConfig sets acceptanceConflictPolicy to manual by default', () => {
    const config = resolveConfig({}, {});
    expect(config.build.validation.acceptanceConflictPolicy).toBe('manual');
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

  it('resolveConfig propagates acceptanceConflictPolicy', () => {
    const config = resolveConfig(
      { build: { validation: { acceptanceConflictPolicy: 'auto-waive-narrow' } } },
      {},
    );
    expect(config.build.validation.acceptanceConflictPolicy).toBe('auto-waive-narrow');
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
