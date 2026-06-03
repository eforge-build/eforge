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

describe('plannerStage missing orchestration.yaml', () => {
  it('emits plan:complete with unenriched plans when orchestration.yaml does not exist', async () => {
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    // Create a temp dir with no orchestration.yaml
    const tempDir = await mkdtemp(join(tmpdir(), 'eforge-test-'));

    const testPlans: PlanFile[] = [
      {
        id: 'plan-01',
        name: 'Test Plan',
        dependsOn: [],
        branch: 'test/plan-01',
        body: '# Plan body',
        filePath: join(tempDir, 'plans', 'test-plan', 'plan-01.md'),
      },
    ];

    // Register a custom planner stage that emits plan:complete
    registerCompileStage(
      testDescriptor('test-missing-orch-planner', 'compile'),
      async function* () {
        yield {
          type: 'planning:complete' as const,
          plans: testPlans,
        };
      },
    );

    const pipeline: PipelineComposition = {
      ...TEST_PIPELINE,
      compile: ['test-missing-orch-planner'],
    };

    const ctx = makePipelineCtx({ pipeline, cwd: tempDir, planSetName: 'test-plan' });
    const events = await collect(runCompilePipeline(ctx));

    // Should emit the plan:complete event without throwing
    const planComplete = events.find((e) => e.type === 'planning:complete');
    expect(planComplete).toBeDefined();
    // Plans should be the original unenriched plans (no dependsOn backfill)
    expect((planComplete as any).plans).toEqual(testPlans);

    // Clean up temp directory
    await rm(tempDir, { recursive: true });
  });
});

// ---------------------------------------------------------------------------
// Authoritative deps mapper (regression guard for silent-divergence bug)
// ---------------------------------------------------------------------------

describe('planning:complete authoritative deps override', () => {
  const makeTempDir = useTempDir('eforge-deps-mapper-');

  it('replaces wrong dependsOn in planning:complete with orchConfig values', async () => {
    const dir = makeTempDir();
    execFileSync('git', ['init'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: dir });
    const planDir = join(dir, 'eforge', 'plans', 'test-plan');
    mkdirSync(planDir, { recursive: true });

    // orchestration.yaml: plan-02 depends on plan-01 (the correct deps)
    writeFileSync(join(planDir, 'orchestration.yaml'), stringifyYaml({
      name: 'test-plan',
      description: 'test',
      created: '2026-01-01',
      mode: 'excursion',
      base_branch: 'main',
      pipeline: TEST_PIPELINE,
      plans: [
        { id: 'plan-01', name: 'Plan 01', depends_on: [], branch: 'p1', build: DEFAULT_BUILD, review: DEFAULT_REVIEW },
        { id: 'plan-02', name: 'Plan 02', depends_on: ['plan-01'], branch: 'p2', build: DEFAULT_BUILD, review: DEFAULT_REVIEW },
      ],
    }));

    const plannerHarness = new StubHarness([
      { resultText: JSON.stringify(TEST_PIPELINE) },
      {
        toolCalls: [{
          tool: 'submit_plan_set',
          toolUseId: 'submit-1',
          input: {
            description: 'test',
            plans: [
              { frontmatter: { id: 'plan-01', name: 'Plan 01' }, body: '# Plan 01' },
              { frontmatter: { id: 'plan-02', name: 'Plan 02' }, body: '# Plan 02' },
            ],
            orchestration: {
              validate: [],
              plans: [
                { id: 'plan-01', dependsOn: [], build: DEFAULT_BUILD, review: DEFAULT_REVIEW },
                { id: 'plan-02', dependsOn: ['plan-01'], build: DEFAULT_BUILD, review: DEFAULT_REVIEW },
              ],
            },
          },
          output: '',
        }],
      },
    ]);

    const ctx = makePipelineCtx({
      cwd: dir,
      planSetName: 'test-plan',
      pipeline: { ...TEST_PIPELINE, compile: ['planner'] },
      agentRuntimes: singletonRegistry(plannerHarness),
    });
    const events = await collect(runCompilePipeline(ctx));

    const planComplete = events.find((e) => e.type === 'planning:complete') as Extract<EforgeEvent, { type: 'planning:complete' }> | undefined;
    expect(planComplete).toBeDefined();
    expect(planComplete!.plans.find((p) => p.id === 'plan-02')!.dependsOn).toEqual(['plan-01']);
    expect(ctx.plans.find((p) => p.id === 'plan-02')!.dependsOn).toEqual(['plan-01']);
  });
});

// index.ts re-exports test removed: the engine barrel export was deleted as part
// of the monorepo restructuring. Consumers use subpath imports directly.
