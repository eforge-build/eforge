import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type { EforgeEvent } from '@eforge-build/engine/events';
import {
  captureTestOwnershipSnapshot,
  enforceTestOwnershipAfterStage,
  enforceTestOwnershipGuard,
  isTestPath,
  runBuildPipeline,
  validateTestOwnershipPipeline,
} from '@eforge-build/engine/pipeline';
import { collect, makeBuildCtx } from './pipeline-helpers.js';
import { useTempDir } from './test-tmpdir.js';

const FIXTURE_REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/todo-api-repo');

describe('test ownership pipeline compatibility', () => {
  it('requires exactly one test-write stage for test-writer ownership', () => {
    expect(validateTestOwnershipPipeline(['implement', 'test-write', 'test-cycle'], 'test-writer')).toBeUndefined();
    expect(validateTestOwnershipPipeline(['implement', 'test-cycle'], 'test-writer')?.reason).toContain('exactly one');
    expect(validateTestOwnershipPipeline(['implement', 'test-write'], 'builder')?.reason).toContain('incompatible');
    expect(validateTestOwnershipPipeline(['implement', 'test-write'], undefined)?.reason).toContain('explicit');
  });

  it('rejects ownership-guarded stages sharing a parallel group', () => {
    expect(validateTestOwnershipPipeline([['implement', 'test-write'], 'test-cycle'], 'test-writer')?.reason)
      .toContain('parallel group');
    expect(validateTestOwnershipPipeline([['implement', 'test']], undefined)?.reason).toContain('parallel group');
    expect(validateTestOwnershipPipeline([['implement', 'docs'], 'test'], 'builder')).toBeUndefined();
  });

  it('fails before launching stages when orchestration ownership is incompatible', async () => {
    const ctx = makeBuildCtx({ build: ['test-write'] });
    ctx.planEntry = {
      id: ctx.planId,
      name: ctx.planFile.name,
      dependsOn: [],
      branch: ctx.planFile.branch,
      build: ctx.build,
      review: ctx.review,
      testOwnership: 'existing-only',
    };

    const events = await collect(runBuildPipeline(ctx));

    expect(events.map(event => event.type)).toEqual([
      'plan:build:start',
      'plan:build:test:ownership:violation',
      'plan:build:failed',
    ]);
    expect(ctx.buildFailed).toBe(true);
  });
});

describe('test ownership stage guards', () => {
  const makeTempDir = useTempDir('eforge-test-ownership-');

  it('recognizes conventional test paths across supported languages', () => {
    expect(isTestPath('test/health.test.ts')).toBe(true);
    expect(isTestPath('src/__tests__/health.ts')).toBe(true);
    expect(isTestPath('pkg/health_test.go')).toBe(true);
    expect(isTestPath('src/HealthCheckTest.java')).toBe(true);
    expect(isTestPath('src/health.ts')).toBe(false);
  });

  it('rolls back duplicate builder test authorship in the todo-api health-check fixture', async () => {
    const repo = fixtureRepo(makeTempDir());
    const snapshot = await captureTestOwnershipSnapshot(repo);
    const testPath = path.join(repo, 'test/health.test.ts');
    writeFileSync(testPath, 'import { it } from "vitest";\nit("health", () => {});\n');
    commitAll(repo, 'test: builder authored health coverage');

    const violation = await enforceTestOwnershipAfterStage({
      snapshot,
      stage: 'implement',
      owner: 'test-writer',
    });

    expect(violation).toMatchObject({
      stage: 'implement',
      declaredOwner: 'test-writer',
      changedPaths: ['test/health.test.ts'],
    });
    expect(existsSync(testPath)).toBe(false);
    expect(git(repo, ['status', '--porcelain'])).toBe('');
  });

  it('rejects and rolls back production changes from test-write', async () => {
    const repo = fixtureRepo(makeTempDir());
    const snapshot = await captureTestOwnershipSnapshot(repo);
    writeFileSync(path.join(repo, 'src/app.ts'), 'export const changedByTestWriter = true;\n');
    commitAll(repo, 'test: invalid production edit');

    const violation = await enforceTestOwnershipAfterStage({
      snapshot,
      stage: 'test-write',
      owner: 'test-writer',
    });

    expect(violation?.changedPaths).toEqual(['src/app.ts']);
    expect(violation?.reason).toContain('non-test');
    expect(git(repo, ['status', '--porcelain'])).toBe('');
  });

  it('rejects tester-created coverage but allows a reported fix to an existing test', async () => {
    const repo = fixtureRepo(makeTempDir());
    const createSnapshot = await captureTestOwnershipSnapshot(repo);
    writeFileSync(path.join(repo, 'test/health.test.ts'), 'new acceptance coverage\n');
    const createViolation = await enforceTestOwnershipAfterStage({
      snapshot: createSnapshot,
      stage: 'test',
      owner: 'builder',
      testBugsFixed: 1,
    });
    expect(createViolation?.reason).toContain('created new test files');
    expect(existsSync(path.join(repo, 'test/health.test.ts'))).toBe(false);

    const fixSnapshot = await captureTestOwnershipSnapshot(repo);
    writeFileSync(path.join(repo, 'test/todos.test.ts'), 'corrected existing assertion\n');
    const fixViolation = await enforceTestOwnershipAfterStage({
      snapshot: fixSnapshot,
      stage: 'test',
      owner: 'existing-only',
      testBugsFixed: 1,
    });
    expect(fixViolation).toBeUndefined();
  });

  it('rejects tester edits to existing tests without a reported test-bug fix', async () => {
    const repo = fixtureRepo(makeTempDir());
    const snapshot = await captureTestOwnershipSnapshot(repo);
    writeFileSync(path.join(repo, 'test/todos.test.ts'), 'weakened assertion\n');

    const violation = await enforceTestOwnershipAfterStage({
      snapshot,
      stage: 'test',
      owner: 'existing-only',
      testBugsFixed: 0,
    });

    expect(violation?.reason).toContain('without reporting');
    expect(git(repo, ['status', '--porcelain'])).toBe('');
  });

  it('allows builder-owned implement stages to author tests', async () => {
    const repo = fixtureRepo(makeTempDir());
    const snapshot = await captureTestOwnershipSnapshot(repo);
    writeFileSync(path.join(repo, 'test/health.test.ts'), 'builder coverage\n');

    const violation = await enforceTestOwnershipAfterStage({ snapshot, stage: 'implement', owner: 'builder' });

    expect(violation).toBeUndefined();
    expect(existsSync(path.join(repo, 'test/health.test.ts'))).toBe(true);
  });

  it('skips enforcement outside a git repository', async () => {
    const dir = makeTempDir();
    expect(await captureTestOwnershipSnapshot(dir)).toBeUndefined();
    expect(await enforceTestOwnershipAfterStage({ snapshot: undefined, stage: 'test-write', owner: 'test-writer' }))
      .toBeUndefined();
  });

  it('rolls back only stage changes, preserving baseline work and neutralizing pathspec magic', async () => {
    const repo = fixtureRepo(makeTempDir());
    writeFileSync(path.join(repo, 'src/app.ts'), 'baseline dirty edit\n');
    writeFileSync(path.join(repo, 'notes.txt'), 'baseline untracked\n');
    const snapshot = await captureTestOwnershipSnapshot(repo);

    writeFileSync(path.join(repo, 'test/health.test.ts'), 'violating coverage\n');
    writeFileSync(path.join(repo, ':(glob)**'), 'pathspec magic\n');
    const violation = await enforceTestOwnershipAfterStage({ snapshot, stage: 'implement', owner: 'test-writer' });

    expect(violation?.changedPaths).toEqual(['test/health.test.ts']);
    expect(existsSync(path.join(repo, 'test/health.test.ts'))).toBe(false);
    expect(existsSync(path.join(repo, ':(glob)**'))).toBe(false);
    expect(readFileSync(path.join(repo, 'src/app.ts'), 'utf8')).toBe('baseline dirty edit\n');
    expect(readFileSync(path.join(repo, 'notes.txt'), 'utf8')).toBe('baseline untracked\n');
  });
});

