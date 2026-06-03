/**
 * Integration tests for the validate build stage with validation providers.
 *
 * Covers:
 * - No providers → no events (preserves placeholder behavior)
 * - One passing provider → start + complete events, no failure
 * - Recoverable provider with no recovery budget → start + error + exhausted progress + plan:build:failed
 * - Multiple providers, first passes, second fails → fails on second
 */

import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, it, expect } from 'vitest';
import type { AgentRunOptions } from '../packages/engine/src/harness.js';
import type { AgentRole, EforgeEvent, OrchestrationConfig, PlanFile } from '../packages/engine/src/events.js';
import type { BuildStageContext } from '../packages/engine/src/pipeline/types.js';
import type { ValidationProviderRegistration } from '../packages/engine/src/extensions/types.js';
import { DEFAULT_CONFIG, DEFAULT_REVIEW, type EforgeConfig } from '../packages/engine/src/config.js';
import { singletonRegistry } from '../packages/engine/src/agent-runtime-registry.js';
import { createNoopTracingContext } from '../packages/engine/src/tracing.js';
import { ModelTracker } from '../packages/engine/src/model-tracker.js';
import { StubHarness } from './stub-harness.js';

// We import the stage function by running the pipeline module (which registers all stages)
// then look it up from the registry.
import '../packages/engine/src/pipeline/stages/build-stages.js';
import { getBuildStage } from '../packages/engine/src/pipeline/registry.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProvider(spec: {
  name?: string;
  validate?: (...args: unknown[]) => unknown;
  commands?: string[];
}): ValidationProviderRegistration {
  return {
    kind: 'validationProvider',
    extensionName: 'test-ext',
    extensionPath: '/ext/path',
    name: spec.name ?? 'test-validator',
    value: {
      name: spec.name ?? 'test-validator',
      description: 'Test validator',
      ...(spec.validate ? { validate: spec.validate as never } : {}),
      ...(spec.commands ? { commands: spec.commands } : {}),
    },
  };
}

function makeCtx(providers: ValidationProviderRegistration[]): BuildStageContext {
  const planFile: PlanFile = {
    id: 'plan-test-01',
    name: 'Validation Provider Test Plan',
    dependsOn: [],
    branch: 'test/plan-test-01',
    body: '# Test plan',
    filePath: '/tmp/plan.md',
  };
  const orchConfig: OrchestrationConfig = {
    name: 'test',
    description: 'test',
    created: new Date().toISOString(),
    mode: 'errand',
    baseBranch: 'main',
    pipeline: { scope: 'errand', compile: [], defaultBuild: ['validate'], defaultReview: DEFAULT_REVIEW, rationale: 'test' },
    plans: [{ id: planFile.id, name: planFile.name, dependsOn: [], branch: planFile.branch, build: ['validate'], review: DEFAULT_REVIEW }],
  };
  return {
    planId: planFile.id,
    worktreePath: '/tmp/worktree-test',
    config: {
      ...DEFAULT_CONFIG,
      extensions: {
        ...DEFAULT_CONFIG.extensions,
        validationProviderTimeoutMs: 5000,
      },
    } as EforgeConfig,
    extensionValidationProviders: providers,
    agentRuntimes: singletonRegistry(new StubHarness([])),
    pipeline: orchConfig.pipeline,
    tracing: createNoopTracingContext(),
    cwd: '/tmp/cwd',
    planSetName: 'test',
    sourceContent: '',
    modelTracker: new ModelTracker(),
    plans: [planFile],
    expeditionModules: [],
    moduleBuildConfigs: new Map(),
    planFile,
    orchConfig,
    reviewIssues: [],
    build: ['validate'],
    review: {
      ...DEFAULT_REVIEW,
      strategy: 'single',
      perspectives: [],
      maxRounds: 0,
      evaluatorStrictness: 'standard',
    },
  };
}

