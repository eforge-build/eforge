/**
 * docs-gen determinism and drift guard.
 *
 * Runs the documentation generator in-process and asserts:
 *   1. All generated files are byte-identical to the checked-in copies (drift check).
 *   2. Running the generator twice produces byte-identical output (determinism check).
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findRepoRoot, getOutputPaths } from '@eforge-build/docs-gen/output-paths';
import { runDriftCheck, runGenerators } from '@eforge-build/docs-gen/check';

const AUDITED_TOP_LEVEL_CONFIG_KEYS = [
  'agents',
  'build',
  'daemon',
  'hooks',
  'langfuse',
  'maxConcurrentBuilds',
  'monitor',
  'plan',
  'plugins',
  'prdQueue',
  'tools',
] as const;

function twoColumnRowsWithEmptyDescription(markdown: string): string[] {
  return markdown
    .split('\n')
    .filter((line) => /^\| `[^`]+` \|\s*\|$/.test(line));
}

function readMarkdownTableDescription(markdown: string, key: string): string | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^\\| \`${escaped}\` \\| (.*) \\|$`, 'm').exec(markdown);
  return match?.[1].trim();
}

describe('docs-gen drift check', () => {
  it('checked-in generated files are byte-identical to what the generator produces', async () => {
    const result = await runDriftCheck();
    if (!result.ok) {
      throw new Error(
        `Docs drift detected in ${result.changed.length} file(s): ${result.changed.join(', ')}\n` +
          'Run `pnpm docs:generate` to update the checked-in artifacts.',
      );
    }
    expect(result.ok).toBe(true);
    expect(result.changed).toHaveLength(0);
  }, 120_000);

  it('omits volatile eforge package versions from generated artifacts', async () => {
    const repoRoot = findRepoRoot();
    const paths = getOutputPaths(repoRoot);

    for (const [key, path] of Object.entries(paths)) {
      const content = await readFile(path, 'utf-8');
      expect(content, `${key} should not include release-version provenance`).not.toContain('eforge version:');
      expect(content, `${key} should not include release-version comments`).not.toContain('<!-- eforge version');
    }
  });

  it('generated config reference describes build.onSuccess as removed/rejected, not backward-compatible', async () => {
    const repoRoot = findRepoRoot();
    const paths = getOutputPaths(repoRoot);

    const content = await readFile(paths.contentConfig, 'utf-8');
    // Must not claim backward compatibility or emit deprecation warnings for build.onSuccess
    expect(content).not.toContain('kept for backward compatibility');
    expect(content).not.toContain('deprecation warning');
    // Must include migration guidance with the rejected values
    expect(content).toContain('build.onSuccess');
    expect(content).toContain('issue-pr');
    expect(content).toContain('merge-to-base-branch');
    expect(content).toContain('leave-branch');
  });

  it('generated tool and config reference tables have public descriptions for audited rows', async () => {
    const repoRoot = findRepoRoot();
    const paths = getOutputPaths(repoRoot);

    for (const path of [paths.contentTools, paths.publicTools, paths.contentConfig, paths.publicConfig]) {
      const content = await readFile(path, 'utf-8');
      expect(twoColumnRowsWithEmptyDescription(content), `${path} should not have blank generated descriptions`).toEqual([]);
    }

    for (const path of [paths.contentConfig, paths.publicConfig]) {
      const content = await readFile(path, 'utf-8');
      for (const key of AUDITED_TOP_LEVEL_CONFIG_KEYS) {
        expect(readMarkdownTableDescription(content, key), `${path} ${key} description`).toBeTruthy();
      }
    }

    for (const path of [paths.contentTools, paths.publicTools]) {
      const content = await readFile(path, 'utf-8');
      expect(content).toContain('`eforge_apply_recovery` | Apply the recovery verdict for a failed build plan. The action is performed in-process by the daemon');
    }
  });
});

describe('docs-gen determinism', () => {
  it('generates byte-identical output on two consecutive runs', async () => {
    const repoRoot = findRepoRoot();

    const tmpA = mkdtempSync(join(tmpdir(), 'eforge-docs-det-a-'));
    const tmpB = mkdtempSync(join(tmpdir(), 'eforge-docs-det-b-'));

    try {
      const pathsA = getOutputPaths(tmpA);
      const pathsB = getOutputPaths(tmpB);

      await runGenerators(repoRoot, pathsA);
      await runGenerators(repoRoot, pathsB);

      const allKeys = Object.keys(pathsA) as Array<keyof typeof pathsA>;
      const mismatches: string[] = [];

      for (const key of allKeys) {
        const [contentA, contentB] = await Promise.all([
          readFile(pathsA[key], 'utf-8').catch(() => null),
          readFile(pathsB[key], 'utf-8').catch(() => null),
        ]);
        if (contentA !== contentB) {
          mismatches.push(key);
        }
      }

      if (mismatches.length > 0) {
        throw new Error(
          `Non-deterministic output detected for: ${mismatches.join(', ')}`,
        );
      }

      expect(mismatches).toHaveLength(0);
    } finally {
      await Promise.allSettled([
        rm(tmpA, { recursive: true, force: true }),
        rm(tmpB, { recursive: true, force: true }),
      ]);
    }
  }, 120_000);
});
