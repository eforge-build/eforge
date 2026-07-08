/**
 * Public API for the run-state subsystem.
 *
 * Pure subsystem — no React, no DOM, no fetch dependencies.
 * Depends only on @eforge-build/client for EforgeEvent types.
 *
 * Console-owned reducer, handlers, selectors, and formatting helpers.
 */

// Core reducer
export { eforgeReducer, createInitialRunState, initialRunState, selectAutoBuild, isMapReduceRun, reduce } from './reducer';
export type { RunAction } from './reducer';

// Types
export type {
  RunState,
  SamePlanRecoveryState,
  AgentThread,
  AgentActivityFacts,
  Decision,
  DecisionPoint,
  PipelineStage,
  StoredEvent,
  SessionProfile,
  MapReduceOrchestration,
  MapReduceAtomNode,
  MapReduceReduceNode,
  PlanningMapReduceAtomReason,
  PlanningMapReduceAtomStatus,
  PlanningMapReduceReduceStatus,
  ValidationCommandSpan,
  ValidationCommandStatus,
  // Re-exported client types (so pipeline/timeline components can import from @/lib/run-state)
  EforgeEvent,
  AgentRole,
  BuildStageSpec,
  OrchestrationConfig,
  ReviewIssue,
  BuildDecision,
  PlanningDecision,
  ReviewProfileConfig,
} from './types';

// Selectors
export { getSummaryStats } from './selectors/summary-stats';
export { selectRunEfficiencyMetrics } from './selectors/efficiency';
export type { EfficiencyAvailability, EfficiencyMetric, EfficiencySampleCounts, RunEfficiencyMetrics } from './selectors/efficiency';
export {
  selectPlanStatusCounts,
  selectCurrentStageForPlan,
  selectMiniGanttRows,
  selectPlanLanes,
  selectPlanningLane,
} from './selectors/plan-progress';
export type {
  PlanStatusCounts,
  MiniGanttRow,
  PlanLane,
  PlanLaneAgent,
  PlanningLane,
} from './selectors/plan-progress';
export { selectStackLayersForRun } from './selectors/stack-layers';
export { buildMapReduceSummary, buildMapReduceTimeline, MAP_ATOMS_LANE_ID, reduceLaneId } from './selectors/map-reduce';
export type {
  MapReduceSummary,
  MapReduceAtomCounts,
  MapReduceReduceCounts,
  MapReduceTimelineModel,
  MapReduceTimelineLane,
  MapReduceThreadDisplay,
} from './selectors/map-reduce';

// Lane registry
export { LANE_REGISTRY, laneLabel, laneOrder, isRegisteredPhaseLane, isFeatureBranchLane } from './lane-registry';
export type { LaneEntry } from './lane-registry';
