/**
 * Tests for scripts/check-agent-maintainability.mjs.
 *
 * Verifies that:
 *  1. The script exits 0 against the actual repository (ratchet passes).
 *  2. The script exits non-zero when given a synthetic fixture directory
 *     containing an oversized implementation file.
 *  3. The script exits non-zero when given a directory with an unbalanced
 *     region marker.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const SCRIPT_PATH = join(REPO_ROOT, 'scripts', 'check-agent-maintainability.mjs');

function runScript(cwd?: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync('node', [SCRIPT_PATH], {
    encoding: 'utf-8',
    cwd: cwd ?? REPO_ROOT,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/**
 * Generate a TypeScript file content with exactly `lineCount` lines.
 * Each line is a valid JS comment so it won't break any parser.
 */
function makeOversizedContent(lineCount: number): string {
  const lines: string[] = ['// synthetic oversized implementation file'];
  while (lines.length < lineCount) {
    lines.push(`// line ${lines.length + 1}`);
  }
  return lines.join('\n') + '\n';
}

const tmpDirs: string[] = [];

function makeTmpFixtureDir(name: string): string {
  const dir = join(tmpdir(), `eforge-maintainability-test-${name}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
});

describe('check-agent-maintainability.mjs', () => {
  it('exits 0 against the real repository', () => {
    const result = runScript(REPO_ROOT);
    if (result.status !== 0) {
      throw new Error(
        `Script exited ${result.status} on the real repository.\nstderr: ${result.stderr}\nstdout: ${result.stdout}`
      );
    }
    expect(result.status).toBe(0);
  });

  it('exits non-zero for a directory with an oversized implementation file not in the baseline', () => {
    const fixtureDir = makeTmpFixtureDir('oversized-impl');

    // Create a minimal fake baseline with no entries so no exceptions apply.
    const baselineContent = JSON.stringify({ files: [] }, null, 2);
    const scriptsDir = join(fixtureDir, 'scripts');
    mkdirSync(scriptsDir, { recursive: true });
    writeFileSync(join(scriptsDir, 'agent-maintainability-baseline.json'), baselineContent, 'utf-8');

    // Create a packages subdirectory with an oversized implementation file.
    const pkgDir = join(fixtureDir, 'packages', 'synthetic', 'src');
    mkdirSync(pkgDir, { recursive: true });

    // 700 lines — well above the 600-line implementation cap.
    const oversizedContent = makeOversizedContent(700);
    writeFileSync(join(pkgDir, 'big-impl.ts'), oversizedContent, 'utf-8');

    const result = runScript(fixtureDir);
    expect(result.status).not.toBe(0);
    // The violation message should reference the file path.
    const output = result.stdout + result.stderr;
    expect(output).toMatch(/big-impl\.ts/);
    expect(output).toMatch(/700/);
  });

  it('exits non-zero for a directory with an unbalanced region marker', () => {
    const fixtureDir = makeTmpFixtureDir('unbalanced-marker');

    const baselineContent = JSON.stringify({ files: [] }, null, 2);
    const scriptsDir = join(fixtureDir, 'scripts');
    mkdirSync(scriptsDir, { recursive: true });
    writeFileSync(join(scriptsDir, 'agent-maintainability-baseline.json'), baselineContent, 'utf-8');

    // A small file (within cap) but with an unclosed region marker.
    const pkgDir = join(fixtureDir, 'packages', 'synthetic', 'src');
    mkdirSync(pkgDir, { recursive: true });

    const unbalancedContent = [
      '// synthetic file with unbalanced region marker',
      '// --- eforge:region my-plan ---',
      'export function hello() { return 42; }',
      '// missing endregion intentionally',
    ].join('\n') + '\n';

    writeFileSync(join(pkgDir, 'unbalanced.ts'), unbalancedContent, 'utf-8');

    const result = runScript(fixtureDir);
    expect(result.status).not.toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toMatch(/my-plan/);
  });

  it('exits 0 for a directory with a small balanced implementation file', () => {
    const fixtureDir = makeTmpFixtureDir('small-balanced');

    const baselineContent = JSON.stringify({ files: [] }, null, 2);
    const scriptsDir = join(fixtureDir, 'scripts');
    mkdirSync(scriptsDir, { recursive: true });
    writeFileSync(join(scriptsDir, 'agent-maintainability-baseline.json'), baselineContent, 'utf-8');

    const pkgDir = join(fixtureDir, 'packages', 'synthetic', 'src');
    mkdirSync(pkgDir, { recursive: true });

    // A compliant file: 50 lines, balanced markers.
    const content = [
      '// synthetic small file',
      '// --- eforge:region plan-x ---',
      'export function hello() { return 42; }',
      '// --- eforge:endregion plan-x ---',
    ].join('\n') + '\n';

    writeFileSync(join(pkgDir, 'small.ts'), content, 'utf-8');

    const result = runScript(fixtureDir);
    expect(result.status).toBe(0);
  });

  it('exits non-zero for an oversized .mjs script file not in the baseline', () => {
    const fixtureDir = makeTmpFixtureDir('oversized-mjs');

    const baselineContent = JSON.stringify({ files: [] }, null, 2);
    const scriptsDir = join(fixtureDir, 'scripts');
    mkdirSync(scriptsDir, { recursive: true });
    writeFileSync(join(scriptsDir, 'agent-maintainability-baseline.json'), baselineContent, 'utf-8');

    // 700 lines — above the 600-line implementation cap.
    const oversizedContent = makeOversizedContent(700);
    writeFileSync(join(scriptsDir, 'big-script.mjs'), oversizedContent, 'utf-8');

    const result = runScript(fixtureDir);
    expect(result.status).not.toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toMatch(/big-script\.mjs/);
    expect(output).toMatch(/700/);
  });

  it('classifies a non-test-named file under test/ as a test file (1200-line cap)', () => {
    const fixtureDir = makeTmpFixtureDir('test-support-file');

    const baselineContent = JSON.stringify({ files: [] }, null, 2);
    const scriptsDir = join(fixtureDir, 'scripts');
    mkdirSync(scriptsDir, { recursive: true });
    writeFileSync(join(scriptsDir, 'agent-maintainability-baseline.json'), baselineContent, 'utf-8');

    // A support file under test/ that is NOT named *.test.ts — should get the
    // 1200-line test cap, not the 600-line implementation cap.
    const testDir = join(fixtureDir, 'test');
    mkdirSync(testDir, { recursive: true });

    // 700 lines: above impl cap (600) but below test cap (1200) — must pass.
    const content = makeOversizedContent(700);
    writeFileSync(join(testDir, 'stub-harness.ts'), content, 'utf-8');

    const result = runScript(fixtureDir);
    expect(result.status).toBe(0);
  });

  it('exits non-zero for an oversized root-level implementation file not in the baseline', () => {
    const fixtureDir = makeTmpFixtureDir('oversized-root-level');

    const baselineContent = JSON.stringify({ files: [] }, null, 2);
    const scriptsDir = join(fixtureDir, 'scripts');
    mkdirSync(scriptsDir, { recursive: true });
    writeFileSync(join(scriptsDir, 'agent-maintainability-baseline.json'), baselineContent, 'utf-8');

    // Place an oversized .ts file directly at the repo root — not in any subdirectory.
    // 700 lines — above the 600-line implementation cap.
    const oversizedContent = makeOversizedContent(700);
    writeFileSync(join(fixtureDir, 'root-level-impl.ts'), oversizedContent, 'utf-8');

    const result = runScript(fixtureDir);
    expect(result.status).not.toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toMatch(/root-level-impl\.ts/);
    expect(output).toMatch(/700/);
  });

  it('exits non-zero for crossed (improperly interleaved) region markers', () => {
    const fixtureDir = makeTmpFixtureDir('crossed-markers');

    const baselineContent = JSON.stringify({ files: [] }, null, 2);
    const scriptsDir = join(fixtureDir, 'scripts');
    mkdirSync(scriptsDir, { recursive: true });
    writeFileSync(join(scriptsDir, 'agent-maintainability-baseline.json'), baselineContent, 'utf-8');

    const pkgDir = join(fixtureDir, 'packages', 'synthetic', 'src');
    mkdirSync(pkgDir, { recursive: true });

    // Crossed markers: region a opens, region b opens, endregion a closes (wrong).
    const crossedContent = [
      '// synthetic file with crossed region markers',
      '// --- eforge:region plan-a ---',
      'export function foo() {}',
      '// --- eforge:region plan-b ---',
      'export function bar() {}',
      '// --- eforge:endregion plan-a ---',
      '// --- eforge:endregion plan-b ---',
    ].join('\n') + '\n';

    writeFileSync(join(pkgDir, 'crossed.ts'), crossedContent, 'utf-8');

    const result = runScript(fixtureDir);
    expect(result.status).not.toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toMatch(/crossed/i);
  });
});
