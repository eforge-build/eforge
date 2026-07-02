/**
 * Built-in compile stages — all six compile stage registrations.
 *
 * Long stage bodies delegate to module-level helper functions so each stage
 * generator stays within 80 lines.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { EforgeEvent, ExpeditionModule } from '../../events.js';
import { runModulePlanner } from '../../agents/module-planner.js';
import { parseBuildConfigBlock } from '../../agents/common.js';
import { compileExpedition } from '../../compiler.js';
import { resolveDependencyGraph, injectPipelineIntoOrchestrationYaml } from '../../plan.js';
import { runParallel, type ParallelTask } from '../../concurrency.js';
import type { ResolvedAgentConfig } from '../../config.js';

import type { PipelineContext } from '../types.js';
import { registerCompileStage } from '../registry.js';
import { resolveAgentRuntimeForInvocationWithExtensions, type ResolvedAgentRuntimeForInvocation } from '../agent-runtime.js';
import { createToolTracker } from '../span-wiring.js';
import { runArchitectureReviewCycleStage, runCohesionReviewCycleStage } from './compile-review-cycles.js';
import { formatCompilePreflightPromptAppend } from '../../compile-resilience/preflight.js';
import { compileContextGuardOptions, CompileScopeContextError, type CompileContextGuardOptions } from '../../compile-resilience/context-guard.js';
import { toCompileScopeContextError } from '../../compile-resilience/context-recovery.js';
import { validateCompileArtifacts, validateExpeditionModuleInputs } from '../../compile-resilience/artifact-validation.js';
import { derivePiCompileContextGuard } from '../../harnesses/pi-model-resolution.js';
import { runBoundedPlannerCompilerCompileStage } from '../../planner-compiler/compile-stage-integration.js';

// ---------------------------------------------------------------------------
// Module-level helpers (extracted from long stage bodies)
// ---------------------------------------------------------------------------

function mergePromptAppend(configured: string | undefined, preflightAppend: string | undefined): string {
  return [configured, preflightAppend].filter((part): part is string => Boolean(part?.trim())).join('\n\n');
}

function runtimeChoiceRouterOptions(ctx: PipelineContext) { const routers = ctx.extensionRuntimeChoiceRouters ?? []; return routers.length === 0 ? undefined : { routers, profileName: ctx.configProfileName ?? 'default', cwd: ctx.cwd, configDir: ctx.extensionConfigDir, timeoutMs: ctx.config.extensions.eventHookTimeoutMs }; }

async function resolveModelAwareCompileContextGuardOptions(
  ctx: PipelineContext,
  stage: CompileContextGuardOptions['stage'],
  agentConfig: ResolvedAgentConfig,
): Promise<CompileContextGuardOptions> {
  if (agentConfig.harness !== 'pi') {
    // Claude Agent SDK model-aware guard integration is intentionally not implemented:
    // that harness is expected to be deprecated, and Anthropic policies constrain
    // third-party harness/model metadata integrations.
    return compileContextGuardOptions({ stage, risk: ctx.compilePreflight, limits: ctx.compileContextGuardLimits });
  }
  const derived = await derivePiCompileContextGuard({ model: agentConfig.model, limits: ctx.compileContextGuardLimits });
  return compileContextGuardOptions({
    stage,
    risk: ctx.compilePreflight,
    limits: derived.limits,
    guardDiagnostics: derived.guardDiagnostics,
  });
}
/**
 * Run a single module planner attempt for one expedition module.
 * Extracted from modulePlanningStage to keep the stage body within 80 lines.
 * Uses direct span/tracker creation (createStageSpanWiring uses same metadata for
 * createSpan and setInput, but the original code uses different metadata for each).
 */
