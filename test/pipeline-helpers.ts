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
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

const execAsync = promisify(execFile);
import { stringify as stringifyYaml } from 'yaml';
import { parseOrchestrationConfig } from '@eforge-build/engine/plan';
import type { EforgeEvent, PlanFile, OrchestrationConfig, ReviewIssue } from '@eforge-build/engine/events';
import type { EforgeConfig } from '@eforge-build/engine/config';
import type { PipelineComposition } from '@eforge-build/engine/schemas';
import { DEFAULT_CONFIG, DEFAULT_REVIEW } from '@eforge-build/engine/config';
import type { AgentHarness } from '@eforge-build/engine/harness';

export const DEFAULT_BUILD = ['implement', 'review-cycle'];

export const TEST_PIPELINE: PipelineComposition = {
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


/** Create a minimal StageDescriptor for testing. */
export function testDescriptor(name: string, phase: 'compile' | 'build'): StageDescriptor {
  return { name, phase, description: `Test ${name}`, whenToUse: 'testing', costHint: 'low' };
}

/** Collect all events from an async generator. */
export async function collect(gen: AsyncGenerator<EforgeEvent>): Promise<EforgeEvent[]> {
  const events: EforgeEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

/** Create a minimal PipelineContext for testing. */
export function makePipelineCtx(overrides: Partial<PipelineContext> = {}): PipelineContext {
  return {
    agentRuntimes: singletonRegistry({} as AgentHarness),
    config: DEFAULT_CONFIG,
    pipeline: TEST_PIPELINE,
    tracing: createNoopTracingContext(),
    cwd: '/tmp/test',
    planSetName: 'test-plan',
    sourceContent: '# Test',
    modelTracker: new ModelTracker(),
    plans: [],
    expeditionModules: [],
    moduleBuildConfigs: new Map(),
    ...overrides,
  };
}

/** Create a minimal BuildStageContext for testing. */
export function makeBuildCtx(overrides: Partial<BuildStageContext> = {}): BuildStageContext {
  const planFile: PlanFile = {
    id: 'plan-01',
    name: 'Test Plan',
    dependsOn: [],
    branch: 'test/plan-01',
    body: '# Plan body',
    filePath: '/tmp/test/plans/test-plan/plan-01.md',
  };
  const orchConfig: OrchestrationConfig = {
    name: 'test-plan',
    description: 'Test',
    created: new Date().toISOString(),
    mode: 'errand',
    baseBranch: 'main',
    pipeline: TEST_PIPELINE,
    plans: [{ id: 'plan-01', name: 'Test Plan', dependsOn: [], branch: 'test/plan-01', build: DEFAULT_BUILD, review: DEFAULT_REVIEW }],
  };

  return {
    agentRuntimes: singletonRegistry({} as AgentHarness),
    config: DEFAULT_CONFIG,
    pipeline: overrides?.pipeline ?? TEST_PIPELINE,
    tracing: createNoopTracingContext(),
    cwd: '/tmp/test',
    planSetName: 'test-plan',
    sourceContent: '',
    modelTracker: new ModelTracker(),
    plans: [planFile],
    expeditionModules: [],
    moduleBuildConfigs: new Map(),
    planId: 'plan-01',
    worktreePath: join(tmpdir(), `eforge-test-worktree-${randomUUID()}`),
    planFile,
    orchConfig,
    reviewIssues: [],
    build: overrides?.build ?? DEFAULT_BUILD,
    review: overrides?.review ?? DEFAULT_REVIEW,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Stage Registry Tests
// ---------------------------------------------------------------------------
