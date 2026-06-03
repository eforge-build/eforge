/**
 * Focused tests for validation recovery checkpoint artifacts.
 */

import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';
import type { ReviewIssue } from '../packages/engine/src/events.js';
import {
  resolveValidationRecoveryCheckpointPaths,
  writeValidationRecoveryCheckpoint,
} from '../packages/engine/src/validation-recovery-checkpoints.js';

const exec = promisify(execFile);
const tempDirs: string[] = [];

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd });
  return stdout;
}

async function initRepo(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), 'eforge-validation-checkpoint-repo-'));
  tempDirs.push(repo);
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'test@example.com']);
  await git(repo, ['config', 'user.name', 'Test User']);
  await writeFile(join(repo, 'src.txt'), 'before\n', 'utf8');
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'initial']);
  return repo;
}

function issue(overrides: Partial<ReviewIssue> = {}): ReviewIssue {
  return {
    severity: 'critical',
    category: 'validation-provider',
    file: 'src.txt',
    description: 'Validation provider reported a structural issue.',
    fix: 'Adjust src.txt according to the provider guidance.',
    retryGuidance: 'Retry narrowly in src.txt.',
    validationProviderName: 'lint/provider',
    failureKind: 'guardrail',
    repairClass: 'structural',
    metadata: { rule: 'demo' },
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('validation recovery checkpoints', () => {
  it('places artifacts under ctx.cwd when ctx.cwd is outside the plan worktree', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'eforge-validation-checkpoint-project-'));
    const worktree = await mkdtemp(join(tmpdir(), 'eforge-validation-checkpoint-worktree-'));
    tempDirs.push(projectRoot, worktree);

    const paths = resolveValidationRecoveryCheckpointPaths({
      cwd: projectRoot,
      worktreePath: worktree,
      planSetName: 'Set Name',
      planId: 'plan/02',
      attempt: 2,
      providerName: 'lint/provider',
    });

    expect(paths.usedProjectRoot).toBe(true);
    expect(paths.directory).toBe(join(projectRoot, '.eforge', 'validation-recovery', 'Set-Name', 'plan-02', 'attempt-2-lint-provider'));
    expect(paths.metadataPath).toBe(join(paths.directory, 'metadata.json'));
    expect(paths.patchPath).toBe(join(paths.directory, 'checkpoint.patch'));
  });

  it('writes a checkpoint patch and metadata file before repair', async () => {
    const repo = await initRepo();
    const projectRoot = await mkdtemp(join(tmpdir(), 'eforge-validation-checkpoint-root-'));
    tempDirs.push(projectRoot);
    await writeFile(join(repo, 'src.txt'), 'after\n', 'utf8');

    const checkpoint = await writeValidationRecoveryCheckpoint({
      cwd: projectRoot,
      worktreePath: repo,
      planSetName: 'demo-set',
      planId: 'plan-02',
      attempt: 1,
      providerName: 'lint/provider',
      repairStrategy: 'structural',
      repairClass: 'structural',
      issues: [issue()],
      signatures: ['signature-one'],
      failureSummary: 'lint failed',
    });

    const patch = await readFile(checkpoint.patchPath, 'utf8');
    const metadata = JSON.parse(await readFile(checkpoint.metadataPath, 'utf8')) as Record<string, unknown>;

    expect(patch).toContain('-before');
    expect(patch).toContain('+after');
    expect(metadata).toMatchObject({
      planId: 'plan-02',
      providerName: 'lint/provider',
      attempt: 1,
      repairStrategy: 'structural',
      repairClass: 'structural',
      failureSummary: 'lint failed',
    });
    expect((metadata.checkpoint as Record<string, unknown>).directory).toBe(checkpoint.directory);
    expect((metadata.issues as unknown[])[0]).toMatchObject({
      file: 'src.txt',
      fix: 'Adjust src.txt according to the provider guidance.',
      retryGuidance: 'Retry narrowly in src.txt.',
    });
  });

  it('bounds checkpoint metadata output for large provider metadata', async () => {
    const repo = await initRepo();
    await mkdir(join(repo, 'nested'), { recursive: true });
    await writeFile(join(repo, 'nested', 'new.txt'), 'content\n', 'utf8');

    const huge = 'x'.repeat(25_000);
    const checkpoint = await writeValidationRecoveryCheckpoint({
      cwd: repo,
      worktreePath: repo,
      planSetName: 'demo-set',
      planId: 'plan-02',
      attempt: 1,
      providerName: 'huge-provider',
      repairStrategy: 'narrow',
      repairClass: 'narrow',
      issues: [issue({ description: huge, metadata: { huge, nested: { huge } } })],
      signatures: [huge],
      failureSummary: huge,
    });

    const metadataText = await readFile(checkpoint.metadataPath, 'utf8');
    expect(metadataText.length).toBeLessThan(20_000);
    expect(metadataText).toContain('[truncated');
    expect(metadataText).not.toContain(huge);
  });
});
