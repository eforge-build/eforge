// This script uses ESLint + eslint-plugin-sonarjs exclusively for the cognitive-complexity scan.
// ESLint is NOT a general-purpose linter for this repo — no other ESLint config is present at the
// repo root. If you're looking for a lint setup, this is not it.

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve, relative } from 'node:path';

const require = createRequire(import.meta.url);

// Pre-flight: assert eslint-plugin-sonarjs is installed and exposes cognitive-complexity
let sonarjs;
try {
  sonarjs = require('eslint-plugin-sonarjs');
} catch (err) {
  const code = /** @type {{ code?: string, message?: string }} */ (err).code;
  if (code === 'MODULE_NOT_FOUND' || code === 'ERR_MODULE_NOT_FOUND') {
    console.error(
      'ERROR: eslint-plugin-sonarjs is not installed.\n' +
      'Run: pnpm add -D "eslint-plugin-sonarjs@^4"'
    );
  } else {
    console.error(
      'ERROR: Failed to load eslint-plugin-sonarjs:\n' +
      `  ${/** @type {{ message?: string }} */ (err).message ?? String(err)}`
    );
  }
  process.exit(1);
}

const ruleKeys = Object.keys(sonarjs.rules ?? {});
if (!ruleKeys.includes('cognitive-complexity')) {
  console.error(
    `ERROR: eslint-plugin-sonarjs is installed but does not export a 'cognitive-complexity' rule.\n` +
    `Found rules: ${ruleKeys.slice(0, 10).join(', ')}${ruleKeys.length > 10 ? ', ...' : ''}\n` +
    `Expected eslint-plugin-sonarjs@^4. Run: pnpm add -D "eslint-plugin-sonarjs@^4"`
  );
  process.exit(1);
}

// Run ESLint with the scan-only config
const eslintBin = resolve('node_modules/.bin/eslint');
const configPath = resolve('scripts/complexity.eslint.config.mjs');

// Pass the glob pattern directly to ESLint without shell expansion so ESLint
// handles it with its own glob engine (fast-glob). shell: false is intentional.
const result = spawnSync(
  eslintBin,
  ['--no-config-lookup', '--config', configPath, '--format', 'json', 'packages/**/*.ts'],
  { encoding: 'utf8', shell: false, maxBuffer: 50 * 1024 * 1024 }
);

if (result.error) {
  console.error('ERROR: Failed to spawn ESLint:', result.error.message);
  process.exit(1);
}

// ESLint exits 1 when there are lint warnings/errors — that's expected. Exit code 2 means
// ESLint itself crashed (bad config, missing file, etc.); surface that with stderr context.
if (result.status === 2) {
  console.error('ERROR: ESLint exited with code 2 (config or invocation error).');
  if (result.stderr) console.error(result.stderr.slice(0, 2000));
  process.exit(1);
}

let lintResults;
try {
  lintResults = JSON.parse(result.stdout);
} catch {
  console.error('ERROR: Could not parse ESLint JSON output.');
  if (result.stdout) console.error(result.stdout.slice(0, 1000));
  if (result.stderr) console.error(result.stderr.slice(0, 500));
  process.exit(1);
}

// Extract highest CC per file and the line where it occurs
// SonarJS reports: "Refactor this function to reduce its Cognitive Complexity from N to the 30 allowed."
const CC_PATTERN = /Cognitive Complexity.*?from (\d+)/i;

const fileData = [];
for (const fileResult of lintResults) {
  if (!fileResult.messages || fileResult.messages.length === 0) continue;

  let maxCC = 0;
  let maxLine = 1;

  for (const msg of fileResult.messages) {
    const match = CC_PATTERN.exec(msg.message);
    if (match) {
      const cc = parseInt(match[1], 10);
      if (cc > maxCC) {
        maxCC = cc;
        maxLine = msg.line ?? 1;
      }
    }
  }

  if (maxCC === 0) continue;

  const relPath = relative(process.cwd(), fileResult.filePath);

  // Compute git churn: number of non-empty output lines from git log over the last year
  let churn = 0;
  try {
    const gitResult = spawnSync(
      'git',
      ['log', '--since=1 year ago', '--pretty=format:', '--name-only', '--', fileResult.filePath],
      { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
    );
    if (!gitResult.error && gitResult.status === 0) {
      churn = gitResult.stdout
        .split('\n')
        .filter(line => line.trim().length > 0)
        .length;
    }
  } catch {
    // churn stays 0 — not fatal
  }

  fileData.push({ relPath, line: maxLine, cc: maxCC, churn, score: churn * maxCC });
}

// Sort by score (churn × CC) descending, cap at 30 rows
fileData.sort((a, b) => b.score - a.score);
const top = fileData.slice(0, 30);

if (top.length === 0) {
  console.log('No cognitive complexity violations found above threshold 30.');
  process.exit(0);
}

// Print markdown table
console.log('| Rank | File:line | CC | Churn | churn × CC |');
console.log('|------|-----------|----|-------|------------|');
for (let i = 0; i < top.length; i++) {
  const e = top[i];
  console.log(`| ${i + 1} | \`${e.relPath}:${e.line}\` | ${e.cc} | ${e.churn} | ${e.score} |`);
}

// Footer: Σ(CC - 15) across printed rows where CC > 15
const totalAddressable = top.reduce((sum, e) => sum + Math.max(0, e.cc - 15), 0);
console.log('');
console.log(`Total addressable CC reduction: Σ(CC - 15) = ${totalAddressable}`);
