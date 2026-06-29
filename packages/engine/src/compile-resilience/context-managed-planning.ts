import { createHash } from 'node:crypto';

import type { DecompositionFailureEvidence, EforgeEvent } from '../events.js';
import { PLANNING_DECOMPOSITION_MAX_CRITERIA, PLANNING_DECOMPOSITION_MAX_LIST_ITEMS, PLANNING_DECOMPOSITION_MAX_SPLIT_ATTEMPTS, PLANNING_DECOMPOSITION_MAX_STRING_LENGTH, PLANNING_DECOMPOSITION_MAX_UNRESOLVED_CRITERIA } from '../events.js';
import type { PipelineContext } from '../pipeline/types.js';
import { resolveAgentConfig } from '../pipeline/agent-config.js';
import { CompileScopeContextError } from './context-guard.js';
import { resolvePlanningDecompositionLimits } from './planning-decomposition-limits.js';
import { derivePlanningDecompositionGraph, evaluatePlanningUnitBudgetPressure, selectReadyPlanningBatch, splitOverBudgetPlanningUnit, type DecompositionPlanningError, type PlanningDecompositionGraph, type PlanningDecompositionUnit, type PlanningUnitOutput } from './planning-decomposition.js';
import { toDecompositionCompileScopeFailure } from './context-recovery.js';
import { initializeDecompositionArtifacts, writeGraphArtifact, writeUnitOutputArtifact } from './context-managed-planning/artifacts.js';
import { decompositionStartEvent, scheduleEvent, synthesisCompleteEvent, unitQueuedEvent, unitSkippedEvent } from './context-managed-planning/events.js';
import { synthesizeContextManagedPlanning, type ContextManagedSynthesisResult } from './context-managed-planning/synthesis.js';
import { runBoundedPlanningBatch } from './context-managed-planning/unit-runner.js';

export interface ContextManagedCompilePlanningResult extends ContextManagedSynthesisResult {
  graph: PlanningDecompositionGraph;
  unitOutputs: PlanningUnitOutput[];
  decompositionArtifactDir: string;
}

export async function* runContextManagedCompilePlanning(ctx: PipelineContext): AsyncGenerator<EforgeEvent, ContextManagedCompilePlanningResult> {
  const limits = resolvePlanningDecompositionLimits(ctx.config);
  const sourceHash = ctx.compilePromptSourceBundle?.sourceHash ?? createHash('sha256').update(ctx.sourceContent).digest('hex');
  let graph = derivePlanningDecompositionGraph({ source: { content: ctx.sourceContent, hash: sourceHash }, preflightRisk: ctx.compilePreflight, pipelineComposition: ctx.pipeline, limits });
  const decompositionArtifactDir = await initializeDecompositionArtifacts(ctx, graph);
  ctx.contextManagedPlanning = { decompositionArtifactDir, graphId: graph.graphId, unitOutputs: [], unitToModuleMap: {}, planningParallelism: limits.parallelism };
  yield decompositionStartEvent({ graph, runId: ctx.runId, riskEvidence: ctx.compilePreflight ? { level: ctx.compilePreflight.level, score: ctx.compilePreflight.score, sourceBytes: ctx.compilePreflight.sourceBytes, promptSourceBytes: ctx.compilePreflight.promptSourceBytes, acceptanceCriteriaCount: ctx.compilePreflight.acceptanceCriteriaCount, subsystemSummaries: ctx.compilePreflight.subsystemBreadth.subsystems, recommendationAction: ctx.compilePreflight.recommendation.action, selectedScope: ctx.pipeline.scope } : undefined });
  for (const unit of graph.units) yield unitQueuedEvent(unit);

  const outputs: PlanningUnitOutput[] = [];
  const completed = new Set<string>();
  const failed = new Set<string>();
  const skipped = new Set<string>();
  const { toolbeltSummary } = ctx.agentRuntimes.forRoleResolved(ctx.pipeline.scope === 'expedition' ? 'module-planner' : 'planner');
  const agentConfig = resolveAgentConfig(ctx.pipeline.scope === 'expedition' ? 'module-planner' : 'planner', ctx.config, undefined, toolbeltSummary);

  while (true) {
    const activeUnits = graph.units.filter(unit => !skipped.has(unit.unitId));
    if (activeUnits.every(unit => completed.has(unit.unitId))) break;
    const decision = selectReadyPlanningBatch({ graph, completedUnitIds: completed, failedUnitIds: failed, skippedUnitIds: skipped, parallelism: limits.parallelism });
    yield scheduleEvent(decision);
    const batch = decision.selectedBatchUnitIds.map(id => graph.units.find(unit => unit.unitId === id)).filter((unit): unit is PlanningDecompositionUnit => Boolean(unit));
    if (batch.length === 0) {
      throw await toCompileScopeError(ctx, terminalError(graph, activeUnits.find(unit => !completed.has(unit.unitId)) ?? activeUnits[0]));
    }
    batch.forEach(unit => { unit.status = 'running'; });
    const result = yield* runBoundedPlanningBatch({ ctx, units: batch, completedOutputs: outputs, agentConfig });
    for (const output of result.outputs) {
      outputs.push(output);
      await writeUnitOutputArtifact(ctx, output);
      const unit = graph.units.find(item => item.unitId === output.unitId);
      if (!unit) continue;
      if (output.status === 'completed') { unit.status = 'completed'; completed.add(unit.unitId); failed.delete(unit.unitId); continue; }
      if (output.status === 'skipped') { unit.status = 'skipped'; completed.add(unit.unitId); failed.delete(unit.unitId); continue; }
      if (!output.observedBudget?.triggeredLimitKeys.length) throw await toCompileScopeError(ctx, terminalError(graph, unit, output));
      const split = splitOverBudgetPlanningUnit({ graph, unit, observedPressure: output.observedBudget, limits });
      if ('kind' in split) throw await toCompileScopeError(ctx, split);
      graph = split.graph;
      skipped.add(unit.unitId);
      unit.status = 'skipped';
      yield unitSkippedEvent(unit, 'recursive split scheduled smaller bounded planning units');
      for (const childId of split.childUnitIds) {
        const child = graph.units.find(item => item.unitId === childId);
        if (child) yield unitQueuedEvent(child);
      }
      await writeGraphArtifact(ctx, graph);
    }
    for (const error of result.errors) {
      if (outputs.some(output => output.unitId === error.unit.unitId)) continue;
      const observed = observedFromContextError(error.error, error.unit);
      if (observed?.triggeredLimitKeys.length) {
        const split = splitOverBudgetPlanningUnit({ graph, unit: error.unit, observedPressure: observed, limits });
        if ('kind' in split) throw await toCompileScopeError(ctx, split);
        graph = split.graph;
        skipped.add(error.unit.unitId);
        error.unit.status = 'skipped';
        yield unitSkippedEvent(error.unit, 'recursive split scheduled smaller bounded planning units');
        for (const childId of split.childUnitIds) {
          const child = graph.units.find(item => item.unitId === childId);
          if (child) yield unitQueuedEvent(child);
        }
        continue;
      }
      throw await toCompileScopeError(ctx, terminalError(graph, error.unit, undefined, error.error));
    }
    await writeGraphArtifact(ctx, graph);
  }

  if (outputs.every(output => output.status === 'skipped') && graph.units.length > 0 && graph.units.every(unit => completed.has(unit.unitId) || skipped.has(unit.unitId))) {
    ctx.skipped = true;
    yield { timestamp: new Date().toISOString(), type: 'planning:skip', reason: 'All bounded planning units reported the work is already implemented.' };
    return { plans: [], expeditionModules: [], artifactPaths: [], unitToModuleMap: {}, graph, unitOutputs: outputs, decompositionArtifactDir };
  }

  const synthesis = await synthesizeContextManagedPlanning({ ctx, graph, outputs });
  ctx.contextManagedPlanning = { decompositionArtifactDir, graphId: graph.graphId, unitOutputs: outputs, unitToModuleMap: synthesis.unitToModuleMap, planningParallelism: limits.parallelism };
  yield synthesisCompleteEvent({ graph, artifactPaths: synthesis.artifactPaths });
  if (ctx.pipeline.scope !== 'expedition') yield { timestamp: new Date().toISOString(), type: 'planning:complete', plans: synthesis.plans, ...(synthesis.planConfigs && { planConfigs: synthesis.planConfigs }) };
  else yield { timestamp: new Date().toISOString(), type: 'expedition:architecture:complete', modules: synthesis.expeditionModules };
  return { ...synthesis, graph, unitOutputs: outputs, decompositionArtifactDir };
}

