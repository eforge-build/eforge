/**
 * Tests for build.onSuccess config field: defaulting, merging, and validation.
 */

import { describe, it, expect } from 'vitest';
import { resolveConfig, DEFAULT_CONFIG, eforgeConfigSchema, resolvePrAutoMergeIntent } from '@eforge-build/engine/config';

// --- eforge:region plan-01-engine-config-and-landing ---

describe('landing.action config', () => {
  it('DEFAULT_CONFIG.landing.action is merge', () => {
    expect(DEFAULT_CONFIG.landing.action).toBe('merge');
  });

  it('resolveConfig({}) returns landing.action === merge', () => {
    const config = resolveConfig({}, {});
    expect(config.landing.action).toBe('merge');
  });

  it('resolveConfig with landing.action pr returns pr', () => {
    const config = resolveConfig({ landing: { action: 'pr' } }, {});
    expect(config.landing.action).toBe('pr');
  });

  it('resolveConfig with landing.action leave returns leave', () => {
    const config = resolveConfig({ landing: { action: 'leave' } }, {});
    expect(config.landing.action).toBe('leave');
  });

  it('resolveConfig with landing.action merge returns merge', () => {
    const config = resolveConfig({ landing: { action: 'merge' } }, {});
    expect(config.landing.action).toBe('merge');
  });

  it('resolveConfig without landing.action falls back to default', () => {
    const config = resolveConfig({ build: { cleanupPlanFiles: false } }, {});
    expect(config.landing.action).toBe('merge');
  });

  it('eforgeConfigSchema rejects invalid landing.action string', () => {
    const result = eforgeConfigSchema.safeParse({
      landing: { action: 'publish-to-npm' },
    });
    expect(result.success).toBe(false);
  });

  it('eforgeConfigSchema accepts all three valid landing.action values', () => {
    for (const value of ['pr', 'merge', 'leave']) {
      const result = eforgeConfigSchema.safeParse({ landing: { action: value } });
      expect(result.success, `${value} should be valid`).toBe(true);
    }
  });

  it('eforgeConfigSchema accepts missing landing.action (optional field)', () => {
    const result = eforgeConfigSchema.safeParse({ landing: {} });
    expect(result.success).toBe(true);
  });

  it('eforgeConfigSchema rejects build.onSuccess (removed field)', () => {
    // build.onSuccess was removed in v39 — supplying it must throw a ConfigMigrationError
    // at load time and be rejected by the schema
    const result = eforgeConfigSchema.safeParse({ build: { onSuccess: 'merge-to-base-branch' } });
    expect(result.success).toBe(false);
  });
});

// --- eforge:endregion plan-01-engine-config-and-landing ---

// --- eforge:region plan-01-core-engine-auto-merge ---

describe('landing.pr.autoMerge config', () => {
  it('DEFAULT_CONFIG.landing.pr.autoMerge is ask', () => {
    expect(DEFAULT_CONFIG.landing.pr.autoMerge).toBe('ask');
  });

  it('resolveConfig({}) returns landing.pr.autoMerge === ask', () => {
    const config = resolveConfig({}, {});
    expect(config.landing.pr.autoMerge).toBe('ask');
  });

  it('resolveConfig with landing.pr.autoMerge always returns always', () => {
    const config = resolveConfig({ landing: { pr: { autoMerge: 'always' } } }, {});
    expect(config.landing.pr.autoMerge).toBe('always');
  });

  it('resolveConfig with landing.pr.autoMerge never returns never', () => {
    const config = resolveConfig({ landing: { pr: { autoMerge: 'never' } } }, {});
    expect(config.landing.pr.autoMerge).toBe('never');
  });

  it('resolveConfig with landing.pr.autoMerge ask returns ask', () => {
    const config = resolveConfig({ landing: { pr: { autoMerge: 'ask' } } }, {});
    expect(config.landing.pr.autoMerge).toBe('ask');
  });

  it('eforgeConfigSchema rejects invalid landing.pr.autoMerge string', () => {
    const result = eforgeConfigSchema.safeParse({
      landing: { pr: { autoMerge: 'sometimes' } },
    });
    expect(result.success).toBe(false);
  });

  it('eforgeConfigSchema accepts all three valid landing.pr.autoMerge values', () => {
    for (const value of ['ask', 'always', 'never']) {
      const result = eforgeConfigSchema.safeParse({ landing: { pr: { autoMerge: value } } });
      expect(result.success, `${value} should be valid`).toBe(true);
    }
  });

  it('landing.action behavior unchanged with landing.pr.autoMerge present', () => {
    const config = resolveConfig({ landing: { action: 'pr', pr: { autoMerge: 'always' } } }, {});
    expect(config.landing.action).toBe('pr');
    expect(config.landing.pr.autoMerge).toBe('always');
  });
});

describe('resolvePrAutoMergeIntent', () => {
  it('policy=always, requested=undefined → enabled', () => {
    expect(resolvePrAutoMergeIntent('always', undefined)).toBe(true);
  });

  it('policy=always, requested=true → enabled', () => {
    expect(resolvePrAutoMergeIntent('always', true)).toBe(true);
  });

  it('policy=always, requested=false → disabled (explicit opt-out)', () => {
    expect(resolvePrAutoMergeIntent('always', false)).toBe(false);
  });

  it('policy=ask, requested=undefined → disabled', () => {
    expect(resolvePrAutoMergeIntent('ask', undefined)).toBe(false);
  });

  it('policy=ask, requested=true → enabled', () => {
    expect(resolvePrAutoMergeIntent('ask', true)).toBe(true);
  });

  it('policy=ask, requested=false → disabled', () => {
    expect(resolvePrAutoMergeIntent('ask', false)).toBe(false);
  });

  it('policy=never, requested=undefined → disabled', () => {
    expect(resolvePrAutoMergeIntent('never', undefined)).toBe(false);
  });

  it('policy=never, requested=true → disabled (policy wins)', () => {
    expect(resolvePrAutoMergeIntent('never', true)).toBe(false);
  });

  it('policy=never, requested=false → disabled', () => {
    expect(resolvePrAutoMergeIntent('never', false)).toBe(false);
  });
});

// --- eforge:endregion plan-01-core-engine-auto-merge ---
