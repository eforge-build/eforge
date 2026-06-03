/**
 * Pipeline — stage registry, compile pipeline, build pipeline.
 *
 * Tests the pipeline infrastructure: stage registration/retrieval,
 * pipeline runners (compile and build), agent config threading,
 * and mutable context passing between stages.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { execFileSync, execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execAsync = promisify(execFile);
import { stringify as stringifyYaml } from 'yaml';
import { parseOrchestrationConfig } from '@eforge-build/engine/plan';
import type { EforgeEvent, PlanFile, OrchestrationConfig, ReviewIssue } from '@eforge-build/engine/events';
import type { EforgeConfig } from '@eforge-build/engine/config';
import type { PipelineComposition } from '@eforge-build/engine/schemas';
import { DEFAULT_CONFIG, DEFAULT_REVIEW } from '@eforge-build/engine/config';

const DEFAULT_BUILD = ['implement', 'review-cycle'];

const TEST_PIPELINE: PipelineComposition = {
  scope: 'excursion',
  compile: ['planner', 'plan-review-cycle'],
  defaultBuild: DEFAULT_BUILD,
  defaultReview: DEFAULT_REVIEW,
  rationale: 'test pipeline',
};
import { createNoopTracingContext } from '@eforge-build/engine/tracing';
import { ModelTracker } from '@eforge-build/engine/model-tracker';
import {
  getCompileStage,
  getBuildStage,
  getCompileStageNames,
  registerCompileStage,
  registerBuildStage,
  runCompilePipeline,
  runBuildPipeline,
  type PipelineContext,
  type BuildStageContext,
  type CompileStage,
  type BuildStage,
  type StageDescriptor,
} from '@eforge-build/engine/pipeline';
import { StubHarness } from './stub-harness.js';
import { singletonRegistry } from '@eforge-build/engine/agent-runtime-registry';
import { useTempDir } from './test-tmpdir.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import { testDescriptor, collect, makePipelineCtx, makeBuildCtx } from './pipeline-helpers.js';

describe('runBuildPipeline', () => {
  it('emits build:start and build:complete around stages', async () => {
    registerBuildStage(testDescriptor('test-impl', 'build'), async function* (ctx) {
      yield { type: 'plan:build:implement:start', planId: ctx.planId };
      yield { type: 'plan:build:implement:complete', planId: ctx.planId };
    });

    const ctx = makeBuildCtx({ build: ['test-impl'] });
    const events = await collect(runBuildPipeline(ctx));

    expect(events[0]).toMatchObject({ type: 'plan:build:start', planId: 'plan-01' });
    expect(events[events.length - 1]).toMatchObject({ type: 'plan:build:complete', planId: 'plan-01' });
  });

  it('calls all four default build stages in order', async () => {
    const order: string[] = [];

    registerBuildStage(testDescriptor('test-b-impl', 'build'), async function* () {
      order.push('implement');
      yield { type: 'planning:progress', message: 'impl' };
    });
    registerBuildStage(testDescriptor('test-b-review', 'build'), async function* () {
      order.push('review');
      yield { type: 'planning:progress', message: 'review' };
    });
    registerBuildStage(testDescriptor('test-b-eval', 'build'), async function* () {
      order.push('evaluate');
      yield { type: 'planning:progress', message: 'eval' };
    });

    const ctx = makeBuildCtx({ build: ['test-b-impl', 'test-b-review', 'test-b-eval'] });
    const events = await collect(runBuildPipeline(ctx));

    expect(order).toEqual(['implement', 'review', 'evaluate']);
    // build:start + 3 stage events + build:complete = 5
    expect(events).toHaveLength(5);
    expect(events[0].type).toBe('plan:build:start');
    expect(events[events.length - 1].type).toBe('plan:build:complete');
  });

  it('throws for unknown stage name in build list', async () => {
    const ctx = makeBuildCtx({ build: ['unknown-build-stage-xyz'] });

    await expect(collect(runBuildPipeline(ctx))).rejects.toThrow('Unknown build stage');
  });

  it('with custom profile build stages (implement + validate)', async () => {
    registerBuildStage(testDescriptor('test-custom-impl', 'build'), async function* (ctx) {
      yield { type: 'plan:build:implement:start', planId: ctx.planId };
    });
    registerBuildStage(testDescriptor('test-custom-validate', 'build'), async function* () {
      yield { type: 'planning:progress', message: 'validate' };
    });

    const ctx = makeBuildCtx({ build: ['test-custom-impl', 'test-custom-validate'] });
    const events = await collect(runBuildPipeline(ctx));

    expect(events[0].type).toBe('plan:build:start');
    expect(events[1]).toMatchObject({ type: 'plan:build:implement:start', planId: 'plan-01' });
    expect(events[2]).toMatchObject({ type: 'planning:progress', message: 'validate' });
    expect(events[3]).toMatchObject({ type: 'plan:build:complete', planId: 'plan-01' });
  });
});

// ---------------------------------------------------------------------------
// Mutable Context Tests
// ---------------------------------------------------------------------------


describe('runBuildPipeline parallel stage groups', () => {
  it('parallel group runs both stages and yields events from both', async () => {
    const stagesRun: string[] = [];

    registerBuildStage(testDescriptor('test-par-a', 'build'), async function* (ctx) {
      stagesRun.push('a');
      yield { type: 'planning:progress', message: 'par-a' };
    });
    registerBuildStage(testDescriptor('test-par-b', 'build'), async function* (ctx) {
      stagesRun.push('b');
      yield { type: 'planning:progress', message: 'par-b' };
    });

    const ctx = makeBuildCtx({ build: [['test-par-a', 'test-par-b']] });
    const events = await collect(runBuildPipeline(ctx));

    // Both stages ran
    expect(stagesRun).toContain('a');
    expect(stagesRun).toContain('b');

    // build:start + 2 stage events + auto-commit progress event + build:complete
    const progressEvents = events.filter((e) => e.type === 'planning:progress');
    expect(progressEvents.length).toBeGreaterThanOrEqual(2);
    expect(events[0]).toMatchObject({ type: 'plan:build:start', planId: 'plan-01' });
    expect(events[events.length - 1]).toMatchObject({ type: 'plan:build:complete', planId: 'plan-01' });
  });

  it('mixed config [["a", "b"], "c"] runs a+b in parallel then c sequentially', async () => {
    const order: string[] = [];

    registerBuildStage(testDescriptor('test-mix-a', 'build'), async function* () {
      order.push('a');
      yield { type: 'planning:progress', message: 'mix-a' };
    });
    registerBuildStage(testDescriptor('test-mix-b', 'build'), async function* () {
      order.push('b');
      yield { type: 'planning:progress', message: 'mix-b' };
    });
    registerBuildStage(testDescriptor('test-mix-c', 'build'), async function* () {
      order.push('c');
      yield { type: 'planning:progress', message: 'mix-c' };
    });

    const ctx = makeBuildCtx({ build: [['test-mix-a', 'test-mix-b'], 'test-mix-c'] });
    const events = await collect(runBuildPipeline(ctx));

    // a and b ran (order among them is nondeterministic), c ran after both
    expect(order).toContain('a');
    expect(order).toContain('b');
    expect(order.indexOf('c')).toBeGreaterThanOrEqual(2); // c is always after a and b

    const progressEvents = events.filter((e) => e.type === 'planning:progress');
    expect(progressEvents.length).toBeGreaterThanOrEqual(3);
    expect(events[0].type).toBe('plan:build:start');
    expect(events[events.length - 1].type).toBe('plan:build:complete');
  });

  it('buildFailed set during parallel group stops pipeline after group completes', async () => {
    const stagesRun: string[] = [];

    registerBuildStage(testDescriptor('test-fail-par-a', 'build'), async function* (ctx) {
      stagesRun.push('a');
      ctx.buildFailed = true;
      yield { type: 'planning:progress', message: 'fail-par-a' };
    });
    registerBuildStage(testDescriptor('test-fail-par-b', 'build'), async function* () {
      stagesRun.push('b');
      yield { type: 'planning:progress', message: 'fail-par-b' };
    });
    registerBuildStage(testDescriptor('test-fail-after', 'build'), async function* () {
      stagesRun.push('after');
      yield { type: 'planning:progress', message: 'after' };
    });

    const ctx = makeBuildCtx({ build: [['test-fail-par-a', 'test-fail-par-b'], 'test-fail-after'] });
    const events = await collect(runBuildPipeline(ctx));

    // Both parallel stages ran, but the sequential stage after did not
    expect(stagesRun).toContain('a');
    expect(stagesRun).toContain('b');
    expect(stagesRun).not.toContain('after');

    // No build:complete because pipeline was stopped
    expect(events.find((e) => e.type === 'plan:build:complete')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Final dirty-worktree guard in runBuildPipeline
// ---------------------------------------------------------------------------

describe('runBuildPipeline dirty-worktree guard', () => {
  const makeTempDir = useTempDir('eforge-pipeline-dirty-worktree-');

  it('emits plan:build:failed with dirty file list and no plan:build:complete when a sequential stage leaves uncommitted changes', async () => {
    // Set up a real git repository so the dirty-worktree guard can run git status
    const repoDir = makeTempDir();
    execFileSync('git', ['init', '-b', 'main'], { cwd: repoDir });
    execFileSync('git', ['config', 'user.email', 'test@eforge.build'], { cwd: repoDir });
    execFileSync('git', ['config', 'user.name', 'eforge-test'], { cwd: repoDir });
    await writeFile(join(repoDir, 'initial.txt'), 'initial\n');
    execFileSync('git', ['add', '-A'], { cwd: repoDir });
    execFileSync('git', ['commit', '-m', 'chore: initial'], { cwd: repoDir });

    // Register a build stage that writes a file WITHOUT committing it
    registerBuildStage(testDescriptor('test-dirty-stage', 'build'), async function* () {
      await writeFile(join(repoDir, 'uncommitted.txt'), 'uncommitted content\n');
      yield { type: 'planning:progress', message: 'dirty stage ran' } as EforgeEvent;
    });

    const ctx = makeBuildCtx({ build: ['test-dirty-stage'], worktreePath: repoDir });
    const events = await collect(runBuildPipeline(ctx));

    // Must emit plan:build:failed with dirty file info including porcelain status line
    const failed = events.find(e => e.type === 'plan:build:failed');
    expect(failed).toBeDefined();
    const failedError = (failed as Extract<EforgeEvent, { type: 'plan:build:failed' }>).error;
    expect(failedError).toContain('uncommitted.txt');
    // The error must include the raw porcelain status line (e.g. '?? uncommitted.txt')
    // not just the filename, so that callers can diagnose untracked vs modified files.
    expect(failedError).toMatch(/\?\? uncommitted\.txt/);

    // Must NOT emit plan:build:complete
    expect(events.find(e => e.type === 'plan:build:complete')).toBeUndefined();

    // ctx.buildFailed must be set
    expect(ctx.buildFailed).toBe(true);
  });

  it('emits plan:build:failed with dirty file list and no plan:build:complete when a sequential stage leaves modified tracked files', async () => {
    // Set up a real git repository so the dirty-worktree guard can run git status
    const repoDir = makeTempDir();
    execFileSync('git', ['init', '-b', 'main'], { cwd: repoDir });
    execFileSync('git', ['config', 'user.email', 'test@eforge.build'], { cwd: repoDir });
    execFileSync('git', ['config', 'user.name', 'eforge-test'], { cwd: repoDir });
    await writeFile(join(repoDir, 'initial.txt'), 'initial\n');
    execFileSync('git', ['add', '-A'], { cwd: repoDir });
    execFileSync('git', ['commit', '-m', 'chore: initial'], { cwd: repoDir });

    // Register a build stage that modifies an already-committed file WITHOUT committing it
    registerBuildStage(testDescriptor('test-dirty-tracked-stage', 'build'), async function* () {
      await writeFile(join(repoDir, 'initial.txt'), 'modified content\n');
      yield { type: 'planning:progress', message: 'dirty tracked stage ran' } as EforgeEvent;
    });

    const ctx = makeBuildCtx({ build: ['test-dirty-tracked-stage'], worktreePath: repoDir });
    const events = await collect(runBuildPipeline(ctx));

    // Must emit plan:build:failed with dirty file info including porcelain status line for modified tracked file
    const failed = events.find(e => e.type === 'plan:build:failed');
    expect(failed).toBeDefined();
    const failedError = (failed as Extract<EforgeEvent, { type: 'plan:build:failed' }>).error;
    expect(failedError).toContain('initial.txt');
    // The error must include the raw porcelain status line for a modified tracked file (e.g. ' M initial.txt')
    expect(failedError).toMatch(/ M initial\.txt/);

    // Must NOT emit plan:build:complete
    expect(events.find(e => e.type === 'plan:build:complete')).toBeUndefined();

    // ctx.buildFailed must be set
    expect(ctx.buildFailed).toBe(true);
  });

  it('emits plan:build:complete when the worktree is clean after all stages', async () => {
    const repoDir = makeTempDir();
    execFileSync('git', ['init', '-b', 'main'], { cwd: repoDir });
    execFileSync('git', ['config', 'user.email', 'test@eforge.build'], { cwd: repoDir });
    execFileSync('git', ['config', 'user.name', 'eforge-test'], { cwd: repoDir });
    await writeFile(join(repoDir, 'initial.txt'), 'initial\n');
    execFileSync('git', ['add', '-A'], { cwd: repoDir });
    execFileSync('git', ['commit', '-m', 'chore: initial'], { cwd: repoDir });

    // Stage that writes AND commits — clean worktree at exit
    registerBuildStage(testDescriptor('test-clean-stage', 'build'), async function* () {
      await writeFile(join(repoDir, 'committed.txt'), 'committed content\n');
      await execAsync('git', ['add', '-A'], { cwd: repoDir });
      await execAsync('git', ['commit', '-m', 'feat: committed'], { cwd: repoDir });
      yield { type: 'planning:progress', message: 'clean stage ran' } as EforgeEvent;
    });

    const ctx = makeBuildCtx({ build: ['test-clean-stage'], worktreePath: repoDir });
    const events = await collect(runBuildPipeline(ctx));

    expect(events.find(e => e.type === 'plan:build:failed')).toBeUndefined();
    expect(events.find(e => e.type === 'plan:build:complete')).toBeDefined();
    expect(ctx.buildFailed).toBeUndefined();
  });
});
