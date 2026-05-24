/**
 * Tests for stacking/landing config parsing and PRD frontmatter stack fields.
 *
 * Verifies:
 *   1. parseRawConfig accepts stacking.enabled, stacking.provider, stacking.gitSpice.command.
 *   2. parseRawConfig accepts landing.action.
 *   3. resolveConfig applies stacking/landing defaults when section absent.
 *   4. resolveConfig preserves explicit stacking/landing values.
 *   5. validatePrdFrontmatter accepts stack_id, stack_parent, and landing: pr.
 *   6. validatePrdFrontmatter rejects an unsupported stack_provider value.
 *   7. loadConfig emits a deprecation warning when build.onSuccess is set.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseRawConfig,
  resolveConfig,
  DEFAULT_CONFIG,
  loadConfig,
  ConfigMigrationError,
} from '@eforge-build/engine/config';
import { validatePrdFrontmatter } from '@eforge-build/engine/prd-queue';

// ---------------------------------------------------------------------------
// parseRawConfig — stacking / landing config
// ---------------------------------------------------------------------------

describe('parseRawConfig — stacking config', () => {
  it('accepts stacking.enabled: true, stacking.provider: git-spice', () => {
    const result = parseRawConfig({
      stacking: {
        enabled: true,
        provider: 'git-spice',
      },
    });
    expect(result.stacking?.enabled).toBe(true);
    expect(result.stacking?.provider).toBe('git-spice');
  });

  it('accepts stacking.gitSpice.command override', () => {
    const result = parseRawConfig({
      stacking: {
        gitSpice: { command: '/opt/homebrew/bin/git-spice' },
      },
    });
    expect(result.stacking?.gitSpice?.command).toBe('/opt/homebrew/bin/git-spice');
  });

  it('accepts landing.action: pr', () => {
    const result = parseRawConfig({ landing: { action: 'pr' } });
    expect(result.landing?.action).toBe('pr');
  });

  it('accepts all valid landing actions', () => {
    for (const action of ['pr', 'merge', 'leave'] as const) {
      const result = parseRawConfig({ landing: { action } });
      expect(result.landing?.action).toBe(action);
    }
  });

  it('rejects unknown landing action', () => {
    expect(() => parseRawConfig({ landing: { action: 'issue-pr' } })).toThrow();
  });

  it('rejects unsupported stacking provider', () => {
    expect(() => parseRawConfig({ stacking: { provider: 'github-stacking' } })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// resolveConfig — stacking / landing defaults and overrides
// ---------------------------------------------------------------------------

describe('resolveConfig — stacking / landing', () => {
  it('applies stacking defaults when section absent', () => {
    const config = resolveConfig({}, {});
    expect(config.stacking.enabled).toBe(DEFAULT_CONFIG.stacking.enabled);
    expect(config.stacking.provider).toBe('git-spice');
  });

  it('applies landing default action when section absent', () => {
    const config = resolveConfig({}, {});
    expect(config.landing.action).toBe(DEFAULT_CONFIG.landing.action);
  });

  it('preserves explicit stacking fields', () => {
    const config = resolveConfig(
      {
        stacking: {
          enabled: true,
          provider: 'git-spice',
          gitSpice: { command: '/usr/local/bin/gs' },
        },
      },
      {},
    );
    expect(config.stacking.enabled).toBe(true);
    expect(config.stacking.gitSpice.command).toBe('/usr/local/bin/gs');
  });

  it('preserves explicit landing.action: pr', () => {
    const config = resolveConfig({ landing: { action: 'pr' } }, {});
    expect(config.landing.action).toBe('pr');
  });
});

// ---------------------------------------------------------------------------
// validatePrdFrontmatter — stack fields
// ---------------------------------------------------------------------------

describe('validatePrdFrontmatter — stack fields', () => {
  const baseRequired = { title: 'My PRD' };

  it('accepts stack_id and stack_parent', () => {
    const result = validatePrdFrontmatter({
      ...baseRequired,
      stack_id: 'stack-abc',
      stack_parent: 'feat-parent',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stack_id).toBe('stack-abc');
      expect(result.data.stack_parent).toBe('feat-parent');
    }
  });

  it('accepts landing: pr', () => {
    const result = validatePrdFrontmatter({ ...baseRequired, landing: 'pr' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.landing).toBe('pr');
    }
  });

  it('accepts all valid landing values in frontmatter', () => {
    for (const landing of ['pr', 'merge', 'leave'] as const) {
      const result = validatePrdFrontmatter({ ...baseRequired, landing });
      expect(result.success).toBe(true);
    }
  });

  it('rejects unsupported stack_provider value', () => {
    const result = validatePrdFrontmatter({
      ...baseRequired,
      stack_provider: 'github-stacking',
    });
    expect(result.success).toBe(false);
  });

  it('accepts stack_provider: git-spice', () => {
    const result = validatePrdFrontmatter({
      ...baseRequired,
      stack_provider: 'git-spice',
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// loadConfig — deprecation warning for build.onSuccess
// ---------------------------------------------------------------------------

describe('loadConfig — build.onSuccess deprecation warning', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'eforge-config-stack-'));
    await mkdir(join(cwd, 'eforge'), { recursive: true });
  });

  it('throws a migration error when build.onSuccess is set', async () => {
    await writeFile(
      join(cwd, 'eforge', 'config.yaml'),
      'build:\n  onSuccess: issue-pr\n',
      'utf-8',
    );
    await expect(loadConfig(cwd)).rejects.toThrow(ConfigMigrationError);
    await expect(loadConfig(cwd)).rejects.toThrow('landing.action');
  });

  it('emits no onSuccess warning when landing.action is used instead', async () => {
    await writeFile(
      join(cwd, 'eforge', 'config.yaml'),
      'landing:\n  action: pr\n',
      'utf-8',
    );
    const { warnings } = await loadConfig(cwd);
    const hasWarning = warnings.some((w) => w.includes('build.onSuccess'));
    expect(hasWarning).toBe(false);
  });
});
