/**
 * Static policy tests: Pi extension must not use auto-starting daemon calls.
 *
 * Guards that:
 *   1. Zero bare `daemonRequest` imports or call-sites exist in
 *      packages/pi-eforge/extensions/eforge/ — only `daemonRequestIfRunning`
 *      or the Pi-local wrapper names (`piDaemonRequest`, `requireDaemon`) are
 *      permitted.
 *   2. No `api*` client helpers lacking an `IfRunning` suffix are value-imported
 *      in packages/pi-eforge/extensions/eforge/. Type-only imports and
 *      non-api* identifiers are excluded from this check.
 *   3. Exactly two `ensureDaemon(` call-sites exist in packages/pi-eforge/,
 *      both inside the eforge_daemon start/restart handling in index.ts.
 *   4. Pi skill docs (.md files under packages/pi-eforge/skills/) contain no
 *      passive auto-start claims ("daemon auto-starts", "auto-start the daemon",
 *      "auto starts the daemon", "automatically starts the daemon").
 *
 * Follows AGENTS.md: no mocks, no fixtures — reads source text directly.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// File-gathering helpers
// ---------------------------------------------------------------------------

/** Recursively collect all files matching a suffix under a directory. */
function collectFiles(dir: string, suffix: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(fullPath, suffix));
    } else if (entry.isFile() && entry.name.endsWith(suffix)) {
      results.push(fullPath);
    }
  }
  return results;
}

function readSource(filePath: string): string {
  return readFileSync(filePath, 'utf-8');
}

// ---------------------------------------------------------------------------
// Source file sets
// ---------------------------------------------------------------------------

const EXTENSION_DIR = join(REPO_ROOT, 'packages/pi-eforge/extensions/eforge');
const PI_EFORGE_DIR = join(REPO_ROOT, 'packages/pi-eforge');
const PI_SKILLS_DIR = join(REPO_ROOT, 'packages/pi-eforge/skills');

const extensionTsFiles = collectFiles(EXTENSION_DIR, '.ts');
const piEforgeTsFiles = collectFiles(PI_EFORGE_DIR, '.ts');
const piSkillMdFiles = collectFiles(PI_SKILLS_DIR, '.md');

// ---------------------------------------------------------------------------
// Check 1: No bare daemonRequest usage in pi-eforge extension files
// ---------------------------------------------------------------------------

describe('Pi extension: no bare daemonRequest usage', () => {
  // The only permitted names that include "daemonRequest":
  //   - daemonRequestIfRunning (the non-starting client helper)
  //   - piDaemonRequest (Pi-local wrapper in daemon-requests.ts)
  //   - requireDaemon (Pi-local throwing wrapper — different prefix, won't match anyway)
  //
  // The forbidden pattern is: the identifier `daemonRequest` used in a call
  // context where it is NOT `daemonRequestIfRunning`.
  //
  // Strategy: find all occurrences of `daemonRequest` and assert each one is
  // either `daemonRequestIfRunning` or `piDaemonRequest`.

  for (const filePath of extensionTsFiles) {
    it(`${filePath.replace(REPO_ROOT + '/', '')} — no bare daemonRequest`, () => {
      const source = readSource(filePath);

      // Find all occurrences of "daemonRequest" and verify none of them are
      // the bare auto-starting variant.
      const matches = [...source.matchAll(/\bdaemonRequest\b/g)];

      const violations: string[] = [];
      for (const match of matches) {
        const occurrence = source.slice(match.index ?? 0, (match.index ?? 0) + 40);
        // Allowed: daemonRequestIfRunning (starts with daemonRequestIfRunning)
        // Also: piDaemonRequest starts with "piDaemon", not "daemonRequest", so it won't match here
        if (!occurrence.startsWith('daemonRequestIfRunning')) {
          violations.push(`  at offset ${match.index}: ${JSON.stringify(occurrence.trim())}`);
        }
      }

      expect(
        violations,
        `${filePath.replace(REPO_ROOT + '/', '')} must not use bare daemonRequest:\n${violations.join('\n')}`,
      ).toHaveLength(0);
    });
  }
});

