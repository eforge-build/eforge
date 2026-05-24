/**
 * Tests for build.onSuccess config field: defaulting, merging, and validation.
 */

import { describe, it, expect } from 'vitest';
import { resolveConfig, DEFAULT_CONFIG, eforgeConfigSchema } from '@eforge-build/engine/config';

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
