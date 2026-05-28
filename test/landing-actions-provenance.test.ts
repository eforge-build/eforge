/**
 * Tests that direct PR body includes Eforge provenance section
 * when build artifact commits exist in the repo history.
 *
 * Extracted to a separate file to keep landing-actions.test.ts within its
 * legacy size ceiling. File name intentionally contains "landing-actions" so
 * the verification command `pnpm test -- landing-actions` picks it up.
 */

// --- eforge:region plan-01-build-artifact-provenance ---

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useTempDir } from './test-tmpdir.js';

import { executeLandingAction } from '@eforge-build/engine/landing';
import { WorktreeManager } from '@eforge-build/engine/worktree-manager';
import { createMergeWorktree } from '@eforge-build/engine/worktree-ops';
import { ModelTracker } from '@eforge-build/engine/model-tracker';
import type { EforgeEvent, EforgeState, OrchestrationConfig } from '@eforge-build/engine/events';
import type { EforgeConfig } from '@eforge-build/engine/config';

// ---------------------------------------------------------------------------
// Minimal helpers (local copies of landing-actions.test.ts infrastructure)
// ---------------------------------------------------------------------------

function initGitRepo(repoRoot: string): void {
  execFileSync('git', ['init', repoRoot]);
  execFileSync('git', ['-C', repoRoot, 'config', 'user.email', 'test@test.com']);
  execFileSync('git', ['-C', repoRoot, 'config', 'user.name', 'Test']);
  writeFileSync(join(repoRoot, 'README.md'), '# test\n');
  execFileSync('git', ['-C', repoRoot, 'add', '.']);
  execFileSync('git', ['-C', repoRoot, 'commit', '-m', 'initial commit']);
  execFileSync('git', ['-C', repoRoot, 'branch', '-M', 'main']);
}

