import type { PlanningDecompositionLimits } from '@eforge-build/client';
import type { EforgeEvent } from '../events.js';
import type { AgentHarness, SdkPassthroughConfig } from '../harness.js';
import { validateCompileArtifacts } from '../compile-resilience/artifact-validation.js';
import { resolvePlanningDecompositionLimits, resolveSharedPlanningBriefLimits } from '../config.js';
import type { PipelineContext } from '../pipeline/types.js';
import { resolveAgentRuntimeForInvocationWithExtensions } from '../pipeline/agent-runtime.js';
import { AdaptiveRescopeFailClosedError, deriveAuthoritativeOwnerNeedIds, runAdaptiveExplorationRescope, type AdaptiveExplorationRescopeResult } from './adaptive-rescope.js';
import { buildCompilerDiagnostics, writeCompilerDiagnosticsArtifact, writeRescopeFailClosedArtifact } from './compiler-diagnostics.js';
import type { CompilerDiagnostics } from './compiler-diagnostics-contracts.js';
import { runBoundedPlannerCompiler, type BoundedPlannerCompilerResult } from './compiler-runner.js';
import { synthesizePlanningArtifacts, type PlanningArtifactPipelineDefaults, type PlanningArtifactSynthesisResult } from './plan-artifact-synthesis.js';
import { writePlanningCompilerArtifacts } from './plan-artifact-writer.js';
import { runPlanningSatisfactionGate } from './satisfaction-gate-agent.js';
import type { PlanningSatisfactionSkipDecision } from './satisfaction-gate-contracts.js';
import { deriveSourceInventory } from './source-inventory.js';
import { derivePlanningAtomGraph } from './atom-graph.js';

function runtimeChoiceRouterOptions(ctx: PipelineContext) { const routers = ctx.extensionRuntimeChoiceRouters ?? []; return routers.length === 0 ? undefined : { routers, profileName: ctx.configProfileName ?? 'default', cwd: ctx.cwd, configDir: ctx.extensionConfigDir, timeoutMs: ctx.config.extensions.eventHookTimeoutMs }; }