// ---------------------------------------------------------------------------
// Check 2: No non-IfRunning api* value-imports from @eforge-build/client
// ---------------------------------------------------------------------------

describe('Pi extension: no non-IfRunning api* client imports', () => {
  // Allowlisted non-request utilities / non-api identifiers that are permitted
  // as value imports without IfRunning suffix. These are infrastructure
  // utilities, constants, and lockfile helpers — not HTTP route helpers.
  //
  // Rationale documented here so reviewers understand exactly what is allowed:
  //   - readLockfile, isServerAlive: lockfile/process utilities
  //   - ensureDaemon: only used in explicit start/restart (tested separately)
  //   - daemonRequestIfRunning: non-starting request helper (allowed by name convention)
  //   - sleep, sanitizeProfileName, parseRawConfigLegacy: utilities
  //   - LOCKFILE_POLL_INTERVAL_MS, LOCKFILE_POLL_TIMEOUT_MS: constants
  //   - API_ROUTES, buildPath: routing utilities
  //   - DaemonInWorktreeError, isAgentWorktreeCwd: error/guard utilities
  //   - DAEMON_API_VERSION: constant
  const ALLOWED_NON_IF_RUNNING_IDENTIFIERS = new Set([
    'readLockfile',
    'isServerAlive',
    'ensureDaemon',
    'daemonRequestIfRunning',
    'sleep',
    'sanitizeProfileName',
    'parseRawConfigLegacy',
    'LOCKFILE_POLL_INTERVAL_MS',
    'LOCKFILE_POLL_TIMEOUT_MS',
    'API_ROUTES',
    'buildPath',
    'DaemonInWorktreeError',
    'isAgentWorktreeCwd',
    'DAEMON_API_VERSION',
    'clearApiVersionCache',
    'writeLockfile',
    'removeLockfile',
    'updateLockfile',
    'LOCKFILE_NAME',
    'lockfilePath',
  ]);

  for (const filePath of extensionTsFiles) {
    it(`${filePath.replace(REPO_ROOT + '/', '')} — no non-IfRunning api* client imports`, () => {
      const source = readSource(filePath);

      // Extract value-import lines from @eforge-build/client.
      // Ignore `import type` lines — those are type-only and don't involve runtime calls.
      const violations: string[] = [];

      // Match multi-line import blocks from @eforge-build/client
      const importBlockPattern = /^import\s*\{([^}]+)\}\s*from\s*['"]@eforge-build\/client['"]/gm;
      for (const blockMatch of source.matchAll(importBlockPattern)) {
        const importLine = source.slice(blockMatch.index ?? 0, (blockMatch.index ?? 0) + 5);
        // Skip type-only imports: `import type { ... }`
        if (/^\s*import\s+type\s/.test(source.slice(blockMatch.index ?? 0, (blockMatch.index ?? 0) + 30))) {
          continue;
        }

        const identifierBlock = blockMatch[1];
        // Split on commas and newlines to get individual identifiers
        const identifiers = identifierBlock
          .split(/[,\n]/)
          .map((s) => s.replace(/\s/g, '').replace(/^type\s+/, ''))
          .filter(Boolean)
          .filter((s) => !s.startsWith('//'))
          // Remove inline `type` re-export prefixes within mixed imports
          .map((s) => s.replace(/^type\s+/, ''));

        for (const id of identifiers) {
          // Only check `api*` identifiers (starts with lowercase "api" followed by uppercase)
          if (!/^api[A-Z]/.test(id)) continue;

          // Allowed: ends with IfRunning
          if (id.endsWith('IfRunning')) continue;

          // Allowed: explicitly in the allowlist
          if (ALLOWED_NON_IF_RUNNING_IDENTIFIERS.has(id)) continue;

          violations.push(`  ${filePath.replace(REPO_ROOT + '/', '')}: forbidden import: ${id}`);
        }
      }

      // Also catch namespace imports (`import * as client`) followed by
      // client.apiFoo(...) call-sites, which bypass named-import checks.
      for (const nsMatch of source.matchAll(/^import\s+\*\s+as\s+(\w+)\s+from\s*['"]@eforge-build\/client['"]/gm)) {
        const alias = nsMatch[1];
        const namespaceCallPattern = new RegExp(`\\b${alias}\\.(api[A-Z]\\w*)\\b`, 'g');
        for (const callMatch of source.matchAll(namespaceCallPattern)) {
          const id = callMatch[1];
          if (!id.endsWith('IfRunning')) {
            violations.push(`  ${filePath.replace(REPO_ROOT + '/', '')}: forbidden namespace call: ${alias}.${id}`);
          }
        }
      }

      expect(
        violations,
        `Non-IfRunning api* client helpers must not be value-imported or called through a namespace import:\n${violations.join('\n')}`,
      ).toHaveLength(0);
    });
  }
});

// ---------------------------------------------------------------------------
// Check 3: Exactly two ensureDaemon calls in packages/pi-eforge, both in
//          eforge_daemon start/restart handling
// ---------------------------------------------------------------------------

describe('Pi extension: exactly two ensureDaemon calls, both in start/restart', () => {
  it('finds exactly two ensureDaemon( call-sites in packages/pi-eforge/', () => {
    const callSites: Array<{ file: string; line: number; context: string }> = [];

    for (const filePath of piEforgeTsFiles) {
      const source = readSource(filePath);
      const lines = source.split('\n');
      lines.forEach((line, idx) => {
        if (/\bensureDaemon\s*\(/.test(line)) {
          callSites.push({
            file: filePath.replace(REPO_ROOT + '/', ''),
            line: idx + 1,
            context: lines.slice(Math.max(0, idx - 6), idx + 2).join('\n'),
          });
        }
      });
    }

    expect(
      callSites,
      `Expected exactly 2 ensureDaemon() call-sites in packages/pi-eforge/, found ${callSites.length}:\n` +
        callSites.map((s) => `  ${s.file}:${s.line}: ${s.context}`).join('\n'),
    ).toHaveLength(2);

    // Both calls must be in index.ts (not in any command helper file)
    for (const site of callSites) {
      expect(
        site.file,
        `ensureDaemon() must only appear in index.ts, found in: ${site.file}`,
      ).toMatch(/extensions\/eforge\/index\.ts$/);
    }

    const contexts = callSites.map((site) => site.context).join('\n---\n');
    expect(
      contexts,
      'one ensureDaemon() call must be guarded by the explicit eforge_daemon start action',
    ).toMatch(/action === ["']start["'][\s\S]*ensureDaemon\s*\(/);
    expect(
      contexts,
      'one ensureDaemon() call must be in the explicit eforge_daemon restart branch',
    ).toMatch(/(?:restart|stopResult)[\s\S]*ensureDaemon\s*\(/);
  });
});

// ---------------------------------------------------------------------------
// Check 4: Pi skill docs contain no passive auto-start claims
// ---------------------------------------------------------------------------

describe('Pi skill docs: no passive auto-start claims', () => {
  // Forbidden phrases that imply the daemon auto-starts without an explicit
  // user action. These must not appear in Pi skill docs.
  const FORBIDDEN_PHRASES = [
    'daemon auto-starts',
    'auto-start the daemon',
    'auto starts the daemon',
    'automatically starts the daemon',
    'auto-starting the daemon',
    'automatically start the daemon',
  ];

  for (const filePath of piSkillMdFiles) {
    it(`${filePath.replace(REPO_ROOT + '/', '')} — no passive auto-start claims`, () => {
      const source = readSource(filePath).toLowerCase();
      const violations: string[] = [];

      for (const phrase of FORBIDDEN_PHRASES) {
        if (source.includes(phrase.toLowerCase())) {
          violations.push(`  forbidden phrase: "${phrase}"`);
        }
      }

      expect(
        violations,
        `${filePath.replace(REPO_ROOT + '/', '')} must not contain passive auto-start claims:\n` +
          violations.join('\n'),
      ).toHaveLength(0);
    });
  }
});
