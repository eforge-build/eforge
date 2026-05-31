/**
 * Integration tests for materializePrdArtifact:
 *   (a) Artifact is created and committed in a temp merge worktree.
 *   (b) Commit message reads `build({prdId}): record PRD provenance` with Co-Authored-By trailer.
 *   (c) `cleanupPlanFiles` with the artifact path removes the artifact and commits the removal.
 *   (d) The artifact appears in `git log` history but not in HEAD after cleanup.
 */

import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { materializePrdArtifact } from '@eforge-build/engine/prd-queue';
import { cleanupPlanFiles } from '@eforge-build/engine/cleanup';
import { collectBuildArtifactProvenance } from '@eforge-build/engine/provenance';
import { useTempDir } from './test-tmpdir.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupGitRepo(dir: string): void {
  execFileSync('git', ['init'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  execFileSync('git', ['commit', '--allow-empty', '-m', 'initial'], { cwd: dir });
}

function commitPlanDir(dir: string, planSet: string, outputDir = 'eforge/plans'): void {
  const planDir = join(dir, outputDir, planSet);
  mkdirSync(planDir, { recursive: true });
  writeFileSync(join(planDir, 'plan-01.md'), '# Plan 01\n');
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-m', `add plan files for ${planSet}`], { cwd: dir });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('materializePrdArtifact', () => {
  const makeTempDir = useTempDir('eforge-prd-artifact-');

  it('(a) creates and commits eforge/prds/{prdId}.md in the merge worktree', async () => {
    const dir = makeTempDir();
    setupGitRepo(dir);

    const prdContent = '---\ntitle: Test PRD\n---\n\n# Test PRD\n\nSome content.';
    const { artifactRelPath } = await materializePrdArtifact({
      mergeWorktreePath: dir,
      prdId: 'my-prd',
      prdContent,
    });

    expect(artifactRelPath).toBe('eforge/prds/my-prd.md');
    expect(existsSync(join(dir, 'eforge', 'prds', 'my-prd.md'))).toBe(true);

    // Artifact content matches prdContent exactly (no transformation)
    const { readFileSync } = await import('node:fs');
    const writtenContent = readFileSync(join(dir, 'eforge', 'prds', 'my-prd.md'), 'utf-8');
    expect(writtenContent).toBe(prdContent);

    // Artifact is committed in the merge worktree
    const gitLog = execFileSync('git', ['log', '--oneline'], { cwd: dir }).toString();
    expect(gitLog).toContain('build(my-prd): record PRD provenance');

    // The artifact file is in the HEAD tree (not just on disk uncommitted)
    const showOutput = execFileSync('git', ['show', `HEAD:${artifactRelPath}`], { cwd: dir }).toString();
    expect(showOutput).toBe(prdContent);
  });

  it('(b) commit message reads "build({prdId}): record PRD provenance" with Co-Authored-By trailer', async () => {
    const dir = makeTempDir();
    setupGitRepo(dir);

    await materializePrdArtifact({
      mergeWorktreePath: dir,
      prdId: 'test-build',
      prdContent: '# Content',
    });

    const commitMessage = execFileSync('git', ['log', '-1', '--format=%B'], { cwd: dir }).toString();
    expect(commitMessage).toContain('build(test-build): record PRD provenance');
    expect(commitMessage).toContain('Co-Authored-By: forged-by-eforge <noreply@eforge.build>');
  });

  it('(c) cleanupPlanFiles with artifact path removes the artifact and commits removal', async () => {
    const dir = makeTempDir();
    setupGitRepo(dir);
    commitPlanDir(dir, 'my-plan-set');

    const prdContent = '# My PRD\n\nContent here.';
    const { artifactRelPath } = await materializePrdArtifact({
      mergeWorktreePath: dir,
      prdId: 'my-plan-set',
      prdContent,
    });

    expect(existsSync(join(dir, artifactRelPath))).toBe(true);

    // Run cleanup — drains all events
    const events: unknown[] = [];
    for await (const event of cleanupPlanFiles(dir, 'my-plan-set', 'eforge/plans', artifactRelPath)) {
      events.push(event);
    }

    // Artifact is removed from the working tree
    expect(existsSync(join(dir, artifactRelPath))).toBe(false);

    // Cleanup commit message reflects the provenance artifact
    const commitSubject = execFileSync('git', ['log', '-1', '--format=%s'], { cwd: dir }).toString().trim();
    expect(commitSubject).toBe('cleanup(my-plan-set): remove plan files and PRD provenance artifact');
  });

  it('(d) artifact appears in git log history but not in HEAD after cleanup', async () => {
    const dir = makeTempDir();
    setupGitRepo(dir);
    commitPlanDir(dir, 'my-plan-set');

    const prdContent = '# My PRD';
    const { artifactRelPath } = await materializePrdArtifact({
      mergeWorktreePath: dir,
      prdId: 'my-plan-set',
      prdContent,
    });

    // Run cleanup
    for await (const _ of cleanupPlanFiles(dir, 'my-plan-set', 'eforge/plans', artifactRelPath)) {
      // consume events
    }

    // Artifact is not present in HEAD working tree
    expect(existsSync(join(dir, artifactRelPath))).toBe(false);

    // But the materialization commit and cleanup commit both appear in git log
    const fullLog = execFileSync('git', ['log', '--oneline'], { cwd: dir }).toString();
    expect(fullLog).toContain('build(my-plan-set): record PRD provenance');
    expect(fullLog).toContain('cleanup(my-plan-set): remove plan files and PRD provenance artifact');
  });

  it('(e) collected provenance SHA is usable with git show after cleanup removes the artifact from HEAD', async () => {
    const dir = makeTempDir();
    setupGitRepo(dir);
    commitPlanDir(dir, 'my-plan-set');

    const prdContent = '# My PRD\nFull content for recovery test.';
    const { artifactRelPath } = await materializePrdArtifact({
      mergeWorktreePath: dir,
      prdId: 'my-plan-set',
      prdContent,
    });

    // Run cleanup — artifact removed from HEAD, preserved in history
    for await (const _ of cleanupPlanFiles(dir, 'my-plan-set', 'eforge/plans', artifactRelPath)) {
      // consume events
    }

    // Artifact is gone from working tree
    expect(existsSync(join(dir, artifactRelPath))).toBe(false);

    // collectBuildArtifactProvenance uses --diff-filter=AM, so it finds the add
    // commit, not the cleanup/deletion commit.
    const refs = await collectBuildArtifactProvenance(dir, {
      planSetName: 'my-plan-set',
      outputDir: 'eforge/plans',
      prdArtifactPath: artifactRelPath,
    });

    // The PRD artifact ref must be present with a valid 40-char SHA
    const prdRef = refs.find((r) => r.kind === 'prd');
    expect(prdRef).toBeDefined();
    expect(prdRef!.commitSha).toHaveLength(40);

    // git show <sha>:<path> must recover the original content even after cleanup
    const recovered = execFileSync(
      'git',
      ['show', `${prdRef!.commitSha}:${prdRef!.path}`],
      { cwd: dir },
    ).toString();
    expect(recovered).toBe(prdContent);

    // Sanity: the gitShowRef string matches the format `git show <sha>:<path>`
    expect(prdRef!.gitShowRef).toBe(`git show ${prdRef!.commitSha}:${prdRef!.path}`);
  });
});