export async function* runBoundedPlannerCompilerCompileStage(ctx: PipelineContext): AsyncGenerator<EforgeEvent> {
  yield { timestamp: new Date().toISOString(), type: 'planning:progress', message: 'Starting bounded planner compiler...' };
  const { agentConfig, harness } = await resolveAgentRuntimeForInvocationWithExtensions('planner', ctx.config, ctx.agentRuntimes, undefined, { phase: 'compile', stage: 'planner' }, runtimeChoiceRouterOptions(ctx));
  const limits = resolvePlanningDecompositionLimits(ctx.config);
  const sourceContent = ctx.promptSourceContent ?? ctx.compilePromptSourceBundle?.promptSource ?? ctx.sourceContent;
  const satisfactionDecision = yield* resolveSatisfactionSkip(ctx, { sourceContent, harness, agentOptions: agentConfig, limits });
  if (satisfactionDecision.skip) {
    // Authoritative planner outcome: no plan artifacts are written, the
    // stage runner halts remaining compile stages on ctx.skipped, and the
    // queue records the run as skipped with this reason.
    yield { timestamp: new Date().toISOString(), type: 'planning:skip', reason: satisfactionDecision.reason };
    ctx.skipped = true;
    ctx.plans = [];
    return;
  }
  const exploration = yield* resolveExplorationHints(ctx, { sourceContent, harness, agentOptions: agentConfig, limits });
  let compilerResult: BoundedPlannerCompilerResult;
  try {
    compilerResult = yield* streamEvents((emit) => runBoundedPlannerCompiler({
      sourceContent,
      sourceHash: ctx.compilePromptSourceBundle?.sourceHash,
      cwd: ctx.cwd,
      harness,
      limits,
      agentOptions: agentConfig,
      parallelism: ctx.config.compile.planningUnitParallelism,
      abortSignal: ctx.abortController?.signal,
      sourceLocalizationHints: exploration?.hints,
      explorationOutcome: exploration?.outcome,
      explorationUnknownIdDrops: exploration?.unknownIdDrops,
      rescopeDirectives: exploration?.rescopeDirectives,
      rescopeDiagnostics: exploration?.diagnostics,
      sharedBriefLimits: resolveSharedPlanningBriefLimits(ctx.config),
      onEvent: emit,
    }));
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    yield { timestamp: new Date().toISOString(), type: 'planning:error', reason };
    throw err;
  }

  if (compilerResult.status === 'failed') {
    const compilerDiagnostics = buildCompilerDiagnostics({ compilerResult, planSetName: ctx.planSetName });
    yield* writeCompilerDiagnosticsBestEffort(ctx, compilerDiagnostics);
    const detail = compilerResult.validationErrors.join('; ') || compilerResult.map.failedAtomIds.join(',') || compilerResult.reduce.validationErrors.join('; ') || 'unknown failure';
    const reason = compilerResult.rescopeDiagnostics?.status === 'exhausted-proceeded' && detail.includes('Atom planner did not call')
      ? `Adaptive rescoping exhausted with critical source need(s) unresolved; failing compile instead of producing vague plans. ${detail}`
      : `Bounded planner compiler failed: ${detail}`;
    yield { timestamp: new Date().toISOString(), type: 'planning:error', reason };
    throw new Error(reason);
  }

  let artifacts: PlanningArtifactSynthesisResult;
  try {
    artifacts = synthesizePlanningArtifacts({ compilerResult });
  } catch (err) {
    // Safety net: a synthesis throw must not lose the post-mortem diagnostics
    // artifact, so write an artifact-less snapshot before failing the compile.
    yield* writeCompilerDiagnosticsBestEffort(ctx, buildCompilerDiagnostics({ compilerResult, planSetName: ctx.planSetName }));
    const reason = err instanceof Error ? err.message : String(err);
    yield { timestamp: new Date().toISOString(), type: 'planning:error', reason };
    throw err;
  }
  const compilerDiagnostics = buildCompilerDiagnostics({ compilerResult, planSetName: ctx.planSetName, artifacts });
  yield* writeCompilerDiagnosticsBestEffort(ctx, compilerDiagnostics);
  if (artifacts.validationErrors.length > 0) {
    const reason = `Bounded planner compiler produced invalid artifacts: ${artifacts.validationErrors.join('; ')}`;
    yield { timestamp: new Date().toISOString(), type: 'planning:error', reason };
    throw new Error(reason);
  }

  const pipeline = boundedCompilerPipeline(ctx, artifacts.pipelineDefaults);
  const written = await writePlanningCompilerArtifacts({
    cwd: ctx.cwd,
    outputDir: ctx.config.plan.outputDir,
    planSetName: ctx.planSetName,
    baseBranch: ctx.baseBranch,
    diffBaseRef: ctx.diffBaseRef,
    stackedValidationPinRequired: ctx.stackedValidationPinRequired,
    pipeline,
    artifacts,
    tiers: ctx.config.agents.tiers,
    diagnostics: compilerDiagnostics,
  });

  ctx.pipeline = pipeline;
  yield { timestamp: new Date().toISOString(), type: 'planning:pipeline', compile: pipeline.compile, defaultBuild: pipeline.defaultBuild, defaultReview: pipeline.defaultReview, rationale: pipeline.rationale };
  ctx.plans = written.plans;
  const validation = await validateCompileArtifacts(ctx, { compilerArtifacts: 'require' });
  for (const warning of validation.warnings) yield { timestamp: new Date().toISOString(), type: 'planning:warning', message: warning, source: 'artifact-validation' };
  if (!validation.ok) {
    yield { timestamp: new Date().toISOString(), type: 'planning:error', reason: validation.message };
    throw new Error(validation.message);
  }

  // planning:complete is emitted by the planning-quality-review-cycle stage
  // (always next in the rewritten pipeline) after the gate revalidates the
  // artifacts, so accepted orchestration fixes are reflected in planConfigs.
  yield { timestamp: new Date().toISOString(), type: 'planning:progress', message: 'Bounded planner compiler artifacts validated; running planning quality review.' };
}

