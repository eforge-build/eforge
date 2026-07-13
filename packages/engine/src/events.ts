// EforgeEvent discriminated union and all supporting types
//
// Wire-protocol types are defined in @eforge-build/client and re-exported
// here so engine code continues to import from './events.js' without changes.

export type {
  EforgeEvent,
  AgentRole,
  AgentResultData,
  EforgeResult,
  ClarificationQuestion,
  ReviewIssue,
  ValidationRepairClass,
  PlanFile,
  OrchestrationConfig,
  PlanState,
  EforgeState,
  PrdValidationGap,
  AcceptanceCriterionVerdict,
  AcceptanceCriteriaConflict,
  TestIssue,
  BuildFailureSummary,
  LandedCommit,
  PlanSummaryEntry,
  FailingPlanEntry,
  ReconciliationReport,
  EforgeStatus,
  QueueEvent,
  StalenessVerdict,
  RecoveryVerdict,
  ReviewPerspective,
  EvaluationIssueOutcome,
  AgentTerminalSubtype,
  ShardScope,
  PipelineComposition,
  StackProvider,
  LandingPublicationAction,
  TerminalFailureScope,
  TerminalFailureEnvelope,
  BuildResumeStartEvent,
  BuildResumeStateEvent,
  BuildResumeIneligibleEvent,
  BuildResumeArtifactSource,
  BuildResumeArtifactPlan,
  BuildResumeArtifactsEvent,
  BuildResumeCompleteEvent,
  BoundedDiagnosticOptions,
  BoundedValidationDiagnostic,
  CompileArtifactSummary,
  CompileContextGuardDiagnostics,
  CompileContextGuardLimits,
  CompileContextGuardMetadataSource,
  CompileRecoveryAction,
  CompileScopeContextFailure,
  CompileScopeContextFailureEvent,
  PlannerContextObservation,
  PlannerInspectionBudgetDiagnostics,
  PlannerInspectionIdentifiers,
  PlannerInspectionSourceBuildContext,
  PlannerInspectionSummary,
  PlannerInspectionSummaryEvent,
  DecompositionFailureEvidence,
  PlanningCoverageSummary,
  PlanningCriterionCoverage,
  PlanningDecompositionEventType,
  PlanningDecompositionStartEvent,
  PlanningDecompositionUnitQueuedEvent,
  PlanningDecompositionUnitRunningEvent,
  PlanningDecompositionUnitProgressEvent,
  PlanningDecompositionUnitCompletedEvent,
  PlanningDecompositionUnitSkippedEvent,
  PlanningDecompositionUnitFailedEvent,
  PlanningDecompositionScheduleEvent,
  PlanningDecompositionBudgetEvent,
  PlanningDecompositionCompactHandoffEvent,
  PlanningDecompositionSynthesisCompleteEvent,
  PlanningDecompositionLimits,
  PlanningDecompositionUnitStatus,
  PlanningDecompositionUnitSummary,
  PlanningObservedBudgetPressure,
  PlanningScheduleBlockedPair,
  PlanningScheduleDecision,
  PlanningSourceSliceSummary,
  PlanningSplitAttemptEvidence,
  PlanningUnitBudget,
  PlanningUnitConstraint,
  PlanningUnresolvedCriterion,
} from '@eforge-build/client';

