import { PLANNING_DECOMPOSITION_MAX_LIST_ITEMS, capPlanningDecompositionString, projectPlanningCoverageSummaryForWire, projectPlanningDecompositionUnitSummaryForWire } from '@eforge-build/client';
import type { EforgeEvent, PlanningDecompositionRiskEvidence, PlanningDecompositionUnitSummary, PlanningScheduleDecision } from '../../events.js';
import type { PlanningDecompositionGraph, PlanningDecompositionUnit } from '../planning-decomposition.js';

export function decompositionStartEvent(input: { graph: PlanningDecompositionGraph; runId?: string; riskEvidence?: PlanningDecompositionRiskEvidence }): EforgeEvent {
  return {
    timestamp: now(),
    type: 'planning:decomposition:start',
    graphId: input.graph.graphId,
    rootUnitId: input.graph.rootUnitId,
    unitCount: input.graph.units.length,
    edgeCount: input.graph.edges.length,
    limits: input.graph.limits,
    ...(input.riskEvidence ? { riskEvidence: input.riskEvidence } : {}),
    ...(input.runId ? { runId: input.runId } : {}),
  } as EforgeEvent;
}

export function unitQueuedEvent(unit: PlanningDecompositionUnit): EforgeEvent {
  return { timestamp: now(), type: 'planning:decomposition:unit:queued', unit: unitSummary(unit) } as EforgeEvent;
}

export function unitSkippedEvent(unit: PlanningDecompositionUnit, reason: string): EforgeEvent {
  return { timestamp: now(), type: 'planning:decomposition:unit:skipped', unitId: unit.unitId, reason } as EforgeEvent;
}

export function scheduleEvent(decision: PlanningScheduleDecision): EforgeEvent {
  return { timestamp: now(), type: 'planning:decomposition:schedule', decision } as EforgeEvent;
}

export function synthesisCompleteEvent(input: { graph: PlanningDecompositionGraph; artifactPaths: string[] }): EforgeEvent {
  return {
    timestamp: now(),
    type: 'planning:decomposition:synthesis:complete',
    unitCount: input.graph.units.length,
    completedUnitCount: input.graph.units.filter(unit => unit.status === 'completed').length,
    failedUnitCount: input.graph.units.filter(unit => unit.status === 'failed').length,
    skippedUnitCount: input.graph.units.filter(unit => unit.status === 'skipped').length,
    coverage: projectPlanningCoverageSummaryForWire(input.graph.coverage),
    artifactPaths: input.artifactPaths.slice(0, PLANNING_DECOMPOSITION_MAX_LIST_ITEMS).map(path => capPlanningDecompositionString(path)),
  } as EforgeEvent;
}

export function unitSummary(unit: PlanningDecompositionUnit): PlanningDecompositionUnitSummary {
  return projectPlanningDecompositionUnitSummaryForWire({
    unitId: unit.unitId,
    parentUnitId: unit.parentId,
    depth: unit.depth,
    sourceSlices: unit.sourceSlices,
    coverage: {
      totalCriteria: unit.criteriaIds.length,
      coveredCriteria: unit.criteriaIds.map(criterionId => ({ criterionId, sourceHash: unit.sourceSlices[0]?.sourceHash, coveredByUnitIds: [unit.unitId] })),
      unresolvedCriteria: [],
    },
    subsystemHints: unit.subsystemHints,
    dependencies: unit.dependsOn,
    interfaceConstraints: unit.interfaceConstraints.map(description => ({ description })),
    sharedFileConstraints: unit.sharedFileConstraints.map(description => ({ description })),
    budgets: unit.budgets,
    status: unit.status,
  });
}

function now(): string { return new Date().toISOString(); }