async function* writeCompilerDiagnosticsBestEffort(ctx: PipelineContext, diagnostics: CompilerDiagnostics): AsyncGenerator<EforgeEvent> {
  try {
    await writeCompilerDiagnosticsArtifact({ cwd: ctx.cwd, outputDir: ctx.config.plan.outputDir, planSetName: ctx.planSetName, diagnostics });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    yield { timestamp: new Date().toISOString(), type: 'planning:warning', message: `Failed to write compiler diagnostics: ${message}`, source: 'artifact-validation' };
  }
}

interface ExplorationStageInput { sourceContent: string; harness: AgentHarness; agentOptions?: SdkPassthroughConfig & { maxTurns?: number }; limits: PlanningDecompositionLimits }

/**
 * Run the PRD-satisfaction gate before any planning work: a bounded
 * read-only agent verifies whether every acceptance criterion is already
 * implemented in the repository. Fail-open - any error or ungrounded
 * submission resolves to skip=false and the compile proceeds. Only an
 * external abort propagates.
 */
async function* resolveSatisfactionSkip(ctx: PipelineContext, input: ExplorationStageInput): AsyncGenerator<EforgeEvent, PlanningSatisfactionSkipDecision> {
  try {
    const inventory = deriveSourceInventory({ content: input.sourceContent, hash: ctx.compilePromptSourceBundle?.sourceHash });
    if (inventory.criteria.length === 0) return { skip: false, reason: 'source has no acceptance criteria to verify against the repository' };
    yield { timestamp: new Date().toISOString(), type: 'planning:progress', message: `Satisfaction gate checking ${inventory.criteria.length} acceptance criteria against the repository...` };
    const result = yield* streamEvents((emit) => runPlanningSatisfactionGate({
      cwd: ctx.cwd,
      harness: input.harness,
      agentOptions: input.agentOptions,
      inventory,
      maxToolUses: input.limits.maxLocalExplorationToolUses,
      abortSignal: ctx.abortController?.signal,
      onEvent: emit,
    }));
    yield { timestamp: new Date().toISOString(), type: 'planning:progress', message: `Satisfaction gate ${result.decision.skip ? 'skipping compile' : 'proceeding with compile'} after ${result.toolUses} tool uses: ${result.decision.reason}` };
    return result.decision;
  } catch (err) {
    if (ctx.abortController?.signal.aborted) throw err;
    const message = err instanceof Error ? err.message : String(err);
    yield { timestamp: new Date().toISOString(), type: 'planning:warning', message: `Satisfaction gate failed; proceeding with compile: ${message}`, source: 'satisfaction-gate' };
    return { skip: false, reason: `gate unavailable: ${message}` };
  }
}

/**
 * Run bounded repository exploration behind the adaptive rescope loop. The
 * loop derives the baseline inventory/graph/localization itself (a deliberate
 * duplicate of the compiler's deterministic first pass), runs exploration with
 * a need-count-derived budget, and on a risky degraded outcome splits scopes
 * and reruns exploration under a cross-run ledger. Failures degrade to no
 * hints except two cases that propagate: an external abort, and
 * AdaptiveRescopeFailClosedError - exhausted rescoping with critical needs
 * unresolved fails the compile instead of producing vague plans.
 */
