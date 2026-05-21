/**
 * Tests for build.onSuccess config field: defaulting, merging, and validation.
 */

import { describe, it, expect } from 'vitest';
import { resolveConfig, DEFAULT_CONFIG, eforgeConfigSchema } from '@eforge-build/engine/config';

// --- eforge:region plan-01-engine-config-and-landing ---

describe('build.onSuccess config', () => {
  it('DEFAULT_CONFIG.build.onSuccess is merge-to-base-branch', () => {
    expect(DEFAULT_CONFIG.build.onSuccess).toBe('merge-to-base-branch');
  });

  it('resolveConfig({}) returns build.onSuccess === merge-to-base-branch', () => {
    const config = resolveConfig({}, {});
    expect(config.build.onSuccess).toBe('merge-to-base-branch');
  });

  it('resolveConfig with build.onSuccess issue-pr returns issue-pr', () => {
    const config = resolveConfig({ build: { onSuccess: 'issue-pr' } }, {});
    expect(config.build.onSuccess).toBe('issue-pr');
  });

  it('resolveConfig with build.onSuccess leave-branch returns leave-branch', () => {
    const config = resolveConfig({ build: { onSuccess: 'leave-branch' } }, {});
    expect(config.build.onSuccess).toBe('leave-branch');
  });

  it('resolveConfig with build.onSuccess merge-to-base-branch returns merge-to-base-branch', () => {
    const config = resolveConfig({ build: { onSuccess: 'merge-to-base-branch' } }, {});
    expect(config.build.onSuccess).toBe('merge-to-base-branch');
  });

  it('resolveConfig without build.onSuccess falls back to default', () => {
    const config = resolveConfig({ build: { cleanupPlanFiles: false } }, {});
    expect(config.build.onSuccess).toBe('merge-to-base-branch');
  });

  it('eforgeConfigSchema rejects invalid onSuccess string', () => {
    const result = eforgeConfigSchema.safeParse({
      build: { onSuccess: 'publish-to-npm' },
    });
    expect(result.success).toBe(false);
  });

  it('eforgeConfigSchema accepts all three valid onSuccess values', () => {
    for (const value of ['merge-to-base-branch', 'issue-pr', 'leave-branch']) {
      const result = eforgeConfigSchema.safeParse({ build: { onSuccess: value } });
      expect(result.success, `${value} should be valid`).toBe(true);
    }
  });

  it('eforgeConfigSchema accepts missing onSuccess (optional field)', () => {
    const result = eforgeConfigSchema.safeParse({ build: {} });
    expect(result.success).toBe(true);
  });
});

// --- eforge:endregion plan-01-engine-config-and-landing ---