describe('test ownership guard fail-closed behavior', () => {
  const failedSnapshot = {
    cwd: '/tmp/unused',
    head: '',
    trackedPaths: new Set<string>(),
    baselineChangedPaths: new Set<string>(),
    captureError: 'index.lock contention',
  };

  it('fails closed when the snapshot could not be captured and a boundary is active', async () => {
    const ctx = makeBuildCtx({ build: ['test-write'] });
    ctx.planEntry = {
      id: ctx.planId,
      name: ctx.planFile.name,
      dependsOn: [],
      branch: ctx.planFile.branch,
      build: ctx.build,
      review: ctx.review,
      testOwnership: 'test-writer',
    };

    const { events, guardTripped } = await drainGuard(enforceTestOwnershipGuard(ctx, failedSnapshot, 'test-write'));

    expect(guardTripped).toBe(true);
    expect(events.map(event => event.type)).toEqual(['plan:build:failed']);
    expect(ctx.buildFailed).toBe(true);
  });

  it('emits a diagnostic instead of failing when no boundary applies to implement', async () => {
    const ctx = makeBuildCtx();

    const { events, guardTripped } = await drainGuard(enforceTestOwnershipGuard(ctx, failedSnapshot, 'implement'));

    expect(guardTripped).toBe(false);
    expect(events.map(event => event.type)).toEqual(['plan:build:progress']);
    expect(ctx.buildFailed).not.toBe(true);
  });
});

async function drainGuard(
  gen: AsyncGenerator<EforgeEvent, boolean>,
): Promise<{ events: EforgeEvent[]; guardTripped: boolean }> {
  const events: EforgeEvent[] = [];
  let next = await gen.next();
  while (!next.done) {
    events.push(next.value);
    next = await gen.next();
  }
  return { events, guardTripped: next.value };
}

function fixtureRepo(repo: string): string {
  mkdirSync(repo, { recursive: true });
  cpSync(path.join(FIXTURE_REPO, 'src'), path.join(repo, 'src'), { recursive: true });
  cpSync(path.join(FIXTURE_REPO, 'test'), path.join(repo, 'test'), { recursive: true });
  git(repo, ['init', '-b', 'main']);
  git(repo, ['config', 'user.email', 'test@eforge.build']);
  git(repo, ['config', 'user.name', 'eforge-test']);
  commitAll(repo, 'chore: initial todo-api fixture');
  return repo;
}

function commitAll(repo: string, message: string): void {
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-m', message]);
}

function git(repo: string, args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
}
