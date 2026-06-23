import { Type, type Static } from '@eforge-build/extension-sdk';
import {
  EforgePlanPlanningBacklogCurationNeedsInputSchema,
  EforgePlanPlanningBacklogCurationSkippedSchema,
  EforgePlanPlanningRequestedOutputSectionSchema,
  ExtensionAgentTaskIdSchema,
  ExtensionAgentTaskStatusSchema,
  // --- eforge:region plan-01-curation-packets-cache ---
  BacklogCurationMapReduceCapDiagnosticSchema,
  BacklogCurationMapReduceDiagnosticSchema,
  BacklogCurationMapReduceSourceBundleSchema,
  // --- eforge:endregion plan-01-curation-packets-cache ---
} from '@eforge-build/client';
import { BacklogStatusSchema, JsonValueSchema, RecommendationBlockedChainSchema, RecommendationDerivedStatusSchema, RecommendationItemRefSchema, RecommendationProfileSchema, RecommendationSummarySchema, BacklogRecommendationModelSchema } from './schema.js';

export const DEFAULT_ITEM_AUDIT_CONCURRENCY = 4;
export const MAX_ITEM_AUDIT_CONCURRENCY = 8;
export const ItemAuditConcurrencySchema = Type.Integer({ minimum: 1, maximum: MAX_ITEM_AUDIT_CONCURRENCY, default: DEFAULT_ITEM_AUDIT_CONCURRENCY });

export const AnalyzeAllBacklogInputSchema = Type.Object({
  itemAuditConcurrency: Type.Optional(ItemAuditConcurrencySchema),
}, { additionalProperties: false });

export const SourceFingerprintSchema = Type.String({ minLength: 64, maxLength: 64, pattern: '^[A-Fa-f0-9]{64}$' });

// --- eforge:region plan-01-curation-packets-cache ---
export const BacklogCurationProviderMapReduceBundleSchema = BacklogCurationMapReduceSourceBundleSchema;
export const BacklogCurationProviderDiagnosticSchema = BacklogCurationMapReduceDiagnosticSchema;
export const BacklogCurationProviderCapDiagnosticSchema = BacklogCurationMapReduceCapDiagnosticSchema;
// --- eforge:endregion plan-01-curation-packets-cache ---

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
  itemAuditConcurrency: Type.Optional(ItemAuditConcurrencySchema),
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

const BacklogCurationFullImplementationAuditDiagnosticSchema = Type.Object({
  code: Type.String(),
  severity: Type.Union([Type.Literal('info'), Type.Literal('warning')]),
  message: Type.Optional(Type.String()),
  path: Type.Optional(Type.String()),
}, { additionalProperties: true });

const BacklogCurationFullImplementationAuditCapsSchema = Type.Object({
  fileScanCount: Type.Optional(Type.Integer({ minimum: 0 })),
  fileBytes: Type.Optional(Type.Integer({ minimum: 0 })),
  evidencePerItem: Type.Optional(Type.Integer({ minimum: 0 })),
  pathsPerCategory: Type.Optional(Type.Integer({ minimum: 0 })),
  excerptBytes: Type.Optional(Type.Integer({ minimum: 0 })),
  diagnosticCount: Type.Optional(Type.Integer({ minimum: 0 })),
  gitCommitScanCount: Type.Optional(Type.Integer({ minimum: 0 })),
  prEnrichmentCount: Type.Optional(Type.Integer({ minimum: 0 })),
}, { additionalProperties: true });

const BacklogCurationFullImplementationAuditCoverageSchema = Type.Object({
  auditedItemCount: Type.Integer({ minimum: 0 }),
  currentStateFileCount: Type.Optional(Type.Integer({ minimum: 0 })),
  gitHistoryCommitCount: Type.Optional(Type.Integer({ minimum: 0 })),
  pullRequestCount: Type.Optional(Type.Integer({ minimum: 0 })),
}, { additionalProperties: true });

const BacklogCurationFullImplementationAuditEvidenceSummarySchema = Type.Object({
  source: Type.String({ minLength: 1 }),
  confidence: Type.String({ minLength: 1 }),
  matchedBy: Type.Optional(Type.Array(Type.String())),
  path: Type.Optional(Type.String()),
  excerpt: Type.Optional(Type.String()),
  citations: Type.Optional(Type.Array(Type.Object({}, { additionalProperties: JsonValueSchema }))),
}, { additionalProperties: true });

const SourceFirstAuditCitationSchema = Type.Object({
  kind: Type.Union([Type.Literal('implementation'), Type.Literal('product-surface'), Type.Literal('supporting')]),
  source: Type.String(),
  confidence: Type.String(),
  path: Type.Optional(Type.String()),
  excerpt: Type.Optional(Type.String()),
  matchedBy: Type.Optional(Type.Array(Type.String())),
}, { additionalProperties: true });

const SourceFirstHistoricalHintSchema = Type.Object({
  source: Type.String(),
  closureAuthority: Type.Literal(false),
  intent: Type.Optional(Type.String()),
  confidence: Type.Optional(Type.String()),
  citation: Type.Optional(Type.String()),
  evidence: Type.Optional(Type.String()),
  path: Type.Optional(Type.String()),
}, { additionalProperties: true });