/** Create a fake `gh` binary that captures the PR body to a log file. */
function createFakeGhBodyCapture(dir: string): { binDir: string; bodyLog: string } {
  const binDir = join(dir, 'gh-bin');
  const bodyLog = join(dir, 'gh-body.log');
  mkdirSync(binDir, { recursive: true });
  const script = join(binDir, 'gh');
  writeFileSync(
    script,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
const fs = require('fs');
if (args[0] === '--version') { process.stdout.write('gh version test\\n'); process.exit(0); }
const bi = args.indexOf('--body-file');
if (bi !== -1 && args[bi + 1]) { try { fs.appendFileSync(${JSON.stringify(bodyLog)}, fs.readFileSync(args[bi + 1], 'utf8')); } catch {} }
if (args[0] === 'pr' && args[1] === 'create') { process.stdout.write('https://github.com/test/repo/pull/1\\n'); }
process.exit(0);
`,
    { mode: 0o755 },
  );
  return { binDir, bodyLog };
}

function makeMinimalConfig(): OrchestrationConfig {
  return { name: 'test-set', description: 'Test set', created: '2026-01-01T00:00:00Z', mode: 'excursion', baseBranch: 'main', pipeline: { scope: 'excursion', compile: ['planner'], defaultBuild: ['builder'], defaultReview: { strategy: 'auto', perspectives: ['code'], maxRounds: 1, evaluatorStrictness: 'standard' }, rationale: 'test' }, plans: [{ id: 'plan-01', name: 'Plan 01', dependsOn: [], branch: 'feature/plan-01', build: ['builder'], review: { strategy: 'auto', perspectives: ['code'], maxRounds: 1, evaluatorStrictness: 'standard' } }] };
}

function makeMinimalState(featureBranch: string): EforgeState {
  return { setName: 'test-set', status: 'running', startedAt: new Date().toISOString(), baseBranch: 'main', featureBranch, worktreeBase: '/tmp/worktrees', plans: { 'plan-01': { status: 'merged', branch: 'feature/plan-01', dependsOn: [], merged: true } }, completedPlans: ['plan-01'] } as unknown as EforgeState;
}

function makeEngineConfig(): Pick<EforgeConfig, 'build'> {
  return { build: { worktreeDir: undefined, postMergeCommands: undefined, postMergeCommandTimeoutMs: undefined, maxValidationRetries: 2, cleanupPlanFiles: false, trunkBranch: 'main', allowLocalMergeToTrunk: false } };
}

async function drainLanding(gen: AsyncGenerator<EforgeEvent>): Promise<void> {
  for await (const _event of gen) { /* drain */ }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('executeLandingAction — Eforge provenance', () => {
  const makeTempDir = useTempDir('eforge-landing-provenance-');

  it('direct PR body includes ## Eforge provenance with commit-pinned git show refs when plan artifacts exist', async () => {
    const dir = makeTempDir();
    const repoRoot = join(dir, 'repo');
    initGitRepo(repoRoot);

    // Set up remote and push main
    const remotePath = join(dir, 'remote.git');
    execFileSync('git', ['init', '--bare', remotePath]);
    execFileSync('git', ['-C', repoRoot, 'remote', 'add', 'origin', remotePath]);
    execFileSync('git', ['-C', repoRoot, 'push', 'origin', 'main']);

    // Create feature branch and merge worktree
    const featureBranch = 'eforge/test-set';
    const worktreeBase = join(dir, 'worktrees');
    execFileSync('git', ['-C', repoRoot, 'checkout', '-b', featureBranch]);
    writeFileSync(join(repoRoot, 'feature.ts'), 'export const x = 1;\n');
    execFileSync('git', ['-C', repoRoot, 'add', '.']);
    execFileSync('git', ['-C', repoRoot, 'commit', '-m', 'feat: feature']);
    execFileSync('git', ['-C', repoRoot, 'checkout', 'main']);
    const mergeWorktreePath = await createMergeWorktree(repoRoot, worktreeBase, featureBranch, 'main');

    // Commit plan artifacts in the merge worktree (gives them a history entry)
    const planSetName = 'test-set';
    const outputDir = 'eforge/plans';
    const planDir = join(mergeWorktreePath, outputDir, planSetName);
    mkdirSync(planDir, { recursive: true });
    writeFileSync(join(planDir, 'orchestration.yaml'), `name: ${planSetName}\n`);
    writeFileSync(join(planDir, 'plan-01.md'), `# Plan 01\n`);

    // Commit a PRD artifact so the provenance section includes a Normalized PRD row
    const prdFilePath = 'eforge/prds/test-set.md';
    const prdDir = join(mergeWorktreePath, 'eforge', 'prds');
    mkdirSync(prdDir, { recursive: true });
    writeFileSync(join(prdDir, 'test-set.md'), `# Test Set PRD\n`);

    execFileSync('git', ['add', '.'], { cwd: mergeWorktreePath });
    execFileSync('git', ['commit', '-m', 'add plan artifacts'], { cwd: mergeWorktreePath });

    // Intercept gh to capture PR body
    const { binDir, bodyLog } = createFakeGhBodyCapture(dir);
    const origPath = process.env.PATH;
    process.env.PATH = `${binDir}:${origPath}`;

    try {
      const wm = new WorktreeManager({ repoRoot, worktreeBase, featureBranch, mergeWorktreePath });
      await drainLanding(executeLandingAction({
        action: 'pr', featureBranch, baseBranch: 'main', repoRoot, mergeWorktreePath,
        worktreeManager: wm, modelTracker: new ModelTracker(), commitMessage: '',
        state: makeMinimalState(featureBranch), config: makeMinimalConfig(),
        engineConfig: makeEngineConfig(), cleanupPlanSet: planSetName, cleanupOutputDir: outputDir,
        cleanupPrdFilePath: prdFilePath,
      }));

      const body = readFileSync(bodyLog, 'utf-8');
      expect(body).toContain('## Eforge provenance');
      // All three artifact kinds must appear as labelled rows
      expect(body).toContain('Normalized PRD');
      expect(body).toContain('Orchestration');
      expect(body).toContain('Plan');
      // Each row must include a commit-pinned git show reference
      expect(body).toContain(`git show `);
      const gitShowMatches = body.match(/git show ([0-9a-f]{40}):/g) ?? [];
      expect(gitShowMatches.length).toBeGreaterThanOrEqual(3);
      // Paths must be repository-relative (no leading ./)
      expect(body).toContain(`git show `);
      expect(body).toMatch(/git show [0-9a-f]{40}:eforge\/prds\/test-set\.md/);
      expect(body).toMatch(/git show [0-9a-f]{40}:eforge\/plans\/test-set\/orchestration\.yaml/);
      expect(body).toMatch(/git show [0-9a-f]{40}:eforge\/plans\/test-set\/plan-01\.md/);
      // Must never use branch-relative blob URLs
      expect(body).not.toMatch(/\/blob\/main\//);
      expect(body).not.toMatch(/\/blob\/master\//);
      expect(body).not.toMatch(/\/blob\/eforge\//);
      expect(body).not.toContain('Co-Authored-By:');
      expect(body).not.toContain('Models-Used:');
    } finally {
      process.env.PATH = origPath;
    }
  });
});

// --- eforge:endregion plan-01-build-artifact-provenance ---