async function* runModulePlannerAttempt(
  mod: ExpeditionModule,
  ctx: PipelineContext,
  architectureContent: string,
  completedPlans: Map<string, string>,
  runtime: ResolvedAgentRuntimeForInvocation,
  contextGuard: CompileContextGuardOptions,
): AsyncGenerator<EforgeEvent> {
  const { agentConfig, harness: modulePlannerHarness, toolbeltSummary: modulePlannerTb } = runtime;
  // Gather completed dependency plan content from earlier waves
  const depContent = mod.dependsOn
    .map((depId) => completedPlans.get(depId))
    .filter((c): c is string => c !== undefined);
  const dependencyPlanContent = depContent.length > 0
    ? depContent.join('\n\n---\n\n')
    : undefined;

  // Span metadata differs between createSpan and setInput — use direct creation.
  const modSpan = ctx.tracing.createSpan('module-planner', { moduleId: mod.id });
  modSpan.setInput({ moduleId: mod.id, description: mod.description });
  const modTracker = createToolTracker(modSpan);

  try {
    for await (const event of runModulePlanner({
      cwd: ctx.cwd,
      planSetName: ctx.planSetName,
      moduleId: mod.id,
      moduleDescription: mod.description,
      moduleDependsOn: mod.dependsOn,
      architectureContent,
      sourceContent: ctx.sourceContent,
      promptSourceContent: ctx.promptSourceContent,
      contextGuard,
      dependencyPlanContent,
      verbose: ctx.verbose,
      onClarification: ctx.onClarification,
      abortController: ctx.abortController,
      outputDir: ctx.config.plan.outputDir,
      ...agentConfig,
      promptAppend: mergePromptAppend(agentConfig.promptAppend, formatCompilePreflightPromptAppend({ risk: ctx.compilePreflight, bundle: ctx.compilePromptSourceBundle })),
      ...modulePlannerTb,
      phase: 'compile',
      stage: 'module-planner',
      harness: modulePlannerHarness,
      lane: 'planning',
    })) {
      modTracker.handleEvent(event);

      // Intercept <build-config> blocks from module planner messages
      if (event.type === 'agent:message') {
        const result = parseBuildConfigBlock(event.content);
        if (result.ok) {
          ctx.moduleBuildConfigs.set(mod.id, result.config);
        } else if (result.reason === 'invalid-json' || result.reason === 'invalid-schema') {
          yield {
            timestamp: new Date().toISOString(),
            type: 'planning:module:build-config:invalid' as const,
            moduleId: mod.id,
            reason: result.reason,
            errors: result.reason === 'invalid-schema'
              ? result.errors
              : [`raw: ${result.raw.slice(0, 200)}`],
          };
        }
        // result.reason === 'no-block' → normal case, do nothing
      }

      yield event;
    }
    modTracker.cleanup();
    modSpan.end();
  } catch (err) {
    if (err instanceof CompileScopeContextError) {
      modTracker.cleanup();
      modSpan.error(err);
      throw err;
    }
    const contextError = await toCompileScopeContextError(ctx, err, 'module-planner', contextGuard.guardDiagnostics);
    if (contextError) {
      modTracker.cleanup();
      modSpan.error(contextError);
      throw contextError;
    }
    // Module planning failure is non-fatal - continue with other modules
    modTracker.cleanup();
    modSpan.error(err as Error);
  }
}

// ---------------------------------------------------------------------------
// Built-in Compile Stages
// ---------------------------------------------------------------------------

registerCompileStage({
  name: 'planner',
  phase: 'compile',
  description: 'Runs the bounded planner compiler to decompose a PRD into implementation plans with dependency graphs.',
  whenToUse: 'For any task that needs planning and decomposition. The default compile entry point.',
  costHint: 'high',
  conflictsWith: [],
  parallelizable: false,
}, async function* plannerStage(ctx) {
  yield* runBoundedPlannerCompilerCompileStage(ctx);
});

registerCompileStage({
  name: 'architecture-review-cycle',
  phase: 'compile',
  description: 'Reviews the architecture document produced by the planner in expedition mode for completeness and correctness.',
  whenToUse: 'For expedition-scale work where an architecture document defines module boundaries and contracts.',
  costHint: 'medium',
  predecessors: ['planner'],
  parallelizable: false,
}, async function* architectureReviewCycleStage(ctx) {
  yield* runArchitectureReviewCycleStage(ctx);
});