async function runStage(ctx: BuildStageContext): Promise<{ events: import('../packages/client/src/events.js').EforgeEvent[] }> {
  const stage = getBuildStage('validate');
  if (!stage) throw new Error('validate stage not registered');
  const events: import('../packages/client/src/events.js').EforgeEvent[] = [];
  for await (const event of stage(ctx)) {
    events.push(event);
  }
  return { events };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('validate build stage', () => {
  it('no-op with empty extensionValidationProviders', async () => {
    const ctx = makeCtx([]);
    const { events } = await runStage(ctx);
    expect(events).toHaveLength(0);
    expect(ctx.buildFailed).toBeUndefined();
  });

  it('no-op with undefined extensionValidationProviders', async () => {
    const ctx = makeCtx([]);
    delete (ctx as Partial<BuildStageContext>).extensionValidationProviders;
    const { events } = await runStage(ctx);
    expect(events).toHaveLength(0);
    expect(ctx.buildFailed).toBeUndefined();
  });

  it('one passing provider emits start + complete, does not fail', async () => {
    const ctx = makeCtx([makeProvider({ validate: () => null })]);
    const { events } = await runStage(ctx);

    const types = events.map((e) => e.type);
    expect(types).toContain('extension:validation-provider:start');
    expect(types).toContain('extension:validation-provider:complete');
    expect(types).not.toContain('extension:validation-provider:error');
    expect(types).not.toContain('plan:build:failed');
    expect(ctx.buildFailed).toBeUndefined();
  });

  it('recoverable provider with no recovery budget emits exhausted progress + plan:build:failed', async () => {
    const ctx = makeCtx([makeProvider({ validate: () => ({ status: 'failed' as const, message: 'lint errors found' }) })]);
    const { events } = await runStage(ctx);

    const types = events.map((e) => e.type);
    expect(types).toContain('extension:validation-provider:start');
    expect(types).toContain('extension:validation-provider:error');
    expect(types).toContain('plan:build:progress');
    expect(types).toContain('plan:build:failed');

    // Ordering: start must precede error, progress must precede plan:build:failed
    const startIdx = types.indexOf('extension:validation-provider:start');
    const errorIdx = types.indexOf('extension:validation-provider:error');
    const progressIdx = types.indexOf('plan:build:progress');
    const failedIdx = types.indexOf('plan:build:failed');
    expect(startIdx).toBeLessThan(errorIdx);
    expect(errorIdx).toBeLessThan(progressIdx);
    expect(progressIdx).toBeLessThan(failedIdx);

    const progressEvt = events.find((e) => e.type === 'plan:build:progress') as Record<string, unknown> | undefined;
    expect(progressEvt?.message).toContain('recovery exhausted');
    const failedEvt = events.find((e) => e.type === 'plan:build:failed') as Record<string, unknown> | undefined;
    expect(failedEvt).toBeDefined();
    expect(failedEvt?.planId).toBe('plan-test-01');
    expect(failedEvt?.error).toContain('lint errors found');

    expect(ctx.buildFailed).toBe(true);
  });

  it('provider that throws sets ctx.buildFailed and emits plan:build:failed', async () => {
    const ctx = makeCtx([makeProvider({ validate: () => { throw new Error('provider crashed'); } })]);
    const { events } = await runStage(ctx);

    const types = events.map((e) => e.type);
    expect(types).toContain('extension:validation-provider:start');
    expect(types).toContain('extension:validation-provider:error');
    expect(types).toContain('plan:build:failed');
    expect(ctx.buildFailed).toBe(true);

    const failedEvt = events.find((e) => e.type === 'plan:build:failed') as Record<string, unknown> | undefined;
    expect(failedEvt?.error).toContain('provider crashed');

    // Ordering: error must precede plan:build:failed
    const errorIdx = types.indexOf('extension:validation-provider:error');
    const failedIdx = types.indexOf('plan:build:failed');
    expect(errorIdx).toBeLessThan(failedIdx);
  });

  it('provider that times out sets ctx.buildFailed and emits plan:build:failed', async () => {
    const ctx = makeCtx([makeProvider({ validate: () => new Promise(() => { /* never resolves */ }) })]);
    // Real timers with a short (100ms) provider timeout. Fake timers are unsafe here:
    // the validate stage awaits a real async git diff (computeReviewThresholdSnapshot)
    // before the provider loop, so the provider timeout's setTimeout is scheduled after
    // any synchronous timer advance would have already passed.
    ctx.config = {
      extensions: { validationProviderTimeoutMs: 100 },
    } as unknown as EforgeConfig;

    const { events } = await runStage(ctx);

    const types = events.map((e) => e.type);
    expect(types).toContain('extension:validation-provider:start');
    expect(types).toContain('extension:validation-provider:timeout');
    expect(types).toContain('plan:build:failed');
    expect(ctx.buildFailed).toBe(true);

    // Ordering: timeout must precede plan:build:failed
    const timeoutIdx = types.indexOf('extension:validation-provider:timeout');
    const failedIdx = types.indexOf('plan:build:failed');
    expect(timeoutIdx).toBeLessThan(failedIdx);
  });

  it('two providers: first passes, second fails — fails on second', async () => {
    const ctx = makeCtx([
      makeProvider({ name: 'p1', validate: () => null }),
      makeProvider({ name: 'p2', validate: () => ({ status: 'failed' as const, message: 'type errors' }) }),
    ]);
    const { events } = await runStage(ctx);

    const types = events.map((e) => e.type);
    // Both providers start
    expect(types.filter((t) => t === 'extension:validation-provider:start')).toHaveLength(2);
    // First completes, second errors
    expect(types).toContain('extension:validation-provider:complete');
    expect(types).toContain('extension:validation-provider:error');
    expect(types).toContain('plan:build:failed');
    expect(ctx.buildFailed).toBe(true);
  });

  it('two providers: both pass — no failure', async () => {
    const ctx = makeCtx([
      makeProvider({ name: 'p1', validate: () => null }),
      makeProvider({ name: 'p2', validate: () => ({ status: 'passed' as const }) }),
    ]);
    const { events } = await runStage(ctx);

    const types = events.map((e) => e.type);
    expect(types.filter((t) => t === 'extension:validation-provider:start')).toHaveLength(2);
    expect(types.filter((t) => t === 'extension:validation-provider:complete')).toHaveLength(2);
    expect(types).not.toContain('plan:build:failed');
    expect(ctx.buildFailed).toBeUndefined();
  });

  it('routes structural validation repairs through validation-fixer and evaluator context', async () => {
    const cwd = await createValidateRepo();
    let providerCalls = 0;
    const preImplementCommit = (await gitOutput(cwd, ['rev-parse', 'HEAD~1'])).trim();

    class StructuralHarness extends StubHarness {
      cachedDiffAtEvaluator = 'not-called';
      headAtEvaluator = 'not-called';

      override async *run(
        options: AgentRunOptions,
        agent: AgentRole,
        planId?: string,
      ): AsyncGenerator<EforgeEvent> {
        if (agent === 'evaluator') {
          this.cachedDiffAtEvaluator = await gitOutput(cwd, ['diff', '--cached', '--name-only']);
          this.headAtEvaluator = (await gitOutput(cwd, ['rev-parse', 'HEAD'])).trim();
        }
        for await (const event of super.run(options, agent, planId)) {
          yield event;
          if (event.type === 'agent:stop' && agent === 'validation-fixer') {
            const current = await readFile(join(cwd, 'src/app.ts'), 'utf8');
            await writeRepoFile(cwd, 'src/app.ts', `${current.trimEnd()}\nexport const repaired = true;\n`);
          }
        }
      }
    }

    const harness = new StructuralHarness([
      { text: 'Applied provider-guided structural validation repair.' },
      { toolCalls: [{ tool: 'submit_evaluation_verdicts', toolUseId: 'eval-1', input: { verdicts: [{ file: 'src/app.ts', action: 'accept', issueOutcome: 'resolved', reason: 'Directly addresses provider guidance.' }] }, output: '' }] },
    ]);
    const ctx = makeCtx([makeProvider({
      name: 'structural-validator',
      validate: () => providerCalls++ === 0
        ? {
            status: 'failed' as const,
            message: 'structural issue',
            annotations: [{ severity: 'error' as const, message: 'repair structure', file: 'src/app.ts', fix: 'Add the repaired export', retryGuidance: 'Keep the change in src/app.ts', repairClass: 'structural' as const, metadata: { rule: 'structure' } }],
          }
        : null,
    })]);
    ctx.worktreePath = cwd;
    ctx.cwd = cwd;
    ctx.agentRuntimes = singletonRegistry(harness);
    ctx.preImplementCommit = preImplementCommit;
    ctx.review = { ...ctx.review, maxRounds: 1 };

    const { events } = await runStage(ctx);

    expect(events.find((e) => e.type === 'agent:start' && e.agent === 'validation-fixer')).toBeDefined();
    expect(events.find((e) => e.type === 'plan:build:evaluate:complete')).toBeDefined();
    expect(harness.cachedDiffAtEvaluator).toContain('src/app.ts');
    expect(harness.headAtEvaluator).toBe(preImplementCommit);
    expect(harness.prompts[0]).toContain('Repair strategy: structural');
    expect(harness.prompts[0]).toContain('Checkpoint directory:');
    expect(harness.prompts[1]).toContain('Provider: structural-validator');
    expect(harness.prompts[1]).toContain('Fix guidance: Add the repaired export');
    expect(ctx.buildFailed).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// changedFiles propagation into validation provider context
// ---------------------------------------------------------------------------

const exec = promisify(execFile);
const tempDirs: string[] = [];

async function gitOutput(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd });
  return stdout;
}

async function git(cwd: string, args: string[]): Promise<void> {
  await exec('git', args, { cwd });
}

async function writeRepoFile(cwd: string, path: string, content: string): Promise<void> {
  const fullPath = join(cwd, path);
  await mkdir(join(fullPath, '..'), { recursive: true });
  await writeFile(fullPath, content);
}

async function createValidateRepo(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-validate-stage-'));
  tempDirs.push(cwd);

  await git(cwd, ['init', '-b', 'main']);
  await git(cwd, ['config', 'user.email', 'test@example.com']);
  await git(cwd, ['config', 'user.name', 'Test User']);
  await writeRepoFile(cwd, 'README.md', '# test repo\n');
  await git(cwd, ['add', '.']);
  await git(cwd, ['commit', '-m', 'initial']);

  await git(cwd, ['switch', '-c', 'feature']);
  await writeRepoFile(cwd, 'src/app.ts', 'export const answer = 42;\n');
  await writeRepoFile(cwd, 'eforge/plans/demo/plan-01.md', '# Generated plan\n');
  await git(cwd, ['add', '.']);
  await git(cwd, ['commit', '-m', 'feature change']);

  return cwd;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('validate build stage — changedFiles propagation', () => {
  it('passes the filtered plan changed-file list to a function-form provider context', async () => {
    const cwd = await createValidateRepo();
    let capturedChangedFiles: string[] | undefined;

    const ctx = makeCtx([
      makeProvider({
        validate: (_planOutputDir: unknown, providerCtx: unknown) => {
          capturedChangedFiles = (providerCtx as { changedFiles?: string[] }).changedFiles;
          return null;
        },
      }),
    ]);
    ctx.worktreePath = cwd;
    ctx.orchConfig = { baseBranch: 'main' } as unknown as BuildStageContext['orchConfig'];

    const { events } = await runStage(ctx);

    expect(events.map((e) => e.type)).toContain('extension:validation-provider:complete');
    expect(ctx.buildFailed).toBeUndefined();
    // Generated plan artifact filtered out; only the real implementation file remains.
    expect(capturedChangedFiles).toEqual(['src/app.ts']);
  });
});