const SourceFirstAuditDiagnosticSchema = Type.Object({
  code: Type.String(),
  severity: Type.Union([Type.Literal('info'), Type.Literal('warning')]),
  message: Type.Optional(Type.String()),
  path: Type.Optional(Type.String()),
}, { additionalProperties: true });

const SourceFirstAuditResultSchema = Type.Object({
  itemId: Type.String(),
  intent: Type.Union([Type.Literal('source-shipped'), Type.Literal('source-superseded'), Type.Literal('partial'), Type.Literal('not-found'), Type.Literal('no-change'), Type.Literal('skipped'), Type.Literal('recheck-note')]),
  confidence: Type.String(),
  citations: Type.Array(SourceFirstAuditCitationSchema),
  historicalHints: Type.Array(SourceFirstHistoricalHintSchema),
  diagnostics: Type.Array(SourceFirstAuditDiagnosticSchema),
  rationale: Type.String(),
}, { additionalProperties: true });

const BacklogCurationFullImplementationAuditItemSummarySchema = Type.Object({
  itemId: Type.String(),
  candidateIntent: Type.String(),
  evidenceCount: Type.Optional(Type.Integer({ minimum: 0 })),
  confidence: Type.Optional(Type.String()),
  evidence: Type.Optional(Type.Array(BacklogCurationFullImplementationAuditEvidenceSummarySchema)),
  closureCandidates: Type.Optional(Type.Array(BacklogCurationFullImplementationAuditEvidenceSummarySchema)),
  sourceFirstResult: Type.Optional(SourceFirstAuditResultSchema),
}, { additionalProperties: true });

export const BacklogCurationFullImplementationAuditPreviewSchema = Type.Object({
  scope: Type.Optional(Type.Object({
    itemIds: Type.Array(Type.String()),
    openItemCount: Type.Optional(Type.Integer({ minimum: 0 })),
  }, { additionalProperties: true })),
  coverage: Type.Optional(BacklogCurationFullImplementationAuditCoverageSchema),
  caps: Type.Optional(BacklogCurationFullImplementationAuditCapsSchema),
  settings: Type.Optional(Type.Object({ itemAuditConcurrency: ItemAuditConcurrencySchema, maxItemAuditConcurrency: Type.Integer({ minimum: 1 }), closureAuthority: Type.String() }, { additionalProperties: true })),
  diagnostics: Type.Optional(Type.Array(BacklogCurationFullImplementationAuditDiagnosticSchema)),
  sourceFirstResults: Type.Optional(Type.Array(SourceFirstAuditResultSchema)),
  historicalHints: Type.Optional(Type.Array(SourceFirstHistoricalHintSchema)),
  closureCandidates: Type.Optional(Type.Array(BacklogCurationFullImplementationAuditEvidenceSummarySchema)),
  itemSummaries: Type.Optional(Type.Array(BacklogCurationFullImplementationAuditItemSummarySchema)),
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
  itemAuditConcurrency: Type.Optional(ItemAuditConcurrencySchema),
  gitDelta: Type.Optional(BacklogCurationGitDeltaPreviewSchema),
  fullImplementationAudit: Type.Optional(BacklogCurationFullImplementationAuditPreviewSchema),
}, { additionalProperties: false });

export const BacklogCurationPreviewDetailsSchema = Type.Object({
  valid: Type.Boolean(),
  itemChanges: Type.Optional(Type.Integer({ minimum: 0 })),
  epicChanges: Type.Optional(Type.Integer({ minimum: 0 })),
  noOpRechecks: Type.Optional(Type.Integer({ minimum: 0 })),
  generatedRecommendationValidation: Type.Optional(RecommendationReferenceValidationResultSchema),
  recommendationFreshness: Type.Optional(BacklogCurationPreviewRecommendationFreshnessSchema),
  gitDelta: Type.Optional(BacklogCurationGitDeltaPreviewSchema),
  fullImplementationAudit: Type.Optional(BacklogCurationFullImplementationAuditPreviewSchema),
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

export type AnalyzeAllBacklogInput = Static<typeof AnalyzeAllBacklogInputSchema>;
export type AnalyzeAllBacklogOutput = Static<typeof AnalyzeAllBacklogOutputSchema>;
export type AnalyzeAllBacklogTaskSummary = Static<typeof AnalyzeAllBacklogTaskSummarySchema>;
export type RecommendationReferenceValidationIssue = Static<typeof RecommendationReferenceValidationIssueSchema>;
export type RecommendationReferenceValidationResult = Static<typeof RecommendationReferenceValidationResultSchema>;
export type RecommendationRepositionedTarget = Static<typeof RecommendationRepositionedTargetSchema>;
export type BacklogCurationRecommendationProjection = Static<typeof BacklogCurationRecommendationProjectionSchema>;
export type BacklogCurationGitDeltaPreview = Static<typeof BacklogCurationGitDeltaPreviewSchema>;
export type BacklogCurationFullImplementationAuditPreview = Static<typeof BacklogCurationFullImplementationAuditPreviewSchema>;
export type BacklogCurationSourcePreviewMetadata = Static<typeof BacklogCurationSourcePreviewMetadataSchema>;
export type BacklogCurationPreviewDetails = Static<typeof BacklogCurationPreviewDetailsSchema>;
export type BacklogCurationRecommendationsSkipped = Static<typeof BacklogCurationRecommendationsSkippedSchema>;
export type BacklogCurationApplyDetails = Static<typeof BacklogCurationApplyDetailsSchema>;
