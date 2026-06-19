import { Type, type Static } from '@eforge-build/extension-sdk';
import {
  EforgePlanPlanningBacklogCurationNeedsInputSchema,
  EforgePlanPlanningBacklogCurationSkippedSchema,
  EforgePlanPlanningRequestedOutputSectionSchema,
  ExtensionAgentTaskIdSchema,
  ExtensionAgentTaskStatusSchema,
} from '@eforge-build/client';
import { BacklogStatusSchema, JsonValueSchema, RecommendationBlockedChainSchema, RecommendationDerivedStatusSchema, RecommendationItemRefSchema, RecommendationProfileSchema, RecommendationSummarySchema, BacklogRecommendationModelSchema } from './schema.js';

// --- eforge:region plan-01-scan-mode-plumbing ---
export const BACKLOG_CURATION_SCAN_MODES = ['delta', 'full-implementation-audit'] as const;
export const DEFAULT_BACKLOG_CURATION_SCAN_MODE = 'delta' as const;
export const BacklogCurationScanModeSchema = Type.Union(BACKLOG_CURATION_SCAN_MODES.map((value) => Type.Literal(value)) as [ReturnType<typeof Type.Literal>, ReturnType<typeof Type.Literal>]);

export function normalizeBacklogCurationScanMode(value: unknown): BacklogCurationScanMode {
  return value === 'full-implementation-audit' ? 'full-implementation-audit' : DEFAULT_BACKLOG_CURATION_SCAN_MODE;
}

export function backlogCurationScanModeLabel(scanMode: BacklogCurationScanMode): string {
  return scanMode === 'full-implementation-audit' ? 'Full implementation audit' : 'Delta';
}
// --- eforge:endregion plan-01-scan-mode-plumbing ---

export const AnalyzeAllBacklogInputSchema = Type.Object({
  scanMode: Type.Optional(BacklogCurationScanModeSchema),
}, { additionalProperties: false });

export const SourceFingerprintSchema = Type.String({ minLength: 64, maxLength: 64, pattern: '^[A-Fa-f0-9]{64}$' });

const AnalyzeAllBacklogWorkflowEntrySchema = Type.Object({
  taskId: ExtensionAgentTaskIdSchema,
  parentTaskId: Type.Optional(ExtensionAgentTaskIdSchema),
  originalRequest: Type.String(),
  derivedRequest: Type.String(),
  selection: Type.Object({
    itemIds: Type.Optional(Type.Array(Type.String())),
    epicId: Type.Optional(Type.String()),
    recommendationRef: Type.Optional(Type.String()),
  }, { additionalProperties: false }),
  requestedOutputSections: Type.Array(EforgePlanPlanningRequestedOutputSectionSchema),
  session: Type.Optional(Type.String()),
  planningType: Type.Optional(Type.String()),
  planningDepth: Type.Optional(Type.String()),
  includeRoadmap: Type.Optional(Type.Boolean()),
  // Mirrors PlanningTaskWorkflowEntry.purpose; analyze-all-backlog only ever
  // produces 'backlog-curation' entries, but the stored value is the generic
  // workflow entry type, so accept the full union it can statically carry.
  purpose: Type.Optional(Type.Union([Type.Literal('recommendation-refresh'), Type.Literal('backlog-curation')])),
  scanMode: Type.Optional(BacklogCurationScanModeSchema),
  sourceFingerprint: Type.Optional(SourceFingerprintSchema),
  appliedAt: Type.Optional(Type.String()),
  createdAt: Type.String(),
}, { additionalProperties: false });

export const AnalyzeAllBacklogTaskSummarySchema = Type.Object({
  taskId: ExtensionAgentTaskIdSchema,
  kind: Type.String(),
  status: ExtensionAgentTaskStatusSchema,
  createdAt: Type.String(),
  updatedAt: Type.String(),
  startedAt: Type.Optional(Type.String()),
  completedAt: Type.Optional(Type.String()),
  cancelledAt: Type.Optional(Type.String()),
  errorCode: Type.Optional(Type.String()),
  errorMessage: Type.Optional(Type.String()),
}, { additionalProperties: false });

export const AnalyzeAllBacklogOutputSchema = Type.Object({
  task: AnalyzeAllBacklogTaskSummarySchema,
  entry: AnalyzeAllBacklogWorkflowEntrySchema,
  sourceFingerprint: Type.Optional(SourceFingerprintSchema),
  reused: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });

// --- eforge:region recommendation-validation ---
export const RecommendationReferenceValidationIssueSchema = Type.Object({
  path: Type.String(),
  id: Type.String(),
  kind: Type.Union([Type.Literal('item'), Type.Literal('epic')]),
  reason: Type.Union([Type.Literal('unknown'), Type.Literal('closed'), Type.Literal('empty'), Type.Literal('wrong-lane')]),
  status: Type.Optional(BacklogStatusSchema),
  title: Type.Optional(Type.String()),
  message: Type.String(),
}, { additionalProperties: false });