export {
  SEVERITY_ORDER,
  isAlwaysYieldedAgentEvent,
  EforgeEventSchema,
  EvaluationIssueOutcomeSchema,
  TerminalFailureScopeSchema,
  TerminalFailureEnvelopeSchema,
  BuildResumeArtifactSourceSchema,
  BuildResumeArtifactPlanSchema,
  BuildResumeArtifactsEventSchema,
  BoundedDiagnosticOptionsSchema,
  BoundedValidationDiagnosticSchema,
  CompileArtifactSummarySchema,
  CompileContextGuardDiagnosticsSchema,
  CompileContextGuardLimitsSchema,
  CompileContextGuardMetadataSourceSchema,
  CompileRecoveryActionSchema,
  CompileScopeContextFailureSchema,
  DecompositionFailureEvidenceSchema,
  PlanningCoverageSummarySchema,
  PlanningCriterionCoverageSchema,
  PlanningDecompositionLimitsSchema,
  PlanningDecompositionUnitStatusSchema,
  PlanningDecompositionUnitSummarySchema,
  PlanningObservedBudgetPressureSchema,
  PlanningScheduleBlockedPairSchema,
  PlanningScheduleDecisionSchema,
  PlanningSourceSliceSummarySchema,
  PlanningSplitAttemptEvidenceSchema,
  PlanningUnitBudgetSchema,
  PlanningUnitConstraintSchema,
  PlanningUnresolvedCriterionSchema,
  PLANNING_DECOMPOSITION_EVENT_TYPES,
  PLANNING_DECOMPOSITION_MAX_BLOCKED_PAIRS,
  PLANNING_DECOMPOSITION_MAX_CRITERIA,
  PLANNING_DECOMPOSITION_MAX_DEPENDENCIES,
  PLANNING_DECOMPOSITION_MAX_LIST_ITEMS,
  PLANNING_DECOMPOSITION_MAX_SOURCE_SLICES,
  PLANNING_DECOMPOSITION_MAX_SPLIT_ATTEMPTS,
  PLANNING_DECOMPOSITION_MAX_STRING_LENGTH,
  PLANNING_DECOMPOSITION_MAX_UNITS,
  PLANNING_DECOMPOSITION_MAX_UNRESOLVED_CRITERIA,
  PlannerContextObservationSchema,
  PlannerInspectionBudgetDiagnosticsSchema,
  PlannerInspectionIdentifiersSchema,
  PlannerInspectionSourceBuildContextSchema,
  PlannerInspectionSummarySchema,
  MAX_PLANNER_INSPECTION_CAVEATS,
  MAX_PLANNER_INSPECTION_IMPLEMENTATION_AREAS,
  MAX_PLANNER_INSPECTION_IMPORTANT_FINDINGS,
  MAX_PLANNER_INSPECTION_OBSERVED_FACTS,
  MAX_PLANNER_INSPECTION_RELEVANT_FILES,
  MAX_PLANNER_INSPECTION_SOURCE_CONTEXT_LENGTH,
  MAX_PLANNER_INSPECTION_UNRESOLVED_QUESTIONS,
  MAX_COMPILE_RISK_LIST_ITEMS,
} from '@eforge-build/client';

// Engine-only types not part of the wire protocol:

import type { StackBaseContext } from './stacking/base-resolver.js';
import type { StackProviderAdapter } from './stacking/provider.js';

export interface CompileOptions {
  auto?: boolean;
  verbose?: boolean;
  name?: string;
  cwd?: string;
  abortController?: AbortController;
  /** Override the logical/landing base branch (written to orchestration.yaml and used for PR/merge). */
  baseBranchOverride?: string;
  /**
   * Override the git ref used ONLY for `createMergeWorktree()`. When trunk sync
   * selects a fetched commit SHA (remote-ahead case), pass it here rather than
   * via `baseBranchOverride` so the logical/landing base branch stays as the
   * trunk branch name in orchestration.yaml.
   */
  worktreeBaseRefOverride?: string;
  /** A stacked child requires its immutable worktree pin for all validation evidence. */
  stackedValidationPinRequired?: boolean;
}

export interface BuildOptions {
  auto?: boolean;
  verbose?: boolean;
  dryRun?: boolean;
  cleanup?: boolean;
  cwd?: string;
  abortController?: AbortController;
  prdFilePath?: string;
  /** Queued PRD id for stack artifact recording. */
  prdId?: string;
  /** Resolved stack context for queued stacked builds. */
  stackContext?: StackBaseContext;
  /** Instantiated stack provider adapter for git-spice submission (stacked builds only). */
  stackProvider?: StackProviderAdapter;
  /** Override the configured landing action for this build. */
  landingAction?: 'pr' | 'merge' | 'leave';
  /** Per-run PR auto-merge intent. Resolved against `landing.pr.autoMerge` policy. */
  landingAutoMerge?: boolean;
  /** Per-PRD post-merge validation commands supplied by queue metadata. */
  postMergeCommands?: string[];
}

export interface EnqueueOptions {
  name?: string;
  verbose?: boolean;
  auto?: boolean;
  abortController?: AbortController;
  /** Override profile name to persist in PRD frontmatter for per-build profile binding. */
  profile?: string;
  /** Producer-agnostic per-enqueue post-merge validation commands to persist with the queued PRD. */
  postMerge?: string[];
  /** Override the configured landing action for this enqueued build. */
  landingAction?: 'pr' | 'merge' | 'leave';
  /** Per-run PR auto-merge intent. Resolved against `landing.pr.autoMerge` policy. */
  landingAutoMerge?: boolean;
  /** Logical stack identifier to persist in PRD frontmatter. */
  stack_id?: string;
  /** Parent PRD id for this stack layer, if any. */
  stack_parent?: string;
  /** Stack provider override for this PRD. */
  stack_provider?: 'git-spice';
  /**
   * Explicit upstream queue item id. When provided, the enqueued PRD gains
   * `depends_on: [afterQueueId]` and placement is determined by upstream state.
   * Overrides dependency-detector output when set.
   */
  afterQueueId?: string;
}
