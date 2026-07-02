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

describe('stage registry', () => {
  it('getCompileStage returns a function for built-in planner stage', () => {
    const stage = getCompileStage('planner');
    expect(typeof stage).toBe('function');
  });

  it('getCompileStage throws for nonexistent stage', () => {
    expect(() => getCompileStage('nonexistent')).toThrow('Unknown compile stage');
  });

  it('getBuildStage returns a function for built-in implement stage', () => {
    const stage = getBuildStage('implement');
    expect(typeof stage).toBe('function');
  });

  it('getBuildStage throws for nonexistent stage', () => {
    expect(() => getBuildStage('nonexistent')).toThrow('Unknown build stage');
  });

  it('registerCompileStage makes stage retrievable', () => {
    const fn: CompileStage = async function* () { /* noop */ };
    registerCompileStage(testDescriptor('test-compile-stage', 'compile'), fn);
    expect(getCompileStage('test-compile-stage')).toBe(fn);
  });

  it('registerBuildStage makes stage retrievable', () => {
    const fn: BuildStage = async function* () { /* noop */ };
    registerBuildStage(testDescriptor('test-build-stage', 'build'), fn);
    expect(getBuildStage('test-build-stage')).toBe(fn);
  });

  it('all built-in compile stages are registered', () => {
    const builtinCompileStages = ['planner', 'planning-quality-review-cycle'];
    for (const name of builtinCompileStages) {
      expect(() => getCompileStage(name)).not.toThrow();
      expect(typeof getCompileStage(name)).toBe('function');
    }
  });

  it('all built-in build stages are registered', () => {
    const builtinBuildStages = ['implement', 'review', 'evaluate', 'review-fix', 'review-cycle', 'validate', 'doc-author', 'doc-sync', 'test-write', 'test', 'test-cycle'];
    for (const name of builtinBuildStages) {
      expect(() => getBuildStage(name)).not.toThrow();
      expect(typeof getBuildStage(name)).toBe('function');
    }
  });
});

// ---------------------------------------------------------------------------
// runCompilePipeline Tests
// ---------------------------------------------------------------------------