export const RecommendationReferenceValidationResultSchema = Type.Object({
  valid: Type.Boolean(),
  issues: Type.Array(RecommendationReferenceValidationIssueSchema),
}, { additionalProperties: false });

export const RecommendationRepositionedTargetSchema = Type.Object({
  itemId: Type.String(),
  from: Type.String(),
  to: Type.String(),
}, { additionalProperties: false });

const BacklogCurationPreviewRecommendationGroupSchema = Type.Object({
  ref: Type.String(),
  title: Type.Optional(Type.String()),
  itemIds: Type.Array(Type.String()),
  epicIds: Type.Optional(Type.Array(Type.String())),
  safeToPlanTogether: Type.Optional(Type.Boolean()),
  rationale: Type.Optional(Type.String()),
  recommendedProfile: Type.Optional(RecommendationProfileSchema),
}, { additionalProperties: false });

const BacklogCurationPreviewRecommendationModelSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  updatedAt: Type.Optional(Type.String()),
  activeWork: Type.Array(RecommendationItemRefSchema),
  readyCandidates: Type.Array(RecommendationItemRefSchema),
  recommendedNextSequence: Type.Array(RecommendationItemRefSchema),
  safeParallelizableGroups: Type.Array(BacklogCurationPreviewRecommendationGroupSchema),
  blockedChains: Type.Array(RecommendationBlockedChainSchema),
  rationaleAndAssumptions: Type.Array(Type.String()),
}, { additionalProperties: false });

const BacklogCurationPreviewRecommendationSummarySchema = Type.Object({
  recommendedNextItemIds: Type.Array(Type.String()),
  safeParallelizableGroups: Type.Array(BacklogCurationPreviewRecommendationGroupSchema),
  blockedChainCount: Type.Number(),
  rationaleAndAssumptions: Type.Array(Type.String()),
}, { additionalProperties: false });

export const BacklogCurationRecommendationProjectionSchema = Type.Object({
  effectiveRecommendations: Type.Optional(BacklogCurationPreviewRecommendationModelSchema),
  recommendationSummary: Type.Optional(BacklogCurationPreviewRecommendationSummarySchema),
  removed: Type.Object({
    itemIds: Type.Array(Type.String()),
    epicIds: Type.Array(Type.String()),
  }, { additionalProperties: false }),
  repositioned: Type.Array(RecommendationRepositionedTargetSchema),
  validation: RecommendationReferenceValidationResultSchema,
}, { additionalProperties: false });

export const BacklogCurationPreviewValidationErrorSchema = Type.Object({
  path: Type.String(),
  message: Type.String(),
}, { additionalProperties: false });

export const BacklogCurationPreviewRecommendationFreshnessSchema = Type.Object({
  state: Type.Union([Type.Literal('missing'), Type.Literal('fresh'), Type.Literal('stale')]),
  reason: Type.String(),
  storedSourceFingerprint: Type.Optional(Type.String()),
  comparedSourceFingerprint: Type.String(),
  baselineTaskId: Type.Optional(Type.String()),
}, { additionalProperties: false });

const BacklogCurationGitDeltaCapsSchema = Type.Object({
  commitScanCount: Type.Optional(Type.Integer({ minimum: 0 })),
  changedPathCount: Type.Optional(Type.Integer({ minimum: 0 })),
  excerptCount: Type.Optional(Type.Integer({ minimum: 0 })),
  excerptBytes: Type.Optional(Type.Integer({ minimum: 0 })),
  prEnrichmentCount: Type.Optional(Type.Integer({ minimum: 0 })),
  subprocessTimeoutMs: Type.Optional(Type.Integer({ minimum: 0 })),
}, { additionalProperties: true });

export const BacklogCurationGitDeltaPreviewSchema = Type.Object({
  baseline: Type.Optional(Type.Union([Type.Object({}, { additionalProperties: JsonValueSchema }), Type.Null()])),
  currentHead: Type.Optional(Type.Union([Type.Object({}, { additionalProperties: JsonValueSchema }), Type.Null()])),
  coverage: Type.Optional(Type.Object({}, { additionalProperties: JsonValueSchema })),
  caps: Type.Optional(BacklogCurationGitDeltaCapsSchema),
  scannedCommitCount: Type.Optional(Type.Integer({ minimum: 0 })),
  scannedCommits: Type.Optional(Type.Array(Type.Object({}, { additionalProperties: JsonValueSchema }))),
  diagnostics: Type.Optional(Type.Array(Type.Object({
    code: Type.String(),
    severity: Type.Union([Type.Literal('info'), Type.Literal('warning')]),
    message: Type.Optional(Type.String()),
    commit: Type.Optional(Type.String()),
  }, { additionalProperties: true }))),
  affectedItemCandidates: Type.Optional(Type.Array(Type.Object({}, { additionalProperties: JsonValueSchema }))),
}, { additionalProperties: false });

