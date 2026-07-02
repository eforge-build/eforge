/**
 * Grep-gate: enforces that the scorched-earth planning deletion stays deleted.
 *
 * The expedition planning path, the pipeline-composer/module-planner roles,
 * the retry-as-expedition recovery action, and the ORCHESTRATION_MODES scope
 * enum were removed from the engine, client, console, and monitor. This test
 * fails if any source file in those packages reintroduces a reference.
 *
 * Mirrors the pattern of `decision-helper-discipline.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..');

/** Recursively collect all `.ts` and `.tsx` files under a directory. */
function collectTypeScriptFiles(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectTypeScriptFiles(fullPath, files);
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * Files permitted to contain a pattern, with the reason.
 *
 * - `content-validation.ts`, `session-plan.ts`, `extension-agent-tasks.ts`:
 *   session-plan profiles are named errand/excursion/expedition — surviving
 *   session-plan vocabulary that is unrelated to the deleted orchestration
 *   scope enum.
 * - `api-version-const.ts`: the DAEMON_API_VERSION history comment records
 *   what the v82 bump deleted.
 */
const ALLOWLIST = new Set([
  'packages/monitor/src/routes/content-validation.ts',
  'packages/client/src/routes/session-plan.ts',
  'packages/client/src/extension-agent-tasks.ts',
  'packages/client/src/api-version-const.ts',
]);

/** Case-insensitive substrings that must not appear in gated source. */
const FORBIDDEN_PATTERNS = [
  'expedition',
  'module-planner',
  'pipeline-composer',
  'retry-as-expedition',
  'orchestration_modes',
];

/** Source roots covered by the gate (per the deletion PRD). */
const GATED_SOURCE_DIRS = [
  'packages/engine/src',
  'packages/client/src',
  'packages/console-ui/src',
  'packages/monitor/src',
];

describe('planning deletion discipline (grep gate)', () => {
  it('keeps expedition/composer/scope-enum references out of engine, client, console, and monitor source', () => {
    const allFiles: string[] = [];
    for (const dir of GATED_SOURCE_DIRS) {
      const fullDir = join(repoRoot, dir);
      try {
        if (statSync(fullDir).isDirectory()) {
          collectTypeScriptFiles(fullDir, allFiles);
        }
      } catch {
        // Directory doesn't exist — skip
      }
    }

    const violations: Array<{ file: string; line: number; text: string }> = [];

    for (const filePath of allFiles) {
      const relPath = relative(repoRoot, filePath).replace(/\\/g, '/');
      if (ALLOWLIST.has(relPath)) continue;

      // Test files inside package source trees are still gated: the deleted
      // surface must not survive anywhere in these packages.
      const content = readFileSync(filePath, 'utf-8').toLowerCase();
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        for (const pattern of FORBIDDEN_PATTERNS) {
          if (line.includes(pattern)) {
            violations.push({ file: relPath, line: i + 1, text: line.trim() });
          }
        }
      }
    }

    if (violations.length > 0) {
      const message = [
        'Deleted planning-path reference found.',
        'The expedition path, pipeline-composer/module-planner roles, retry-as-expedition action, and ORCHESTRATION_MODES enum were removed by the scorched-earth planning deletion and must not be reintroduced.',
        '',
        ...violations.map((v) => `  ${v.file}:${v.line}  ${v.text}`),
      ].join('\n');
      expect.fail(message);
    }

    expect(violations).toHaveLength(0);
  });
});
