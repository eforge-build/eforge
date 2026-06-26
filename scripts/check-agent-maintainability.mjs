/**
 * Agent-maintainability ratchet.
 *
 * Checks:
 *  1. Implementation files not in the baseline must be <= IMPL_CAP lines.
 *  2. Test files not in the baseline must be <= TEST_CAP lines.
 *  3. Files listed in the baseline must not exceed their noGrowthCeiling.
 *  4. Every eforge region marker in every scanned file must be balanced
 *     (each `// --- eforge:region <slug> ---` needs a matching
 *      `// --- eforge:endregion <slug> ---`).
 *
 * Exits 0 on success, non-zero on any violation.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const REPO_ROOT = process.cwd();

const IMPL_CAP = 600;
const TEST_CAP = 1200;

// Directories to skip entirely during traversal.
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  '.eforge',
  // Plan artifact directories and worktree scratch dirs are ephemeral.
  '__merge__',
  '__prd__',
  // Generated/build output directories that should not be linted.
  '.next',
  'coverage',
  '.turbo',
  'out',
  'build',
  'storybook-static',
]);

// File extensions considered TypeScript/JavaScript implementation or test files.
const IMPL_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);

// Patterns that identify a file as a test file.
const TEST_PATTERNS = [
  /\.test\.[mc]?[tj]sx?$/,
  /\.spec\.[mc]?[tj]sx?$/,
  /\/__tests__\//,
  /\/test\//,
  /^test\//,
];

function isTestFile(relPath) {
  return TEST_PATTERNS.some((p) => p.test(relPath));
}

function isImplementationFile(relPath) {
  return IMPL_EXTENSIONS.has(extname(relPath));
}

/**
 * Recursively walk a directory, calling `cb(absolutePath, relativePath)` for
 * every file whose extension is in IMPL_EXTENSIONS.
 */
function walkFiles(dir, cb, baseDir = dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, cb, baseDir);
    } else if (entry.isFile() && IMPL_EXTENSIONS.has(extname(entry.name))) {
      const relPath = relative(REPO_ROOT, fullPath).replace(/\\/g, '/');
      cb(fullPath, relPath);
    }
  }
}

/**
 * Count non-empty lines in a file. We count all lines (including blank lines)
 * to match `wc -l` semantics, which is what the baseline ceilings were
 * measured with.
 */
function countLines(absPath) {
  try {
    const content = readFileSync(absPath, 'utf-8');
    // wc -l counts newline characters; replicate that.
    let count = 0;
    for (let i = 0; i < content.length; i++) {
      if (content[i] === '\n') count++;
    }
    // Files without a trailing newline still have at least 1 line of content.
    if (content.length > 0 && content[content.length - 1] !== '\n') count++;
    return count;
  } catch {
    return 0;
  }
}

/**
 * Check region marker balance within a single file's content.
 *
 * Uses a stack-based approach: each `region` marker pushes its slug onto a
 * stack, and each `endregion` marker must match the slug at the top of the
 * stack. This correctly rejects crossed markers such as:
 *
 *   // --- eforge:region a ---
 *   // --- eforge:region b ---
 *   // --- eforge:endregion a ---  ← error: top of stack is "b"
 *   // --- eforge:endregion b ---
 *
 * Multiple sequential (non-nested) blocks with the same slug are permitted;
 * each must be individually closed before the next opens.
 *
 * Returns an array of error strings (empty if balanced).
 */
function checkMarkerBalance(relPath, content) {
  const errors = [];
  const regionPattern = /^[ \t]*\/\/\s*---\s*eforge:(region|endregion)\s+([\w-]+)\s*---/gm;

  // Stack of { slug, lineNumber } for currently open (unclosed) regions.
  const stack = [];

  let match;
  while ((match = regionPattern.exec(content)) !== null) {
    const [, kind, slug] = match;
    // Count newlines up to match index to find line number.
    const lineNumber = content.slice(0, match.index).split('\n').length;

    if (kind === 'region') {
      stack.push({ slug, lineNumber });
    } else {
      // endregion
      if (stack.length === 0) {
        errors.push(
          `${relPath}: endregion for "${slug}" at line ${lineNumber} has no matching region marker (stack is empty)`
        );
      } else if (stack[stack.length - 1].slug !== slug) {
        const open = stack[stack.length - 1];
        errors.push(
          `${relPath}: endregion for "${slug}" at line ${lineNumber} does not match open region "${open.slug}" (opened at line ${open.lineNumber}) — crossed markers`
        );
        // Do not pop — leave the open region on the stack so subsequent
        // markers can surface further issues without cascading false positives.
      } else {
        stack.pop();
      }
    }
  }

  for (const { slug, lineNumber } of stack) {
    errors.push(
      `${relPath}: region "${slug}" opened at line ${lineNumber} has no matching endregion marker`
    );
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Load baseline
// ---------------------------------------------------------------------------

const baselinePath = join(REPO_ROOT, 'scripts', 'agent-maintainability-baseline.json');
let baseline;
try {
  baseline = JSON.parse(readFileSync(baselinePath, 'utf-8'));
} catch (err) {
  console.error(`ERROR: Could not load baseline file at ${baselinePath}: ${err.message}`);
  process.exit(1);
}

/** Map from relative path -> { noGrowthCeiling, category } */
const baselineMap = new Map(
  (baseline.files ?? []).map((entry) => [
    entry.path,
    { noGrowthCeiling: entry.noGrowthCeiling, category: entry.category },
  ])
);

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

const violations = [];
const markerErrors = [];

// Walk from the repository root so root-level implementation files are included.
// SKIP_DIRS handles node_modules, dist, .git, and other undesirable directories.
walkFiles(REPO_ROOT, (absPath, relPath) => {
  if (!isImplementationFile(relPath)) return;

  const lineCount = countLines(absPath);
  const content = readFileSync(absPath, 'utf-8');

  // Check region marker balance regardless of size.
  if (content.includes('eforge:region') || content.includes('eforge:endregion')) {
    const errors = checkMarkerBalance(relPath, content);
    markerErrors.push(...errors);
  }

  const baselineEntry = baselineMap.get(relPath);

  if (baselineEntry) {
    // File is in the baseline — enforce no-growth ceiling.
    if (lineCount > baselineEntry.noGrowthCeiling) {
      violations.push(
        `BASELINE EXCEEDED  ${relPath}: ${lineCount} lines (ceiling: ${baselineEntry.noGrowthCeiling})`
      );
    }
  } else {
    // File is not in the baseline — enforce hard cap by category.
    const cap = isTestFile(relPath) ? TEST_CAP : IMPL_CAP;
    if (lineCount > cap) {
      const category = isTestFile(relPath) ? 'test' : 'implementation';
      violations.push(
        `CAP EXCEEDED  ${relPath}: ${lineCount} lines (${category} cap: ${cap})`
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

let exitCode = 0;

if (markerErrors.length > 0) {
  console.error('\nRegion marker balance violations:');
  for (const err of markerErrors) {
    console.error(`  ${err}`);
  }
  exitCode = 1;
}

if (violations.length > 0) {
  console.error('\nFile size violations:');
  for (const v of violations) {
    console.error(`  ${v}`);
  }
  exitCode = 1;
}

if (exitCode === 0) {
  console.log('Agent maintainability check passed.');
}

process.exit(exitCode);
