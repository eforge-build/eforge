import { describe, it, expect } from 'vitest';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { EforgeEngine } from '@eforge-build/engine/eforge';
import type { CompileOptions, EforgeEvent } from '@eforge-build/engine/events';
import { enqueuePrd, getRecoveryContinuationFrontmatter, loadQueue, validatePrdFrontmatter, type QueuedPrd } from '@eforge-build/engine/prd-queue';
import { computeWorktreeBase, createMergeWorktree } from '@eforge-build/engine/worktree-ops';
import { StubHarness } from './stub-harness.js';
import { useTempDir } from './test-tmpdir.js';

function initRepo(dir: string): void {
  const opts = { cwd: dir };
  execFileSync('git', ['init', '-b', 'main'], opts);
  execFileSync('git', ['config', 'user.email', 'test@example.com'], opts);
  execFileSync('git', ['config', 'user.name', 'Test'], opts);
  execFileSync('git', ['commit', '--allow-empty', '-m', 'initial'], opts);
}

function createPreservedFeatureBranch(dir: string, branch = 'eforge/failed-set'): void {
  execFileSync('git', ['checkout', '-b', branch], { cwd: dir });
  writeFileSync(join(dir, 'sentinel.txt'), 'preserved partial work\n', 'utf-8');
  execFileSync('git', ['add', 'sentinel.txt'], { cwd: dir });
  execFileSync('git', ['commit', '-m', 'preserved feature base'], { cwd: dir });
  execFileSync('git', ['checkout', 'main'], { cwd: dir });
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function queuedPrd(dir: string, frontmatter: QueuedPrd['frontmatter'], id = 'successor'): QueuedPrd {
  return {
    id,
    filePath: join(dir, '.eforge', 'queue', `${id}.md`),
    frontmatter,
    content: `---\ntitle: ${frontmatter.title}\n---\n\n# ${frontmatter.title}\n`,
    lastCommitHash: '',
    lastCommitDate: '',
  };
}

async function collect(gen: AsyncGenerator<EforgeEvent>): Promise<EforgeEvent[]> {
  const events: EforgeEvent[] = [];
  for await (const event of gen) events.push(event);
  return events;
}

function installCompileRecorder(engine: EforgeEngine, repoRoot: string, calls: Partial<CompileOptions>[]): void {
  (engine as unknown as {
    compile: (source: string, options?: Partial<CompileOptions>) => AsyncGenerator<EforgeEvent>;
  }).compile = async function* (_source: string, options: Partial<CompileOptions> = {}) {
    calls.push(options);
    if (options.name && options.worktreeBaseRefOverride) {
      const worktreePath = await createMergeWorktree(
        repoRoot,
        computeWorktreeBase(repoRoot, options.name),
        `eforge/${options.name}`,
        options.worktreeBaseRefOverride,
      );
      const planDir = resolve(worktreePath, 'eforge', 'plans', options.name);
      await mkdir(planDir, { recursive: true });
      await writeFile(
        resolve(planDir, 'orchestration.yaml'),
        `name: ${options.name}\nbase_branch: ${options.baseBranchOverride ?? 'main'}\nmode: errand\nplans: []\n`,
        'utf-8',
      );
    }
    yield { timestamp: new Date().toISOString(), type: 'planning:skip', reason: 'compile recorder stops before build' } as EforgeEvent;
    yield { timestamp: new Date().toISOString(), type: 'phase:end', runId: 'compile-recorder', result: { status: 'completed', summary: 'Compile complete' } } as EforgeEvent;
  };
}

describe('recovery continuation queue frontmatter', () => {
  const makeTempDir = useTempDir('eforge-recovery-continuation-frontmatter-');

  it('validates, enqueues, loads, and extracts complete recovery continuation fields', async () => {
    const dir = makeTempDir();
    initRepo(dir);

    const result = validatePrdFrontmatter({
      title: 'Continuation Successor',
      recovery_from: 'failed-prd',
      recovery_set_name: 'failed-set',
      recovery_feature_branch: 'eforge/failed-set',
      recovery_base_branch: 'main',
    });
    expect(result.success).toBe(true);

    const enqueued = await enqueuePrd({
      cwd: dir,
      queueDir: '.eforge/queue',
      title: 'Continuation Successor',
      body: '# Continuation Successor\n\nContinue work.',
      recovery_from: 'failed-prd',
      recovery_set_name: 'failed-set',
      recovery_feature_branch: 'eforge/failed-set',
      recovery_base_branch: 'main',
    });

    const content = await readFile(enqueued.filePath, 'utf-8');
    expect(content).toContain('recovery_from: failed-prd');
    expect(content).toContain('recovery_set_name: failed-set');
    expect(content).toContain('recovery_feature_branch: eforge/failed-set');
    expect(content).toContain('recovery_base_branch: main');

    const [loaded] = await loadQueue('.eforge/queue', dir);
    expect(getRecoveryContinuationFrontmatter(loaded.frontmatter)).toEqual({
      sourcePrdId: 'failed-prd',
      setName: 'failed-set',
      featureBranch: 'eforge/failed-set',
      baseBranch: 'main',
    });
  });

  it('rejects partial recovery continuation field sets before compile', () => {
    const result = validatePrdFrontmatter({
      title: 'Partial Continuation',
      recovery_from: 'failed-prd',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(() => getRecoveryContinuationFrontmatter(result.data)).toThrow(/Incomplete recovery continuation frontmatter/);
    }
  });
});

describe('queued recovery continuation compile selection', () => {
  const makeTempDir = useTempDir('eforge-recovery-continuation-queue-');

  it('passes preserved feature branch as worktree base and original base branch as logical base', async () => {
    const dir = makeTempDir();
    initRepo(dir);
    createPreservedFeatureBranch(dir);

    const prd = queuedPrd(dir, {
      title: 'Continuation Successor',
      recovery_from: 'failed-prd',
      recovery_set_name: 'failed-set',
      recovery_feature_branch: 'eforge/failed-set',
      recovery_base_branch: 'main',
    });
    await mkdir(resolve(dir, '.eforge', 'queue'), { recursive: true });
    await writeFile(prd.filePath, prd.content, 'utf-8');

    const engine = await EforgeEngine.create({ cwd: dir, agentRuntimes: new StubHarness([]) });
    const calls: Partial<CompileOptions>[] = [];
    installCompileRecorder(engine, dir, calls);

    await collect(engine.buildSinglePrd(prd, {}));

    expect(calls[0]?.baseBranchOverride).toBe('main');
    expect(calls[0]?.worktreeBaseRefOverride).toBe('eforge/failed-set');

    const mergeWorktree = resolve(computeWorktreeBase(dir, 'successor'), '__merge__');
    expect(await pathExists(resolve(mergeWorktree, 'sentinel.txt'))).toBe(true);
    const headSubject = execFileSync('git', ['log', '-1', '--format=%s'], { cwd: mergeWorktree }).toString().trim();
    expect(headSubject).toBe('preserved feature base');
    const orchestration = await readFile(resolve(mergeWorktree, 'eforge', 'plans', 'successor', 'orchestration.yaml'), 'utf-8');
    expect(orchestration).toContain('base_branch: main');
    expect(orchestration).not.toContain('base_branch: eforge/failed-set');
  });

  it('keeps previous base-ref behavior for non-continuation queued PRDs', async () => {
    const dir = makeTempDir();
    initRepo(dir);
    const prd = queuedPrd(dir, { title: 'Ordinary PRD' }, 'ordinary');
    await mkdir(resolve(dir, '.eforge', 'queue'), { recursive: true });
    await writeFile(prd.filePath, prd.content, 'utf-8');

    const engine = await EforgeEngine.create({ cwd: dir, agentRuntimes: new StubHarness([]) });
    const calls: Partial<CompileOptions>[] = [];
    installCompileRecorder(engine, dir, calls);

    await collect(engine.buildSinglePrd(prd, {}));

    expect(calls[0]?.baseBranchOverride).toBeUndefined();
    expect(calls[0]?.worktreeBaseRefOverride).toBeUndefined();
  });

  it('fails stacked PRDs with recovery continuation metadata before compile', async () => {
    const dir = makeTempDir();
    initRepo(dir);
    createPreservedFeatureBranch(dir);
    const prd = queuedPrd(dir, {
      title: 'Stacked Continuation',
      stack_id: 'stack-a',
      stack_provider: 'git-spice',
      recovery_from: 'failed-prd',
      recovery_set_name: 'failed-set',
      recovery_feature_branch: 'eforge/failed-set',
      recovery_base_branch: 'main',
    }, 'stacked-continuation');
    await mkdir(resolve(dir, '.eforge', 'queue'), { recursive: true });
    await writeFile(prd.filePath, prd.content, 'utf-8');

    const engine = await EforgeEngine.create({
      cwd: dir,
      agentRuntimes: new StubHarness([]),
      config: { stacking: { enabled: true } },
    });
    const calls: Partial<CompileOptions>[] = [];
    installCompileRecorder(engine, dir, calls);

    const events = await collect(engine.buildSinglePrd(prd, {}));

    expect(calls).toHaveLength(0);
    expect(events.some((event) => event.type === 'plan:error:set' && event.error === 'Recovery continuation PRD cannot also use stack metadata')).toBe(true);
    expect(events.some((event) => event.type === 'queue:prd:complete' && event.status === 'failed')).toBe(true);
  });
});
