import { Type, type Static } from '@sinclair/typebox';
import { EventEnvelopeSchema } from './envelope.js';
import { EforgeEventVariantsSchema } from './variants.js';
import {
  CompileArtifactSummarySchema,
  CompileContextGuardDiagnosticsSchema,
  CompileContextGuardLimitsSchema,
  CompileContextGuardMetadataSourceSchema,
  CompileRecoveryActionSchema,
  CompileScopeContextFailureSchema,
  PlannerContextObservationSchema,
  PlannerInspectionBudgetDiagnosticsSchema,
  PlannerInspectionIdentifiersSchema,
  PlannerInspectionSourceBuildContextSchema,
  PlannerInspectionSummarySchema,
  BoundedDiagnosticOptionsSchema,
  BoundedValidationDiagnosticSchema,
  type CompileScopeContextFailure as SharedCompileScopeContextFailure,
} from './shared/compile-resilience.js';
import {
  DecompositionFailureEvidenceSchema,
  PlanningCoverageSummarySchema,
  PlanningDecompositionLimitsSchema,
  PlanningDecompositionUnitStatusSchema,
  PlanningDecompositionUnitSummarySchema,
  PlanningObservedBudgetPressureSchema,
  PlanningScheduleDecisionSchema,
  PlanningSourceSliceSummarySchema,
  PlanningUnitBudgetSchema,
} from './shared/planning-decomposition.js';
import {
  AcceptanceCriteriaConflictSchema,
  AcceptanceCriterionVerdictSchema,
  AgentResultDataSchema,
  AgentRoleSchema,
  AgentTerminalSubtypeSchema,
  AutoBuildDesiredSchema,
  AutoBuildRuntimeModeSchema,
  AutoBuildSchedulerStateSchema,
  AutoBuildTransitionDetailSchema,
  BuildFailureSummarySchema,
  BuildResumeArtifactPlanSchema,
  BuildResumeArtifactSourceSchema,
  ClarificationQuestionSchema,
  EforgeResultSchema,
  EforgeStateSchema,
  EvaluationIssueOutcomeSchema,
  FailingPlanEntrySchema,
  LandingActionSchema,
  LandingPublicationActionSchema,
  LandedCommitSchema,
  OrchestrationConfigSchema,
  PipelineCompositionSchema,
  PlanFileSchema,
  PlanStateSchema,
  PlanSummaryEntrySchema,
  PrdValidationGapSchema,
  ReconciliationReportSchema,
  RecoveryVerdictSchema,
  ReviewFixIssueReferenceSchema,
  ReviewFixIssueStatusSchema,
  ReviewIssueIdSchema,
  ReviewIssueSchema,
  ReviewPerspectiveSchema,
  ShardScopeSchema,
  StackArtifactRefSchema,
  StackLayerStatusSchema,
  StackLayerWireSchema,
  StackProviderConflictKindSchema,
  StackProviderOperationKindSchema,
  StackProviderSchema,
  StalenessVerdictSchema,
  TerminalFailureEnvelopeSchema,
  TerminalFailureScopeSchema,
  TestIssueSchema,
  ValidationRepairClassSchema,
  EforgeStatusSchema,
} from './shared/schemas.js';

export const EforgeEventSchema = Type.Intersect([EventEnvelopeSchema, EforgeEventVariantsSchema]);