export const BacklogCurationSourcePreviewMetadataSchema = Type.Object({
  sourceFingerprint: SourceFingerprintSchema,
  generatedAt: Type.Optional(Type.String()),
  scanMode: Type.Optional(BacklogCurationScanModeSchema),
  gitDelta: Type.Optional(BacklogCurationGitDeltaPreviewSchema),
}, { additionalProperties: false });

export const BacklogCurationPreviewDetailsSchema = Type.Object({
  valid: Type.Boolean(),
  scanMode: Type.Optional(BacklogCurationScanModeSchema),
  itemChanges: Type.Optional(Type.Integer({ minimum: 0 })),
  epicChanges: Type.Optional(Type.Integer({ minimum: 0 })),
  noOpRechecks: Type.Optional(Type.Integer({ minimum: 0 })),
  generatedRecommendationValidation: Type.Optional(RecommendationReferenceValidationResultSchema),
  recommendationFreshness: Type.Optional(BacklogCurationPreviewRecommendationFreshnessSchema),
  gitDelta: Type.Optional(BacklogCurationGitDeltaPreviewSchema),
  recommendationProjection: Type.Optional(BacklogCurationRecommendationProjectionSchema),
  errors: Type.Optional(Type.Array(BacklogCurationPreviewValidationErrorSchema)),
}, { additionalProperties: false });

export const BacklogCurationRecommendationsSkippedSchema = Type.Object({
  reason: Type.Union([Type.Literal('apply-curation-only'), Type.Literal('invalid-generated-recommendations')]),
  generatedRecommendationValidation: RecommendationReferenceValidationResultSchema,
}, { additionalProperties: false });
// --- eforge:endregion recommendation-validation ---

export const BacklogCurationApplyDetailsSchema = Type.Object({
  itemChanges: Type.Integer({ minimum: 0 }),
  epicChanges: Type.Integer({ minimum: 0 }),
  noOpRechecks: Type.Integer({ minimum: 0 }),
  skippedFreshRechecks: Type.Integer({ minimum: 0 }),
  changedItemIds: Type.Array(Type.String()),
  changedEpicIds: Type.Array(Type.String()),
  recheckedItemIds: Type.Array(Type.String()),
  recheckedEpicIds: Type.Array(Type.String()),
  skipped: Type.Array(EforgePlanPlanningBacklogCurationSkippedSchema),
  needsInput: Type.Array(EforgePlanPlanningBacklogCurationNeedsInputSchema),
  recommendations: Type.Optional(Type.Object({
    recommendations: BacklogRecommendationModelSchema,
    recommendationSummary: RecommendationSummarySchema,
    path: Type.String(),
    status: RecommendationDerivedStatusSchema,
  }, { additionalProperties: false })),
  recommendationStatus: Type.Optional(RecommendationDerivedStatusSchema),
  // --- eforge:region recommendation-validation ---
  generatedRecommendationValidation: Type.Optional(RecommendationReferenceValidationResultSchema),
  recommendationsSkipped: Type.Optional(BacklogCurationRecommendationsSkippedSchema),
  recommendationProjection: Type.Optional(BacklogCurationRecommendationProjectionSchema),
  // --- eforge:endregion recommendation-validation ---
}, { additionalProperties: false });

export type BacklogCurationScanMode = Static<typeof BacklogCurationScanModeSchema>;
export type AnalyzeAllBacklogInput = Static<typeof AnalyzeAllBacklogInputSchema>;
export type AnalyzeAllBacklogOutput = Static<typeof AnalyzeAllBacklogOutputSchema>;
export type AnalyzeAllBacklogTaskSummary = Static<typeof AnalyzeAllBacklogTaskSummarySchema>;
export type RecommendationReferenceValidationIssue = Static<typeof RecommendationReferenceValidationIssueSchema>;
export type RecommendationReferenceValidationResult = Static<typeof RecommendationReferenceValidationResultSchema>;
export type RecommendationRepositionedTarget = Static<typeof RecommendationRepositionedTargetSchema>;
export type BacklogCurationRecommendationProjection = Static<typeof BacklogCurationRecommendationProjectionSchema>;
export type BacklogCurationGitDeltaPreview = Static<typeof BacklogCurationGitDeltaPreviewSchema>;
export type BacklogCurationSourcePreviewMetadata = Static<typeof BacklogCurationSourcePreviewMetadataSchema>;
export type BacklogCurationPreviewDetails = Static<typeof BacklogCurationPreviewDetailsSchema>;
export type BacklogCurationRecommendationsSkipped = Static<typeof BacklogCurationRecommendationsSkippedSchema>;
export type BacklogCurationApplyDetails = Static<typeof BacklogCurationApplyDetailsSchema>;
