/**
 * Tests for landing frontmatter round-trip in PRD queue.
 *
 * Verifies:
 *   1. enqueuePrd with landing writes the field to frontmatter.
 *   2. parseFrontmatter / loadQueue reads it back correctly.
 *   3. The Zod schema rejects an invalid landing string.
 *   4. The Zod schema accepts all three canonical values.
 *   5. The Zod schema rejects old wire values (migration: use pr|merge|leave).
 */

import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { enqueuePrd, loadQueue, validatePrdFrontmatter } from '@eforge-build/engine/prd-queue';

const exec = promisify(execFile);

async function createGitRepo(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-fm-landing-'));
  await exec('git', ['init'], { cwd });
  await exec('git', ['config', 'user.email', 'test@test.com'], { cwd });
  await exec('git', ['config', 'user.name', 'Test'], { cwd });
  return cwd;
}

describe('prdFrontmatterSchema — landing validation', () => {
  it('accepts merge', () => {
    const result = validatePrdFrontmatter({ title: 'T', landing: 'merge' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.landing).toBe('merge');
  });

  it('accepts pr', () => {
    const result = validatePrdFrontmatter({ title: 'T', landing: 'pr' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.landing).toBe('pr');
  });

  it('accepts leave', () => {
    const result = validatePrdFrontmatter({ title: 'T', landing: 'leave' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.landing).toBe('leave');
  });

  it('rejects an unknown landing string', () => {
    const result = validatePrdFrontmatter({ title: 'T', landing: 'deploy-to-prod' });
    expect(result.success).toBe(false);
  });

  it('accepts absent landing (optional)', () => {
    const result = validatePrdFrontmatter({ title: 'T' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.landing).toBeUndefined();
  });

  it('rejects old wire value merge-to-base-branch (migration: use merge)', () => {
    const result = validatePrdFrontmatter({ title: 'T', landing: 'merge-to-base-branch' });
    expect(result.success).toBe(false);
  });

  it('rejects old wire value issue-pr (migration: use pr)', () => {
    const result = validatePrdFrontmatter({ title: 'T', landing: 'issue-pr' });
    expect(result.success).toBe(false);
  });

  it('rejects old wire value leave-branch (migration: use leave)', () => {
    const result = validatePrdFrontmatter({ title: 'T', landing: 'leave-branch' });
    expect(result.success).toBe(false);
  });
});

describe('enqueuePrd — landing frontmatter write', () => {
  it('writes landing field when provided', async () => {
    const cwd = await createGitRepo();
    const queueDir = 'eforge/queue';
    await mkdir(join(cwd, 'eforge', 'queue'), { recursive: true });

    const result = await enqueuePrd({
      body: '# My Feature\n\nDo this thing.',
      title: 'My Feature',
      queueDir,
      cwd,
      landingAction: 'leave',
    });

    const content = await readFile(result.filePath, 'utf-8');
    expect(content).toContain('landing: leave');
  });

  it('does not write landing field when absent', async () => {
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
    expect(content).not.toContain('landing');
  });

  it('roundtrips landing through loadQueue', async () => {
    const cwd = await createGitRepo();
    const queueDir = 'eforge/queue';
    await mkdir(join(cwd, 'eforge', 'queue'), { recursive: true });

    await enqueuePrd({
      body: '# PR Feature\n\nOpen a PR.',
      title: 'PR Feature',
      queueDir,
      cwd,
      landingAction: 'pr',
    });

    const prds = await loadQueue(queueDir, cwd);
    expect(prds).toHaveLength(1);
    expect(prds[0].frontmatter.landing).toBe('pr');
  });

  it('roundtrips merge through loadQueue', async () => {
    const cwd = await createGitRepo();
    const queueDir = 'eforge/queue';
    await mkdir(join(cwd, 'eforge', 'queue'), { recursive: true });

    await enqueuePrd({
      body: '# Merge Feature\n\nMerge it.',
      title: 'Merge Feature',
      queueDir,
      cwd,
      landingAction: 'merge',
    });

    const prds = await loadQueue(queueDir, cwd);
    expect(prds).toHaveLength(1);
    expect(prds[0].frontmatter.landing).toBe('merge');
  });

  it('rejects legacy onSuccess frontmatter instead of silently ignoring it', async () => {
    const cwd = await createGitRepo();
    const queueDir = 'eforge/queue';
    await mkdir(join(cwd, 'eforge', 'queue'), { recursive: true });
    await writeFile(
      join(cwd, queueDir, 'legacy.md'),
      '---\ntitle: Legacy\nonSuccess: issue-pr\n---\n\n# Legacy\n',
      'utf-8',
    );

    await expect(loadQueue(queueDir, cwd)).rejects.toThrow(/onSuccess.*landing/s);
  });
});