describe('runCompilePipeline', () => {
  it('calls stages in order from pipeline compile list', async () => {
    const order: string[] = [];

    registerCompileStage(testDescriptor('test-stage-a', 'compile'), async function* () {
      order.push('a');
      yield { type: 'planning:progress', message: 'stage-a' };
    });
    registerCompileStage(testDescriptor('test-stage-b', 'compile'), async function* () {
      order.push('b');
      yield { type: 'planning:progress', message: 'stage-b' };
    });

    const pipeline: PipelineComposition = {
      ...TEST_PIPELINE,
      compile: ['test-stage-a', 'test-stage-b'],
    };

    const ctx = makePipelineCtx({ pipeline });
    const events = await collect(runCompilePipeline(ctx));

    expect(order).toEqual(['a', 'b']);
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ type: 'planning:progress', message: 'stage-a' });
    expect(events[1]).toEqual({ type: 'planning:progress', message: 'stage-b' });
  });

  it('yields zero events with empty compile list', async () => {
    const pipeline: PipelineComposition = {
      ...TEST_PIPELINE,
      compile: [],
    };

    const ctx = makePipelineCtx({ pipeline });
    const events = await collect(runCompilePipeline(ctx));

    expect(events).toHaveLength(0);
  });

  it('skipped flag halts pipeline after the stage that sets it', async () => {
    const stagesRun: string[] = [];

    registerCompileStage(testDescriptor('test-skip-planner', 'compile'), async function* (ctx) {
      stagesRun.push('planner');
      ctx.skipped = true;
      yield { type: 'planning:skip', reason: 'Already done' };
    });
    registerCompileStage(testDescriptor('test-skip-review', 'compile'), async function* () {
      stagesRun.push('review');
      yield { type: 'planning:progress', message: 'review' };
    });

    const pipeline: PipelineComposition = {
      ...TEST_PIPELINE,
      compile: ['test-skip-planner', 'test-skip-review'],
    };

    const ctx = makePipelineCtx({ pipeline });
    const events = await collect(runCompilePipeline(ctx));

    expect(stagesRun).toEqual(['planner']);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: 'planning:skip', reason: 'Already done' });
  });

  it('throws for unknown stage name in compile list', async () => {
    const pipeline: PipelineComposition = {
      ...TEST_PIPELINE,
      compile: ['unknown-stage-xyz'],
    };

    const ctx = makePipelineCtx({ pipeline });

    await expect(collect(runCompilePipeline(ctx))).rejects.toThrow('Unknown compile stage');
  });

  it('with planner only (no plan-review-cycle), only planner stage runs', async () => {
    const stagesRun: string[] = [];

    registerCompileStage(testDescriptor('test-planner-only', 'compile'), async function* () {
      stagesRun.push('planner');
      yield { type: 'planning:progress', message: 'planned' };
    });

    const pipeline: PipelineComposition = {
      ...TEST_PIPELINE,
      compile: ['test-planner-only'],
    };

    const ctx = makePipelineCtx({ pipeline });
    const events = await collect(runCompilePipeline(ctx));

    expect(stagesRun).toEqual(['planner']);
    expect(events).toHaveLength(1);
  });

  it('restarts loop when a stage replaces ctx.pipeline.compile', async () => {
    const stagesRun: string[] = [];

    // Stage that mutates the compile list to ['stage-x']
    registerCompileStage(testDescriptor('test-mutator', 'compile'), async function* (ctx) {
      stagesRun.push('mutator');
      ctx.pipeline = { ...ctx.pipeline, compile: ['test-stage-x'] };
      yield { type: 'planning:progress', message: 'mutated' };
    });

    registerCompileStage(testDescriptor('test-stage-x', 'compile'), async function* () {
      stagesRun.push('stage-x');
      yield { type: 'planning:progress', message: 'stage-x ran' };
    });

    const pipeline: PipelineComposition = {
      ...TEST_PIPELINE,
      compile: ['test-mutator'],
    };

    const ctx = makePipelineCtx({ pipeline });
    const events = await collect(runCompilePipeline(ctx));

    expect(stagesRun).toEqual(['mutator', 'stage-x']);
    expect(events.map((e) => (e as any).message)).toEqual(['mutated', 'stage-x ran']);
  });

  it('does not run old remaining stages after compile list replacement', async () => {
    const stagesRun: string[] = [];

    // First stage replaces compile list, removing 'test-old-next'
    registerCompileStage(testDescriptor('test-replacer', 'compile'), async function* (ctx) {
      stagesRun.push('replacer');
      ctx.pipeline = { ...ctx.pipeline, compile: ['test-new-stage'] };
      yield { type: 'planning:progress', message: 'replaced' };
    });

    registerCompileStage(testDescriptor('test-old-next', 'compile'), async function* () {
      stagesRun.push('old-next');
      yield { type: 'planning:progress', message: 'should not run' };
    });

    registerCompileStage(testDescriptor('test-new-stage', 'compile'), async function* () {
      stagesRun.push('new-stage');
      yield { type: 'planning:progress', message: 'new stage ran' };
    });

    const pipeline: PipelineComposition = {
      ...TEST_PIPELINE,
      compile: ['test-replacer', 'test-old-next'],
    };

    const ctx = makePipelineCtx({ pipeline });
    const events = await collect(runCompilePipeline(ctx));

    // 'test-old-next' should NOT have run; only replacer + new-stage
    expect(stagesRun).toEqual(['replacer', 'new-stage']);
    expect(events.map((e) => (e as any).message)).toEqual(['replaced', 'new stage ran']);
  });

  it('does not re-run a stage when its composer shrinks the compile list but keeps the stage at position 0', async () => {
    // Regression: plannerStage's composer call shrinks compile from
    // ['planner', 'plan-review-cycle'] to ['planner']. The planner stage then
    // runs the planner agent and writes plan files. Previously the compile
    // loop would detect the list change and restart at i=0, re-running
    // plannerStage (and its composer) a second time — producing a duplicate
    // set of plan files with a conflicting ID.
    let runCount = 0;

    registerCompileStage(testDescriptor('test-shrink-planner', 'compile'), async function* (ctx) {
      runCount++;
      // Simulate composer shrinking the list before running the agent body
      ctx.pipeline = { ...ctx.pipeline, compile: ['test-shrink-planner'] };
      yield { type: 'planning:progress', message: `planner ran ${runCount}` };
    });

    registerCompileStage(testDescriptor('test-shrink-review', 'compile'), async function* () {
      yield { type: 'planning:progress', message: 'review ran' };
    });

    const pipeline: PipelineComposition = {
      ...TEST_PIPELINE,
      compile: ['test-shrink-planner', 'test-shrink-review'],
    };

    const ctx = makePipelineCtx({ pipeline });
    await collect(runCompilePipeline(ctx));

    // Planner stage must run exactly once — no duplicate invocation from a loop restart.
    expect(runCount).toBe(1);
  });

  it('does not restart when a stage replaces ctx.pipeline with the same compile stages', async () => {
    let runCount = 0;

    // Stage that replaces ctx.pipeline (new object reference) but keeps the same stages
    registerCompileStage(testDescriptor('test-same-replace', 'compile'), async function* (ctx) {
      runCount++;
      ctx.pipeline = { ...ctx.pipeline, compile: ['test-same-replace', 'test-after'] };
      yield { type: 'planning:progress', message: `ran ${runCount}` };
    });

    registerCompileStage(testDescriptor('test-after', 'compile'), async function* () {
      yield { type: 'planning:progress', message: 'after' };
    });

    const pipeline: PipelineComposition = {
      ...TEST_PIPELINE,
      compile: ['test-same-replace', 'test-after'],
    };

    const ctx = makePipelineCtx({ pipeline });
    await collect(runCompilePipeline(ctx));

    // Stage should run exactly once - no restart despite new object reference
    expect(runCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// plannerStage expedition wiring (regression)
// ---------------------------------------------------------------------------