function terminalError(graph: PlanningDecompositionGraph, unit: PlanningDecompositionUnit, output?: PlanningUnitOutput, error?: unknown): DecompositionPlanningError {
  const reason = error instanceof Error ? error.message : String(error ?? 'bounded planning unit could not be split further');
  return {
    kind: 'decomposition-exhausted',
    stage: 'planning-decomposition',
    source: 'decomposition',
    message: cap(`Planning decomposition exhausted for ${unit.unitId}: ${reason}`),
    evidence: {
      unitId: unit.unitId,
      parentUnitId: unit.parentId,
      depth: unit.depth,
      budgets: unit.budgets,
      observed: output?.observedBudget ?? { triggeredLimitKeys: [] },
      assignedCriteriaIds: unit.criteriaIds.slice(0, PLANNING_DECOMPOSITION_MAX_CRITERIA).map(cap),
      unresolvedCriteria: (output?.unresolvedRequirements ?? unit.criteriaIds.map(criterionId => ({ criterionId, reason, evidence: unit.unitId }))).slice(0, PLANNING_DECOMPOSITION_MAX_UNRESOLVED_CRITERIA).map(item => ({ criterionId: cap(item.criterionId), reason: cap(item.reason), evidence: item.evidence ? cap(item.evidence) : undefined })),
      blockers: [cap(reason)].slice(0, PLANNING_DECOMPOSITION_MAX_LIST_ITEMS),
      splitAttempts: graph.splitAttempts.filter(attempt => attempt.unitId === unit.unitId).slice(-PLANNING_DECOMPOSITION_MAX_SPLIT_ATTEMPTS),
    },
  };
}

function observedFromContextError(error: unknown, unit: PlanningDecompositionUnit): DecompositionFailureEvidence['observed'] | undefined {
  if (!(error instanceof CompileScopeContextError)) return undefined;
  const decompositionObserved = error.failure.decompositionEvidence?.observed;
  if (decompositionObserved) return decompositionObserved;
  return evaluatePlanningUnitBudgetPressure({
    unit,
    observed: {
      promptBytes: error.failure.observed?.promptBytes,
      observedInputTokens: error.failure.observed?.inputTokens,
      observedTurns: error.failure.observed?.turns,
    },
  });
}

function cap(value: string): string {
  return value.length <= PLANNING_DECOMPOSITION_MAX_STRING_LENGTH ? value : `${value.slice(0, PLANNING_DECOMPOSITION_MAX_STRING_LENGTH - 1)}…`;
}

async function toCompileScopeError(ctx: PipelineContext, error: DecompositionPlanningError): Promise<CompileScopeContextError> {
  return new CompileScopeContextError(await toDecompositionCompileScopeFailure(ctx, error));
}
