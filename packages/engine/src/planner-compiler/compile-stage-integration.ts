import type { PlanningDecompositionLimits } from '@eforge-build/client';
import type { EforgeEvent } from '../events.js';
import type { AgentHarness, SdkPassthroughConfig } from '../harness.js';
import { validateCompileArtifacts } from '../compile-resilience/artifact-validation.js';
import { resolvePlanningDecompositionLimits } from '../config.js';
import type { PipelineContext } from '../pipeline/types.js';
import { resolveAgentRuntimeForInvocationWithExtensions } from '../pipeline/agent-runtime.js';
import { derivePlanningAtomGraph } from './atom-graph.js';
import { buildCompilerDiagnostics, writeCompilerDiagnosticsArtifact } from './compiler-diagnostics.js';
import type { CompilerDiagnostics } from './compiler-diagnostics-contracts.js';
import { runBoundedPlannerCompiler, type BoundedPlannerCompilerResult } from './compiler-runner.js';
import { decideExplorationSkip } from './exploration-contracts.js';
import { runRepositoryExplorationAgent } from './exploration-agent.js';
import { synthesizePlanningArtifacts, type PlanningArtifactPipelineDefaults } from './plan-artifact-synthesis.js';
import { writePlanningCompilerArtifacts } from './plan-artifact-writer.js';
import type { SourceLocalizationInputHints } from './source-localization-contracts.js';
import { deriveSourceLocalization } from './source-localization.js';
import { deriveSourceInventory } from './source-inventory.js';

function runtimeChoiceRouterOptions(ctx: PipelineContext) { const routers = ctx.extensionRuntimeChoiceRouters ?? []; return routers.length === 0 ? undefined : { routers, profileName: ctx.configProfileName ?? 'default', cwd: ctx.cwd, configDir: ctx.extensionConfigDir, timeoutMs: ctx.config.extensions.eventHookTimeoutMs }; }

export async function* runBoundedPlannerCompilerCompileStage(ctx: PipelineContext): AsyncGenerator<EforgeEvent> {
  yield { timestamp: new Date().toISOString(), type: 'planning:progress', message: 'Starting bounded planner compiler...' };
  const { agentConfig, harness } = await resolveAgentRuntimeForInvocationWithExtensions('planner', ctx.config, ctx.agentRuntimes, undefined, { phase: 'compile', stage: 'planner' }, runtimeChoiceRouterOptions(ctx));
  const limits = resolvePlanningDecompositionLimits(ctx.config);
  const sourceContent = ctx.promptSourceContent ?? ctx.compilePromptSourceBundle?.promptSource ?? ctx.sourceContent;
  const sourceLocalizationHints = yield* resolveExplorationHints(ctx, { sourceContent, harness, agentOptions: agentConfig, limits });
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
      sourceLocalizationHints,
      onEvent: emit,
    }));
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    yield { timestamp: new Date().toISOString(), type: 'planning:error', reason };
    throw err;
  }

  const compilerDiagnostics = buildCompilerDiagnostics({ compilerResult, planSetName: ctx.planSetName });
  yield* writeCompilerDiagnosticsBestEffort(ctx, compilerDiagnostics);

  if (compilerResult.status === 'failed') {
    const reason = `Bounded planner compiler failed: ${compilerResult.validationErrors.join('; ') || compilerResult.map.failedAtomIds.join(',') || compilerResult.reduce.validationErrors.join('; ') || 'unknown failure'}`;
    yield { timestamp: new Date().toISOString(), type: 'planning:error', reason };
    throw new Error(reason);
  }

  const artifacts = synthesizePlanningArtifacts({ compilerResult });
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
    pipeline,
    artifacts,
    tiers: ctx.config.agents.tiers,
    diagnostics: compilerDiagnostics,
  });

  ctx.pipeline = pipeline;
  yield { timestamp: new Date().toISOString(), type: 'planning:pipeline', scope: pipeline.scope, compile: pipeline.compile, defaultBuild: pipeline.defaultBuild, defaultReview: pipeline.defaultReview, rationale: pipeline.rationale };
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
 * Run the bounded repository exploration agent when deterministic
 * localization confidence is too low, returning validated hints for the
 * compiler. The baseline inventory/graph/localization derivation here
 * duplicates the compiler's own deterministic first pass (both bounded);
 * the compiler re-derives from the same source. Every failure mode except
 * an external abort degrades to no hints - exploration never fails the compile.
 */
async function* resolveExplorationHints(ctx: PipelineContext, input: ExplorationStageInput): AsyncGenerator<EforgeEvent, SourceLocalizationInputHints | undefined> {
  try {
    const inventory = deriveSourceInventory({ content: input.sourceContent, hash: ctx.compilePromptSourceBundle?.sourceHash });
    const graph = derivePlanningAtomGraph({ content: input.sourceContent, hash: inventory.sourceHash, limits: input.limits, inventory });
    const baseline = await deriveSourceLocalization({ cwd: ctx.cwd, inventory, graph });
    const decision = decideExplorationSkip(baseline, inventory.summary.criterionCount);
    yield { timestamp: new Date().toISOString(), type: 'planning:progress', message: `Repository exploration ${decision.skip ? 'skipped' : 'starting'}: ${decision.reason}` };
    if (decision.skip) return undefined;
    const result = yield* streamEvents((emit) => runRepositoryExplorationAgent({
      cwd: ctx.cwd,
      harness: input.harness,
      agentOptions: input.agentOptions,
      inventory,
      baselineBundle: baseline,
      maxToolUses: input.limits.maxLocalExplorationToolUses,
      abortSignal: ctx.abortController?.signal,
      onEvent: emit,
    }));
    const droppedHintCount = result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length;
    if (droppedHintCount > 0) yield { timestamp: new Date().toISOString(), type: 'planning:warning', message: `Repository exploration dropped ${droppedHintCount} invalid hint entries.`, source: 'repository-exploration' };
    if (result.status === 'degraded') {
      yield { timestamp: new Date().toISOString(), type: 'planning:warning', message: `Repository exploration degraded to no hints: ${result.diagnostics.map((diagnostic) => diagnostic.message).join('; ') || 'no hints submitted'}`, source: 'repository-exploration' };
      return undefined;
    }
    yield { timestamp: new Date().toISOString(), type: 'planning:progress', message: `Repository exploration produced ${result.hints?.projectHints?.length ?? 0} localization hints in ${result.toolUses} tool uses.` };
    return result.hints;
  } catch (err) {
    if (ctx.abortController?.signal.aborted) throw err;
    const message = err instanceof Error ? err.message : String(err);
    yield { timestamp: new Date().toISOString(), type: 'planning:warning', message: `Repository exploration failed; continuing without hints: ${message}`, source: 'repository-exploration' };
    return undefined;
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
    // regardless of what the composer selected.
    compile: ['planner', 'planning-quality-review-cycle'],
    defaultBuild: pipelineDefaults.defaultBuild,
    defaultReview: pipelineDefaults.defaultReview,
    rationale: `${ctx.pipeline.rationale}\nBounded planner compiler produced final plan artifacts directly.\n${pipelineDefaults.rationale}`,
  };
}