async function* resolveExplorationHints(ctx: PipelineContext, input: ExplorationStageInput): AsyncGenerator<EforgeEvent, AdaptiveExplorationRescopeResult | undefined> {
  try {
    const inventory = deriveSourceInventory({ content: input.sourceContent, hash: ctx.compilePromptSourceBundle?.sourceHash });
    // Ownership authority is derived before localization from the same compiler
    // inputs as the adaptive loop; it includes required interface/contract/
    // config/consumer aspects even when no literal owner is unresolved.
    const graph = derivePlanningAtomGraph({ content: input.sourceContent, hash: inventory.sourceHash, limits: input.limits, inventory });
    const authoritativeOwnerNeedIds = deriveAuthoritativeOwnerNeedIds(inventory, graph);
    return yield* streamEvents((emit) => runAdaptiveExplorationRescope({
      cwd: ctx.cwd,
      harness: input.harness,
      agentOptions: input.agentOptions,
      sourceContent: input.sourceContent,
      inventory,
      limits: input.limits,
      authoritativeOwnerNeedIds,
      abortSignal: ctx.abortController?.signal,
      onEvent: emit,
    }));
  } catch (err) {
    if (ctx.abortController?.signal.aborted) throw err;
    if (err instanceof AdaptiveRescopeFailClosedError) {
      yield* writeRescopeFailClosedBestEffort(ctx, err);
      yield { timestamp: new Date().toISOString(), type: 'planning:error', reason: err.message };
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    yield { timestamp: new Date().toISOString(), type: 'planning:warning', message: `Repository exploration failed; continuing without hints: ${message}`, source: 'repository-exploration' };
    return undefined;
  }
}

/**
 * The main compiler diagnostics artifact is only written after the compiler
 * runs; a fail-closed rescope aborts before that, so persist the rescope
 * ledger/split history to its own artifact for post-mortem debugging.
 */
async function* writeRescopeFailClosedBestEffort(ctx: PipelineContext, err: AdaptiveRescopeFailClosedError): AsyncGenerator<EforgeEvent> {
  try {
    const artifactPath = await writeRescopeFailClosedArtifact({ cwd: ctx.cwd, outputDir: ctx.config.plan.outputDir, planSetName: ctx.planSetName, reason: err.message, rescope: err.diagnostics });
    yield { timestamp: new Date().toISOString(), type: 'planning:warning', message: `Adaptive rescope fail-closed diagnostics written to ${artifactPath}`, source: 'repository-exploration' };
  } catch (writeErr) {
    const message = writeErr instanceof Error ? writeErr.message : String(writeErr);
    yield { timestamp: new Date().toISOString(), type: 'planning:warning', message: `Failed to write rescope fail-closed diagnostics (${message}); diagnostics: ${JSON.stringify(err.diagnostics)}`, source: 'repository-exploration' };
  }
}

async function* streamEvents<T>(run: (emit: (event: EforgeEvent) => void) => Promise<T>): AsyncGenerator<EforgeEvent, T> {
  const queue: EforgeEvent[] = [];
  let wake: (() => void) | undefined;
  let settled = false;
  let result: T | undefined;
  let failure: unknown;
  const notify = (): void => { wake?.(); wake = undefined; };
  const task = run((event) => { queue.push(event); notify(); })
    .then((value) => { result = value; })
    .catch((err) => { failure = err; })
    .finally(() => { settled = true; notify(); });

  while (!settled || queue.length > 0) {
    const event = queue.shift();
    if (event) {
      yield event;
      continue;
    }
    await new Promise<void>((resolve) => { wake = resolve; });
  }
  await task;
  if (failure) throw failure;
  return result as T;
}

function boundedCompilerPipeline(ctx: PipelineContext, pipelineDefaults: PlanningArtifactPipelineDefaults): PipelineContext['pipeline'] {
  return {
    ...ctx.pipeline,
    // The planning quality gate is unconditional on the compiler path,
    // regardless of what the compiler selected.
    compile: ['planner', 'planning-quality-review-cycle'],
    defaultBuild: pipelineDefaults.defaultBuild,
    defaultReview: pipelineDefaults.defaultReview,
    rationale: `${ctx.pipeline.rationale}\nBounded planner compiler produced final plan artifacts directly.\n${pipelineDefaults.rationale}`,
  };
}
