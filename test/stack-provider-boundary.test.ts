/**
 * Grep-gate: enforces the provider boundary discipline for stack sync.
 *
 * 1. Non-provider engine modules must not import `stacking/git-spice.ts` directly.
 *    Only the allowlisted factory/index boundaries (git-spice.ts itself, provider.ts,
 *    index.ts) and test files may reference git-spice by path.
 *
 * 2. Non-provider engine modules must not contain hard-coded argv arrays for
 *    `repo sync`, `stack restack`, or `branch submit` — these must only appear
 *    inside `stacking/git-spice.ts`.
 *
 * Mirrors the pattern of `test/decision-helper-discipline.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..');

/** Recursively collect all .ts files under a directory, skipping node_modules and dist. */
function collectTypeScriptFiles(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectTypeScriptFiles(fullPath, files);
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

// ---------------------------------------------------------------------------
// Allowlisted files for git-spice imports
// ---------------------------------------------------------------------------

/**
 * These files may import from stacking/git-spice.ts or reference git-spice by path.
 * Provider implementation, factory, and re-export index are the only non-test
 * engine files that may cross this boundary.
 */
const GIT_SPICE_IMPORT_ALLOWLIST = new Set([
  'packages/engine/src/stacking/git-spice.ts',
  'packages/engine/src/stacking/provider.ts',
  'packages/engine/src/stacking/index.ts',
]);

function isTestFile(relPath: string): boolean {
  return (
    relPath.endsWith('.test.ts') ||
    relPath.endsWith('.test.tsx') ||
    relPath.endsWith('.spec.ts') ||
    relPath.endsWith('.spec.tsx') ||
    relPath.includes('/__tests__/')
  );
}

// ---------------------------------------------------------------------------
// Allowlisted files for hard-coded argv patterns
// ---------------------------------------------------------------------------

/**
 * Only the git-spice adapter implementation may define the raw argv arrays for
 * provider commands. All other engine code must call provider method calls.
 */
const ARGV_ALLOWLIST = new Set([
  'packages/engine/src/stacking/git-spice.ts',
]);

/**
 * Patterns that identify hard-coded git-spice argv in non-provider code.
 * These are the exact argv fragments that only belong inside git-spice.ts.
 */
const FORBIDDEN_ARGV_PATTERNS = [
  "'repo', 'sync'",
  '"repo", "sync"',
  "'stack', 'restack'",
  '"stack", "restack"',
  "'branch', 'submit'",
  '"branch", "submit"',
  // Double-check: argv array construction for these commands
  "['repo', 'sync']",
  '["repo", "sync"]',
  "['stack', 'restack']",
  '["stack", "restack"]',
  "['branch', 'submit'",
  '["branch", "submit"',
];

/**
 * Patterns that indicate an import from stacking/git-spice (by path, not
 * the exported symbols). We look for the path string in import declarations.
 */
const GIT_SPICE_IMPORT_PATTERNS = [
  "from './git-spice'",
  'from "./git-spice"',
  "from './git-spice.js'",
  'from "./git-spice.js"',
  "from '../stacking/git-spice'",
  'from "../stacking/git-spice"',
  "from '../stacking/git-spice.js'",
  'from "../stacking/git-spice.js"',
  "stacking/git-spice'",
  'stacking/git-spice"',
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('stack provider boundary (grep gate)', () => {
  const searchDirs = [
    join(repoRoot, 'packages'),
    join(repoRoot, 'test'),
  ];

  let allFiles: string[];

  try {
    allFiles = [];
    for (const dir of searchDirs) {
      try {
        if (statSync(dir).isDirectory()) {
          collectTypeScriptFiles(dir, allFiles);
        }
      } catch {
        // Directory doesn't exist — skip
      }
    }
  } catch {
    allFiles = [];
  }

  it('only allowlisted files import from stacking/git-spice by path', () => {
    const violations: Array<{ file: string; line: number; text: string }> = [];

    for (const filePath of allFiles) {
      const relPath = relative(repoRoot, filePath).replace(/\\/g, '/');

      // Allowlisted files and test files may import git-spice by path
      if (GIT_SPICE_IMPORT_ALLOWLIST.has(relPath)) continue;
      if (isTestFile(relPath)) continue;

      const content = readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        for (const pattern of GIT_SPICE_IMPORT_PATTERNS) {
          if (line.includes(pattern)) {
            violations.push({ file: relPath, line: i + 1, text: line.trim() });
          }
        }
      }
    }

    if (violations.length > 0) {
      const message = violations
        .map(({ file, line, text }) => `  ${file}:${line}: ${text}`)
        .join('\n');
      throw new Error(
        `Non-provider engine modules import stacking/git-spice directly:\n${message}\n\n` +
          'Only the provider factory/index boundary (git-spice.ts, provider.ts, index.ts) ' +
          'may import git-spice by path. Orchestration code must call provider adapter methods.',
      );
    }

    expect(violations).toHaveLength(0);
  });

  it('only git-spice.ts contains hard-coded argv arrays for repo sync, stack restack, branch submit', () => {
    const violations: Array<{ file: string; line: number; text: string }> = [];

    for (const filePath of allFiles) {
      const relPath = relative(repoRoot, filePath).replace(/\\/g, '/');

      // The git-spice adapter implementation is the only allowed location
      if (ARGV_ALLOWLIST.has(relPath)) continue;

      // Test files may reference argv patterns in fixture construction and assertions
      if (isTestFile(relPath)) continue;

      const content = readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        for (const pattern of FORBIDDEN_ARGV_PATTERNS) {
          if (line.includes(pattern)) {
            violations.push({ file: relPath, line: i + 1, text: line.trim() });
          }
        }
      }
    }

    if (violations.length > 0) {
      const message = violations
        .map(({ file, line, text }) => `  ${file}:${line}: ${text}`)
        .join('\n');
      throw new Error(
        `Non-provider engine modules contain hard-coded git-spice argv:\n${message}\n\n` +
          'Hard-coded argv arrays for repo sync, stack restack, and branch submit must only ' +
          'appear in packages/engine/src/stacking/git-spice.ts. Orchestration code must call ' +
          'provider adapter methods (provider.syncRepo(), provider.restackStack(), etc.).',
      );
    }

    expect(violations).toHaveLength(0);
  });
});
