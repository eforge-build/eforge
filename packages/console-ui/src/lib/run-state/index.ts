/**
 * Public API for the run-state subsystem.
 *
 * Pure subsystem — no React, no DOM, no fetch dependencies.
 * Depends only on @eforge-build/client for EforgeEvent types.
 *
 * Dual-reducer constraint: this subsystem is a port of
 * packages/monitor-ui/src/lib/reducer.ts (and associated handlers).
 * Both must be kept in sync until monitor-ui is deleted.
 */

// Core reducer
export { eforgeReducer, createInitialRunState, initialRunState, selectAutoBuild, reduce } from './reducer';
export type { RunAction } from './reducer';

// Types
export type {
  RunState,
  AgentThread,
  AgentActivityFacts,
  Decision,
  DecisionPoint,
  PipelineStage,
  ModuleStatus,
  StoredEvent,
  SessionProfile,
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
export {
  selectPlanStatusCounts,
  selectCurrentStageForPlan,
  selectMiniGanttRows,
} from './selectors/plan-progress';
export type { PlanStatusCounts, MiniGanttRow } from './selectors/plan-progress';
export { selectStackLayersForRun } from './selectors/stack-layers';
