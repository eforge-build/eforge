import { describe, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { classifyAgentTerminalSubtype } from '@eforge-build/engine/harness';
import type { CompileContextGuardDiagnostics, CompilePreflightRisk } from '@eforge-build/engine/events';
import { DEFAULT_BUILD, makePipelineCtx } from './pipeline-helpers.js';
import { useTempDir } from './test-tmpdir.js';
import { DEFAULT_REVIEW } from '@eforge-build/engine/config';
import { parseRecoverySidecarPayload } from '@eforge-build/engine/recovery/sidecar-read';
import { determineRecoveryRecommendation } from '@eforge-build/engine/recovery/recommendation';
import {
  buildCompileScopeContextFailure,
  classifyProviderContextError,
  compileScopeContextRecoveryOption,
  compileScopeTerminalFailureEvent,
  markRetryAsExpeditionStarted,
  MAX_PROVIDER_CONTEXT_EXPLANATION_BYTES,
  summarizeCompileArtifactsForRecovery,
} from '@eforge-build/engine/compile-resilience/context-recovery';

const makeTempDir = useTempDir('eforge-compile-context-');

describe('compile context recovery', () => {
  it('classifies provider context failures and ignores overloads', () => {
    expect(classifyProviderContextError(new Error('context_length_exceeded'))?.failureKind).toBe('context-length');
    expect(classifyProviderContextError(new Error('maximum context length exceeded'))?.failureKind).toBe('context-length');
    expect(classifyProviderContextError(new Error('input is too long for model'))?.failureKind).toBe('context-length');
    expect(classifyProviderContextError(new Error('prompt is too long for model'))?.failureKind).toBe('context-length');
    expect(classifyProviderContextError(new Error('context window exceeded'))?.failureKind).toBe('context-window');
    expect(classifyProviderContextError(new Error('input length and max_tokens exceed context limit'))?.failureKind).toBe('context-window');
    expect(classifyProviderContextError(new Error('too many tokens for token limit'))?.failureKind).toBe('context-window');
    expect(classifyProviderContextError(new Error('API error 529: overloaded_error'))).toBeNull();
    expect(classifyProviderContextError(new Error('WebSocket closed 1000'))).toBeNull();
    expect(classifyProviderContextError(new Error('validation failed: missing required field'))).toBeNull();
    expect(classifyAgentTerminalSubtype(new Error('maximum context length exceeded'))).toBe('error_context_window');
  });

  it('classifies context evidence from causes and provider fields', () => {
    const wrapped = new Error('agent failed', { cause: { error: { type: 'context_length_exceeded', message: 'maximum context length reached' } } });
    expect(classifyProviderContextError(wrapped)).toMatchObject({ failureKind: 'context-length' });
    expect(classifyProviderContextError({ name: 'BadRequestError', status: 400, code: 'context_limit', message: 'Claude context window is full' })).toMatchObject({ failureKind: 'context-window' });
  });

  it('bounds provider explanations', () => {
    const result = classifyProviderContextError(new Error(`context_length_exceeded ${'x'.repeat(12_000)}`));
    expect(Buffer.byteLength(result?.explanation ?? '', 'utf8')).toBeLessThanOrEqual(MAX_PROVIDER_CONTEXT_EXPLANATION_BYTES);
  });

  it('summarizes absent and valid artifacts', async () => {
    const ctx = makePipelineCtx({ cwd: await tempDir() });
    expect(await summarizeCompileArtifactsForRecovery(ctx)).toMatchObject({ orchestrationExists: false, validPlanCount: 0, missingPlanFileCount: 0 });
    const planDir = join(ctx.cwd, ctx.config.plan.outputDir, ctx.planSetName);
    await mkdir(planDir, { recursive: true });
    await writeFile(join(planDir, 'plan-01.md'), '---\nid: plan-01\nname: Plan 01\nbranch: eforge/plan-01\n---\nBody');
    await writeFile(join(planDir, 'orchestration.yaml'), stringifyYaml({
      name: ctx.planSetName,
      pipeline: ctx.pipeline,
      plans: [{ id: 'plan-01', name: 'Plan 01', branch: 'eforge/plan-01', build: DEFAULT_BUILD, review: DEFAULT_REVIEW }],
    }));
    expect(await summarizeCompileArtifactsForRecovery(ctx)).toMatchObject({ orchestrationExists: true, validPlanCount: 1, missingPlanFileCount: 0 });
  });

  it('returns retry-as-expedition for eligible no-artifact excursion failures before the retry starts', async () => {
    const ctx = makePipelineCtx({ cwd: await tempDir(), pipeline: { ...makePipelineCtx().pipeline, scope: 'excursion' }, compilePreflight: retryRisk() });
    const failure = await buildCompileScopeContextFailure(ctx, { source: 'preflight', failureKind: 'scope-too-broad', stage: 'planner', explanation: 'overflow risk', risk: retryRisk() });
    expect(failure.recovery).toMatchObject({ action: 'retry-as-expedition', eligible: true, attempted: false, attempt: 0 });
    expect(ctx.compileScopeRecovery?.retryAsExpeditionAttempts).toBe(0);
    expect(ctx.compileScopeRecovery?.attemptedSourceHashes).toEqual([]);
  });

  it('does not retry-as-expedition for live guard failures when preflight did not recommend expedition', async () => {
    const ctx = makePipelineCtx({ cwd: await tempDir(), pipeline: { ...makePipelineCtx().pipeline, scope: 'excursion' }, compilePreflight: advisoryRisk() });
    const failure = await buildCompileScopeContextFailure(ctx, { source: 'live-context-guard', failureKind: 'context-budget', stage: 'planner', explanation: 'single turn too large', risk: advisoryRisk() });
    expect(failure.recovery.action).toBe('manual-reduce-scope');
    expect(failure.recovery.eligible).toBe(false);
  });

  it('carries optional guard diagnostics without changing legacy recovery classification', async () => {
    const ctx = makePipelineCtx({ cwd: await tempDir(), pipeline: { ...makePipelineCtx().pipeline, scope: 'expedition' } });
    const legacy = await buildCompileScopeContextFailure(ctx, { source: 'provider', failureKind: 'context-window', stage: 'module-planner', explanation: 'context window exceeded' });
    const withDiagnostics = await buildCompileScopeContextFailure(ctx, {
      source: 'provider',
      failureKind: 'context-window',
      stage: 'module-planner',
      explanation: 'context window exceeded',
      guardDiagnostics: guardDiagnostics(),
    });

    expect(legacy.guardDiagnostics).toBeUndefined();
    expect(withDiagnostics.guardDiagnostics).toMatchObject({ provider: 'anthropic', modelId: 'claude-sonnet-4-5', contextWindow: 1_000_000 });
    expect(withDiagnostics.recovery).toMatchObject({
      action: legacy.recovery.action,
      eligible: legacy.recovery.eligible,
      attempted: legacy.recovery.attempted,
    });
  });

  it('increments retry-as-expedition metadata only when a retry starts and prevents second retries', async () => {
    const ctx = makePipelineCtx({ cwd: await tempDir(), pipeline: { ...makePipelineCtx().pipeline, scope: 'excursion' }, compilePreflight: retryRisk() });
    const failure = await buildCompileScopeContextFailure(ctx, { source: 'provider', failureKind: 'context-window', stage: 'planner', explanation: 'context window exceeded', risk: retryRisk() });
    expect(failure.recovery.action).toBe('retry-as-expedition');

    markRetryAsExpeditionStarted(ctx, failure);
    markRetryAsExpeditionStarted(ctx, failure);

    expect(ctx.compileScopeRecovery?.retryAsExpeditionAttempts).toBe(1);
    expect(ctx.compileScopeRecovery?.attemptedSourceHashes).toHaveLength(1);
    const capped = await buildCompileScopeContextFailure(ctx, { source: 'provider', failureKind: 'context-window', stage: 'planner', explanation: 'context window exceeded', risk: retryRisk() });
    expect(capped.recovery.action).not.toBe('retry-as-expedition');
    expect(capped.recovery.attempt).toBeGreaterThanOrEqual(capped.recovery.maxAttempts);
  });

  it('chooses bounded decomposition when already expedition with no artifacts', async () => {
    const ctx = makePipelineCtx({ cwd: await tempDir(), pipeline: { ...makePipelineCtx().pipeline, scope: 'expedition' } });
    const failure = await buildCompileScopeContextFailure(ctx, { source: 'provider', failureKind: 'context-window', stage: 'planner', explanation: 'context window exceeded' });
    expect(failure.recovery.action).toBe('bounded-decomposition');
  });

  it('prefers repair-existing-artifacts when valid compile artifacts exist', async () => {
    const ctx = makePipelineCtx({ cwd: await tempDir(), pipeline: { ...makePipelineCtx().pipeline, scope: 'excursion' }, compilePreflight: retryRisk() });
    await writeValidPlanSet(ctx);
    const failure = await buildCompileScopeContextFailure(ctx, { source: 'provider', failureKind: 'context-window', stage: 'planner', explanation: 'context window exceeded', risk: retryRisk() });
    expect(failure.recovery).toMatchObject({ action: 'repair-existing-artifacts', eligible: true, attempted: false });
    expect(ctx.compileScopeRecovery?.retryAsExpeditionAttempts).toBe(0);
  });

  it('does not prefer repair-existing-artifacts when artifacts fail final validation', async () => {
    const ctx = makePipelineCtx({ cwd: await tempDir(), pipeline: { ...makePipelineCtx().pipeline, scope: 'excursion' }, compilePreflight: retryRisk() });
    await writeValidPlanSet(ctx);
    ctx.pipeline = { ...ctx.pipeline, compile: ['planner'] };
    const failure = await buildCompileScopeContextFailure(ctx, { source: 'provider', failureKind: 'context-window', stage: 'planner', explanation: 'context window exceeded', risk: retryRisk() });
    expect(failure.recovery.action).not.toBe('repair-existing-artifacts');
    expect(failure.artifacts).toMatchObject({ validPlanCount: 1, invalidPlanCount: 1, missingPlanFileCount: 0 });
  });

  it('builds terminal events and sidecar options', async () => {
    const ctx = makePipelineCtx({ cwd: await tempDir(), pipeline: { ...makePipelineCtx().pipeline, scope: 'expedition' } });
    const failure = await buildCompileScopeContextFailure(ctx, { source: 'provider', failureKind: 'context-window', stage: 'module-planner', explanation: 'context window exceeded' });
    expect(compileScopeTerminalFailureEvent({ runId: 'run', failure })).toMatchObject({ type: 'build:terminal-failure', failure: { scope: 'compile', terminalSubtype: 'error_context_window', stage: 'module-planner' } });
    expect(compileScopeContextRecoveryOption(failure)).toMatchObject({ kind: 'compile-scope-context', action: failure.recovery.action });
    expect(compileScopeContextRecoveryOption({ ...failure, recovery: { ...failure.recovery, action: 'none' } })).toBeUndefined();
  });

  it('accepts compile-scope-context sidecars, rejects action none, and recommends compile rationale', async () => {
    const payload = sidecarPayload([{ kind: 'compile-scope-context', action: 'bounded-decomposition', recommended: true, eligible: true, reason: 'decompose', attempted: false, attempt: 0, maxAttempts: 1, source: 'provider', failureKind: 'context-window' }]);
    expect(parseRecoverySidecarPayload(JSON.stringify(payload)).recoveryOptions?.[0]).toMatchObject({ kind: 'compile-scope-context', attempt: 0 });
    expect(() => parseRecoverySidecarPayload(JSON.stringify(sidecarPayload([{ kind: 'compile-scope-context', action: 'bounded-decomposition', recommended: true, eligible: true, reason: 'decompose', attempted: false, attempt: 0, maxAttempts: 1, source: 'provider', failureKind: 'context-window' }], 3)))).toThrow(/schemaVersion 4/);
    expect(() => parseRecoverySidecarPayload(JSON.stringify(sidecarPayload([{ kind: 'compile-scope-context', action: 'none', recommended: true, eligible: true, reason: 'invalid', attempted: false, attempt: 0, maxAttempts: 1, source: 'provider', failureKind: 'context-window' }])))).toThrow(/recoveryOptions\.action/);
    expect(() => parseRecoverySidecarPayload(JSON.stringify(sidecarPayload([{ kind: 'compile-scope-context', action: 'bounded-decomposition', recommended: true, eligible: true, reason: 'invalid', attempted: false, attempt: 2, maxAttempts: 1, source: 'provider', failureKind: 'context-window' }])))).toThrow(/attempt cannot exceed/);
    const rec = determineRecoveryRecommendation({ prdId: 'p', setName: 's', featureBranch: 'f', baseBranch: 'main', plans: [], failingPlan: { planId: 'compile' }, landedCommits: [], diffStat: '', modelsUsed: [], failedAt: new Date().toISOString(), terminalFailure: { scope: 'compile', terminalSubtype: 'error_context_window', stage: 'planner' } });
    expect(rec.rationale).toContain('Compile scope/context failure');
    expect(rec.rationale).not.toContain('No failingPlans data');
  });
});

async function writeValidPlanSet(ctx: ReturnType<typeof makePipelineCtx>): Promise<void> {
  const planDir = join(ctx.cwd, ctx.config.plan.outputDir, ctx.planSetName);
  await mkdir(planDir, { recursive: true });
  await writeFile(join(planDir, 'plan-01.md'), '---\nid: plan-01\nname: Plan 01\nbranch: eforge/plan-01\n---\nBody');
  await writeFile(join(planDir, 'orchestration.yaml'), stringifyYaml({
    name: ctx.planSetName,
    pipeline: ctx.pipeline,
    plans: [{ id: 'plan-01', name: 'Plan 01', branch: 'eforge/plan-01', build: DEFAULT_BUILD, review: DEFAULT_REVIEW }],
  }));
}

function guardDiagnostics(): CompileContextGuardDiagnostics {
  return {
    provider: 'anthropic',
    modelId: 'claude-sonnet-4-5',
    metadataSource: 'registry',
    contextWindow: 1_000_000,
    outputReserveTokens: 64_000,
    overheadReserveTokens: 8_192,
    safetyMargin: 0.9,
    limits: { maxPromptBytes: 1_500_000, maxObservedInputTokens: 835_027, maxExplanationBytes: 1_500 },
  };
}

function advisoryRisk(): CompilePreflightRisk {
  return {
    level: 'normal',
    sourceBytes: 10_000,
    promptSourceBytes: 10_000,
    acceptanceCriteriaCount: 20,
    score: 20,
    generatedInventory: { detected: false, contentHashes: [], pathReferences: [], headings: [], blockCount: 0, sidecarCount: 0, omittedBytes: 0 },
    subsystemBreadth: { count: 4, subsystems: ['client', 'console', 'pi', 'plugin'], evidence: ['client', 'console', 'pi', 'plugin'] },
    pipelineScope: 'excursion',
    reasons: ['subsystem-breadth:wide'],
    recommendation: { action: 'none', eligible: false, reason: 'preflight risk is normal' },
  };
}

function retryRisk(): CompilePreflightRisk {
  return {
    level: 'overflow-risk',
    sourceBytes: 100_000,
    promptSourceBytes: 80_000,
    acceptanceCriteriaCount: 71,
    score: 100,
    generatedInventory: { detected: false, contentHashes: [], pathReferences: [], headings: [], blockCount: 0, sidecarCount: 0, omittedBytes: 0 },
    subsystemBreadth: { count: 4, subsystems: ['engine', 'client', 'monitor', 'console'], evidence: ['packages/engine', 'packages/client', 'packages/monitor', 'packages/console-ui'] },
    pipelineScope: 'excursion',
    reasons: ['acceptance-criteria:overflow'],
    recommendation: { action: 'retry-as-expedition', eligible: true, reason: 'overflow risk with broad subsystem evidence' },
  };
}

function sidecarPayload(recoveryOptions: unknown[], schemaVersion: 3 | 4 = 4) {
  return { schemaVersion, generatedAt: new Date().toISOString(), prdId: 'p', setName: 's', verdict: { verdict: 'manual', confidence: 'medium', rationale: 'r', completedWork: [], remainingWork: [], risks: [] }, report: { operatorSummary: 'r', recommendedAction: 'manual', keyEvidence: [], completedWork: [], remainingWork: [], risks: [] }, boundedEvidence: { identity: { prdId: 'p', setName: 's', featureBranch: 'f', baseBranch: 'main', failedAt: new Date().toISOString() }, plans: [], failingPlan: { planId: 'compile' }, landedCommits: [], modelsUsed: [] }, recoveryOptions };
}

async function tempDir(): Promise<string> {
  return makeTempDir();
}