registerCompileStage({
  name: 'module-planning',
  phase: 'compile',
  description: 'Plans individual modules in dependency order, running module planners in parallel within each wave.',
  whenToUse: 'For expedition-scale work after architecture review, when the planner has identified modules.',
  costHint: 'high',
  predecessors: ['planner'],
  parallelizable: false,
}, async function* modulePlanningStage(ctx) {
  // Only runs when expedition modules are detected
  if (ctx.expeditionModules.length === 0) return;

  const cwd = ctx.cwd;
  const planDir = resolve(cwd, ctx.config.plan.outputDir, ctx.planSetName);

  // Read architecture content for module planners
  let architectureContent = '';
  try {
    architectureContent = await readFile(resolve(planDir, 'architecture.md'), 'utf-8');
  } catch {
    // Architecture file may not exist if planner didn't create it
  }

  // 1. Compute dependency waves via topological sort
  const plansForGraph = ctx.expeditionModules.map((mod) => ({
    id: mod.id,
    name: mod.id,
    dependsOn: mod.dependsOn,
    branch: mod.id,
  }));
  const { waves } = resolveDependencyGraph(plansForGraph);
  const moduleMap = new Map(ctx.expeditionModules.map((m) => [m.id, m]));
  const completedPlans = new Map<string, string>(); // moduleId -> plan file content
  // 2. Plan each wave (parallel within wave, sequential across waves)
  for (let waveIdx = 0; waveIdx < waves.length; waveIdx++) {
    const waveModuleIds = waves[waveIdx];
    yield { timestamp: new Date().toISOString(), type: 'expedition:wave:start', wave: waveIdx + 1, moduleIds: waveModuleIds };

    const waveTasks: ParallelTask<EforgeEvent>[] = waveModuleIds.map((modId) => ({
      id: modId,
      run: async function* () {
        const runtime = await resolveAgentRuntimeForInvocationWithExtensions('module-planner', ctx.config, ctx.agentRuntimes, undefined, { phase: 'compile', stage: 'module-planner' }, runtimeChoiceRouterOptions(ctx));
        const contextGuard = await resolveModelAwareCompileContextGuardOptions(ctx, 'module-planner', runtime.agentConfig);
        yield* runModulePlannerAttempt(moduleMap.get(modId)!, ctx, architectureContent, completedPlans, runtime, contextGuard);
      },
    }));

    yield* runParallel(waveTasks, { rethrowIf: (err) => err instanceof CompileScopeContextError });

    // Read completed module plan files for this wave (context for later waves)
    for (const modId of waveModuleIds) {
      try {
        const content = await readFile(resolve(planDir, 'modules', `${modId}.md`), 'utf-8');
        completedPlans.set(modId, content);
      } catch {
        // Module planner may have failed - skip
      }
    }

    yield { timestamp: new Date().toISOString(), type: 'expedition:wave:complete', wave: waveIdx + 1 };
  }
});

registerCompileStage({
  name: 'cohesion-review-cycle',
  phase: 'compile',
  description: 'Reviews module plans for cohesion and consistency with the architecture document.',
  whenToUse: 'For expedition-scale work after module planning, to ensure modules work together coherently.',
  costHint: 'medium',
  predecessors: ['planner', 'module-planning'],
  parallelizable: false,
}, async function* cohesionReviewCycleStage(ctx) {
  yield* runCohesionReviewCycleStage(ctx);
});

registerCompileStage({
  name: 'compile-expedition',
  phase: 'compile',
  description: 'Compiles module plans into concrete plan files with orchestration config for the build phase.',
  whenToUse: 'Final compile stage for expedition-scale work. Produces the plan files that build stages consume.',
  costHint: 'low',
  predecessors: ['planner', 'module-planning'],
  parallelizable: false,
}, async function* compileExpeditionStage(ctx) {
  // Only runs when expedition modules are detected
  if (ctx.expeditionModules.length === 0) return;

  const moduleValidation = await validateExpeditionModuleInputs(ctx);
  if (!moduleValidation.ok) {
    yield { timestamp: new Date().toISOString(), type: 'planning:error', reason: moduleValidation.message };
    throw new Error(moduleValidation.message);
  }

  yield { timestamp: new Date().toISOString(), type: 'expedition:compile:start' };
  await compileExpedition(ctx.cwd, ctx.planSetName, ctx.moduleBuildConfigs, ctx.config.plan.outputDir);

  // Write the full pipeline composition and backfill per-plan build/review from
  // defaults for any module whose planner didn't emit a <build-config> block.
  // Without this, parseOrchestrationConfig rejects the file.
  const orchYamlPath = resolve(ctx.cwd, ctx.config.plan.outputDir, ctx.planSetName, 'orchestration.yaml');
  await injectPipelineIntoOrchestrationYaml(orchYamlPath, ctx.pipeline, ctx.baseBranch, ctx.diffBaseRef);

  const artifactValidation = await validateCompileArtifacts(ctx);
  for (const warning of artifactValidation.warnings) {
    yield { timestamp: new Date().toISOString(), type: 'planning:warning', message: warning, source: 'artifact-validation' };
  }
  if (!artifactValidation.ok) {
    yield { timestamp: new Date().toISOString(), type: 'planning:error', reason: artifactValidation.message };
    throw new Error(artifactValidation.message);
  }
  const plans = artifactValidation.plans;
  const expeditionPlanConfigs = artifactValidation.orchestration?.plans.map(p => ({ id: p.id, build: p.build, review: p.review }));

  yield { timestamp: new Date().toISOString(), type: 'expedition:compile:complete', plans };
  yield { timestamp: new Date().toISOString(), type: 'planning:complete', plans, ...(expeditionPlanConfigs && { planConfigs: expeditionPlanConfigs }) };

  // Update context plans for downstream stages
  ctx.plans = plans;
});
