/**
 * Tests for onSuccess frontmatter round-trip in PRD queue.
 *
 * Verifies:
 *   1. enqueuePrd with onSuccess writes the field to frontmatter.
 *   2. parseFrontmatter / loadQueue reads it back correctly.
 *   3. The Zod schema rejects an invalid onSuccess string.
 *   4. The Zod schema accepts all three valid values.
 */

import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { enqueuePrd, loadQueue, validatePrdFrontmatter } from '@eforge-build/engine/prd-queue';

const exec = promisify(execFile);

async function createGitRepo(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-fm-onsuccess-'));
  await exec('git', ['init'], { cwd });
  await exec('git', ['config', 'user.email', 'test@test.com'], { cwd });
  await exec('git', ['config', 'user.name', 'Test'], { cwd });
  return cwd;
}

describe('prdFrontmatterSchema — onSuccess validation', () => {
  it('accepts merge-to-base-branch', () => {
    const result = validatePrdFrontmatter({ title: 'T', onSuccess: 'merge-to-base-branch' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.onSuccess).toBe('merge-to-base-branch');
  });

  it('accepts issue-pr', () => {
    const result = validatePrdFrontmatter({ title: 'T', onSuccess: 'issue-pr' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.onSuccess).toBe('issue-pr');
  });

  it('accepts leave-branch', () => {
    const result = validatePrdFrontmatter({ title: 'T', onSuccess: 'leave-branch' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.onSuccess).toBe('leave-branch');
  });

  it('rejects an unknown onSuccess string', () => {
    const result = validatePrdFrontmatter({ title: 'T', onSuccess: 'deploy-to-prod' });
    expect(result.success).toBe(false);
  });

  it('accepts absent onSuccess (optional)', () => {
    const result = validatePrdFrontmatter({ title: 'T' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.onSuccess).toBeUndefined();
  });
});

describe('enqueuePrd — onSuccess frontmatter write', () => {
  it('writes onSuccess field when provided', async () => {
    const cwd = await createGitRepo();
    const queueDir = 'eforge/queue';
    await mkdir(join(cwd, 'eforge', 'queue'), { recursive: true });

    const result = await enqueuePrd({
      body: '# My Feature\n\nDo this thing.',
      title: 'My Feature',
      queueDir,
      cwd,
      onSuccess: 'leave-branch',
    });

    const content = await readFile(result.filePath, 'utf-8');
    expect(content).toContain('onSuccess: leave-branch');
  });

  it('does not write onSuccess field when absent', async () => {
    const cwd = await createGitRepo();
    const queueDir = 'eforge/queue';
    await mkdir(join(cwd, 'eforge', 'queue'), { recursive: true });

    const result = await enqueuePrd({
      body: '# Another Feature\n\nDo that thing.',
      title: 'Another Feature',
      queueDir,
      cwd,
    });

    const content = await readFile(result.filePath, 'utf-8');
    expect(content).not.toContain('onSuccess');
  });

  it('roundtrips onSuccess through loadQueue', async () => {
    const cwd = await createGitRepo();
    const queueDir = 'eforge/queue';
    await mkdir(join(cwd, 'eforge', 'queue'), { recursive: true });

    await enqueuePrd({
      body: '# PR Feature\n\nOpen a PR.',
      title: 'PR Feature',
      queueDir,
      cwd,
      onSuccess: 'issue-pr',
    });

    const prds = await loadQueue(queueDir, cwd);
    expect(prds).toHaveLength(1);
    expect(prds[0].frontmatter.onSuccess).toBe('issue-pr');
  });

  it('roundtrips merge-to-base-branch through loadQueue', async () => {
    const cwd = await createGitRepo();
    const queueDir = 'eforge/queue';
    await mkdir(join(cwd, 'eforge', 'queue'), { recursive: true });

    await enqueuePrd({
      body: '# Merge Feature\n\nMerge it.',
      title: 'Merge Feature',
      queueDir,
      cwd,
      onSuccess: 'merge-to-base-branch',
    });

    const prds = await loadQueue(queueDir, cwd);
    expect(prds).toHaveLength(1);
    expect(prds[0].frontmatter.onSuccess).toBe('merge-to-base-branch');
  });
});