export type EforgeEvent = Static<typeof EforgeEventSchema>;
export type DaemonRunUpsertEvent = Extract<EforgeEvent, { type: 'daemon:run:upsert' }>;
export type AgentRole = Static<typeof AgentRoleSchema>;
export type AgentTerminalSubtype = Static<typeof AgentTerminalSubtypeSchema>;
export type ReviewPerspective = Static<typeof ReviewPerspectiveSchema>;
export type EvaluationIssueOutcome = Static<typeof EvaluationIssueOutcomeSchema>;
/** A dynamic review perspective key: bounded lowercase slug, built-ins included. */
export type ReviewPerspectiveKey = string;
export type StalenessVerdict = Static<typeof StalenessVerdictSchema>;
export type RecoveryVerdict = Static<typeof RecoveryVerdictSchema>;
export type ShardScope = Static<typeof ShardScopeSchema>;
export type PipelineComposition = Static<typeof PipelineCompositionSchema>;
export type PrdValidationGap = Static<typeof PrdValidationGapSchema>;
export type AcceptanceCriterionVerdict = Static<typeof AcceptanceCriterionVerdictSchema>;
export type AcceptanceCriteriaConflict = Static<typeof AcceptanceCriteriaConflictSchema>;
export type EforgeResult = Static<typeof EforgeResultSchema>;
export type ClarificationQuestion = Static<typeof ClarificationQuestionSchema>;
export type ValidationRepairClass = Static<typeof ValidationRepairClassSchema>;
// --- eforge:region review-issue-traceability ---
export type ReviewIssueId = Static<typeof ReviewIssueIdSchema>;
export type ReviewFixIssueStatus = Static<typeof ReviewFixIssueStatusSchema>;
export type ReviewFixIssueReference = Static<typeof ReviewFixIssueReferenceSchema>;
// --- eforge:endregion review-issue-traceability ---
export type ReviewIssue = Static<typeof ReviewIssueSchema>;
export type TestIssue = Static<typeof TestIssueSchema>;
export type PlanFile = Static<typeof PlanFileSchema>;
export type OrchestrationConfig = Static<typeof OrchestrationConfigSchema>;
export type PlanState = Static<typeof PlanStateSchema>;
export type EforgeState = Static<typeof EforgeStateSchema>;
export type AgentResultData = Static<typeof AgentResultDataSchema>;
export type ReconciliationReport = Static<typeof ReconciliationReportSchema>;
export type EforgeStatus = Static<typeof EforgeStatusSchema>;
export type LandedCommit = Static<typeof LandedCommitSchema>;
export type PlanSummaryEntry = Static<typeof PlanSummaryEntrySchema>;
export type FailingPlanEntry = Static<typeof FailingPlanEntrySchema>;
export type BuildFailureSummary = Static<typeof BuildFailureSummarySchema>;
export type TerminalFailureScope = Static<typeof TerminalFailureScopeSchema>;
export type TerminalFailureEnvelope = Static<typeof TerminalFailureEnvelopeSchema>;
export type BuildResumeStartEvent = Extract<EforgeEvent, { type: 'build:resume:start' }>;
export type BuildResumeStateEvent = Extract<EforgeEvent, { type: 'build:resume:state' }>;
export type BuildResumeIneligibleEvent = Extract<EforgeEvent, { type: 'build:resume:ineligible' }>;
export type BuildResumeArtifactSource = Static<typeof BuildResumeArtifactSourceSchema>;
export type BuildResumeArtifactPlan = Static<typeof BuildResumeArtifactPlanSchema>;
export type BuildResumeArtifactsEvent = Extract<EforgeEvent, { type: 'build:resume:artifacts' }>;
export type BuildResumeCompleteEvent = Extract<EforgeEvent, { type: 'build:resume:complete' }>;
export type CompileRecoveryAction = Static<typeof CompileRecoveryActionSchema>;
export type CompileArtifactSummary = Static<typeof CompileArtifactSummarySchema>;
export type CompileContextGuardLimits = Static<typeof CompileContextGuardLimitsSchema>;
export type CompileContextGuardMetadataSource = Static<typeof CompileContextGuardMetadataSourceSchema>;
export type CompileContextGuardDiagnostics = Static<typeof CompileContextGuardDiagnosticsSchema>;
export type CompileScopeContextFailure = SharedCompileScopeContextFailure;
export type PlannerContextObservation = Static<typeof PlannerContextObservationSchema>;
export type PlannerInspectionIdentifiers = Static<typeof PlannerInspectionIdentifiersSchema>;
export type PlannerInspectionSourceBuildContext = Static<typeof PlannerInspectionSourceBuildContextSchema>;
export type PlannerInspectionBudgetDiagnostics = Static<typeof PlannerInspectionBudgetDiagnosticsSchema>;
export type PlannerInspectionSummary = Static<typeof PlannerInspectionSummarySchema>;
export type BoundedDiagnosticOptions = Static<typeof BoundedDiagnosticOptionsSchema>;
export type BoundedValidationDiagnostic = Static<typeof BoundedValidationDiagnosticSchema>;
export type PlanningDecompositionUnitStatus = Static<typeof PlanningDecompositionUnitStatusSchema>;
export type PlanningDecompositionLimits = Static<typeof PlanningDecompositionLimitsSchema>;
export type PlanningUnitBudget = Static<typeof PlanningUnitBudgetSchema>;
export type PlanningObservedBudgetPressure = Static<typeof PlanningObservedBudgetPressureSchema>;
export type PlanningSourceSliceSummary = Static<typeof PlanningSourceSliceSummarySchema>;
export type PlanningCoverageSummary = Static<typeof PlanningCoverageSummarySchema>;
export type PlanningDecompositionUnitSummary = Static<typeof PlanningDecompositionUnitSummarySchema>;
export type PlanningScheduleDecision = Static<typeof PlanningScheduleDecisionSchema>;
export type DecompositionFailureEvidence = Static<typeof DecompositionFailureEvidenceSchema>;
export type CompileScopeContextFailureEvent = Extract<EforgeEvent, { type: 'planning:scope-context:failure' }>;
export type PlannerInspectionSummaryEvent = Extract<EforgeEvent, { type: 'planning:inspection-summary' }>;
export type PlanningDecompositionStartEvent = Extract<EforgeEvent, { type: 'planning:decomposition:start' }>;
export type PlanningDecompositionUnitQueuedEvent = Extract<EforgeEvent, { type: 'planning:decomposition:unit:queued' }>;
export type PlanningDecompositionUnitRunningEvent = Extract<EforgeEvent, { type: 'planning:decomposition:unit:running' }>;
export type PlanningDecompositionUnitProgressEvent = Extract<EforgeEvent, { type: 'planning:decomposition:unit:progress' }>;
export type PlanningDecompositionUnitCompletedEvent = Extract<EforgeEvent, { type: 'planning:decomposition:unit:completed' }>;
export type PlanningDecompositionUnitSkippedEvent = Extract<EforgeEvent, { type: 'planning:decomposition:unit:skipped' }>;
export type PlanningDecompositionUnitFailedEvent = Extract<EforgeEvent, { type: 'planning:decomposition:unit:failed' }>;
export type PlanningDecompositionScheduleEvent = Extract<EforgeEvent, { type: 'planning:decomposition:schedule' }>;
export type PlanningDecompositionBudgetEvent = Extract<EforgeEvent, { type: 'planning:decomposition:budget' }>;
export type PlanningDecompositionCompactHandoffEvent = Extract<EforgeEvent, { type: 'planning:decomposition:compact-handoff' }>;
export type PlanningDecompositionSynthesisCompleteEvent = Extract<EforgeEvent, { type: 'planning:decomposition:synthesis:complete' }>;
export type AutoBuildDesired = Static<typeof AutoBuildDesiredSchema>;
export type AutoBuildRuntimeMode = Static<typeof AutoBuildRuntimeModeSchema>;
export type AutoBuildSchedulerState = Static<typeof AutoBuildSchedulerStateSchema>;
export type AutoBuildTransitionDetail = Static<typeof AutoBuildTransitionDetailSchema>;
export type LandingAction = Static<typeof LandingActionSchema>;
export type StackProvider = Static<typeof StackProviderSchema>;
export type StackProviderOperationKind = Static<typeof StackProviderOperationKindSchema>;
export type StackProviderConflictKind = Static<typeof StackProviderConflictKindSchema>;
export type LandingPublicationAction = Static<typeof LandingPublicationActionSchema>;
export type StackLayerStatus = Static<typeof StackLayerStatusSchema>;
export type StackArtifactRef = Static<typeof StackArtifactRefSchema>;
export type StackLayerWire = Static<typeof StackLayerWireSchema>;
