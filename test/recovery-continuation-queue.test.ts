import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { enqueuePrd, getCompiledResumeFrontmatter, loadQueue, validatePrdFrontmatter, type EnqueuePrdOptions } from '@eforge-build/engine/prd-queue';
import { useTempDir } from './test-tmpdir.js';

function initRepo(dir: string): void {
  const opts = { cwd: dir };
  execFileSync('git', ['init', '-b', 'main'], opts);
  execFileSync('git', ['config', 'user.email', 'test@example.com'], opts);
  execFileSync('git', ['config', 'user.name', 'Test'], opts);
  execFileSync('git', ['commit', '--allow-empty', '-m', 'initial'], opts);
}

describe('recovery continuation queue frontmatter removal', () => {
  const makeTempDir = useTempDir('eforge-recovery-continuation-frontmatter-');

  it('does not preserve removed public recovery continuation fields in queued PRD frontmatter', async () => {
    const dir = makeTempDir();
    initRepo(dir);

    const enqueued = await enqueuePrd({
      cwd: dir,
      queueDir: '.eforge/queue',
      title: 'Continuation Successor',
      body: '# Continuation Successor\n\nContinue work.',
      recovery_from: 'failed-prd',
      recovery_set_name: 'failed-set',
      recovery_feature_branch: 'eforge/failed-set',
      recovery_base_branch: 'main',
    } as EnqueuePrdOptions & Record<string, string>);

    const content = await readFile(enqueued.filePath, 'utf-8');
    expect(content).not.toContain('recovery_from:');
    expect(content).not.toContain('recovery_set_name:');
    expect(content).not.toContain('recovery_feature_branch:');
    expect(content).not.toContain('recovery_base_branch:');

    const [loaded] = await loadQueue('.eforge/queue', dir);
    expect(loaded?.frontmatter).not.toHaveProperty('recovery_from');
    expect(loaded?.frontmatter).not.toHaveProperty('recovery_set_name');
  });

  it('retains private compiled-resume queue frontmatter extraction', () => {
    const result = validatePrdFrontmatter({
      title: 'Compiled Resume',
      resume_mode: 'compiled',
      resume_from: 'failed-prd',
      resume_set_name: 'failed-set',
      resume_feature_branch: 'eforge/failed-set',
      resume_base_branch: 'main',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(getCompiledResumeFrontmatter(result.data)).toEqual({
        mode: 'compiled',
        sourcePrdId: 'failed-prd',
        setName: 'failed-set',
        featureBranch: 'eforge/failed-set',
        baseBranch: 'main',
      });
    }
  });

  it('strips legacy recovery continuation fields during validation', () => {
    const result = validatePrdFrontmatter({
      title: 'Legacy Continuation',
      recovery_from: 'failed-prd',
      recovery_set_name: 'failed-set',
      recovery_feature_branch: 'eforge/failed-set',
      recovery_base_branch: 'main',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ title: 'Legacy Continuation' });
    }
  });
});
