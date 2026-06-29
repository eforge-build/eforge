import { FormatRegistry, Type, type Static } from '@sinclair/typebox';
import { DecompositionFailureEvidenceSchema } from './planning-decomposition.js';

export const MAX_COMPILE_RISK_LIST_ITEMS = 12;
export const MAX_COMPILE_SCOPE_CONTEXT_EXPLANATION_LENGTH = 2000;
export const MAX_VALIDATION_DIAGNOSTIC_EXCERPT_LENGTH = 4096;
export const MAX_VALIDATION_DIAGNOSTIC_MESSAGE_LENGTH = 4096;
export const MAX_PLANNER_INSPECTION_RELEVANT_FILES = 40;
export const MAX_PLANNER_INSPECTION_OBSERVED_FACTS = 16;
export const MAX_PLANNER_INSPECTION_IMPORTANT_FINDINGS = 12;
export const MAX_PLANNER_INSPECTION_IMPLEMENTATION_AREAS = 16;
export const MAX_PLANNER_INSPECTION_UNRESOLVED_QUESTIONS = 8;
export const MAX_PLANNER_INSPECTION_CAVEATS = 8;
export const MAX_PLANNER_INSPECTION_SOURCE_CONTEXT_LENGTH = 3000;

const VALIDATION_DIAGNOSTIC_EXCERPT_FORMAT = 'eforge-validation-diagnostic-excerpt-bytes';
const VALIDATION_DIAGNOSTIC_MESSAGE_FORMAT = 'eforge-validation-diagnostic-message-bytes';

FormatRegistry.Set(VALIDATION_DIAGNOSTIC_EXCERPT_FORMAT, (value) => utf8ByteLength(value) <= MAX_VALIDATION_DIAGNOSTIC_EXCERPT_LENGTH);
FormatRegistry.Set(VALIDATION_DIAGNOSTIC_MESSAGE_FORMAT, (value) => utf8ByteLength(value) <= MAX_VALIDATION_DIAGNOSTIC_MESSAGE_LENGTH);

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

const BoundedStringSchema = Type.String({ maxLength: MAX_COMPILE_SCOPE_CONTEXT_EXPLANATION_LENGTH });
const BoundedStringListSchema = Type.Array(BoundedStringSchema, { maxItems: MAX_COMPILE_RISK_LIST_ITEMS });
const NonNegativeIntegerSchema = Type.Integer({ minimum: 0 });
const PositiveIntegerSchema = Type.Integer({ minimum: 1 });
const Sha256HexSchema = Type.String({ pattern: '^[a-f0-9]{64}$' });

export const PlannerInspectionSummaryTextSchema = BoundedStringSchema;
export const PlannerInspectionSourceContextTextSchema = Type.String({ maxLength: MAX_PLANNER_INSPECTION_SOURCE_CONTEXT_LENGTH });
export const PlannerContextObservationSchema = Type.Object({
  inputTokens: NonNegativeIntegerSchema,
  outputTokens: NonNegativeIntegerSchema,
  turns: NonNegativeIntegerSchema,
  promptBytes: NonNegativeIntegerSchema,
});
export const PlannerInspectionIdentifiersSchema = Type.Object({
  sourceId: Type.Optional(BoundedStringSchema),
  sourceName: Type.Optional(BoundedStringSchema),
  sourcePath: Type.Optional(BoundedStringSchema),
  buildId: Type.Optional(BoundedStringSchema),
  planSetName: Type.Optional(BoundedStringSchema),
  runId: Type.Optional(BoundedStringSchema),
});
export const PlannerInspectionSourceBuildContextSchema = Type.Object({
  sourceSummary: Type.Optional(PlannerInspectionSourceContextTextSchema),
  buildGoal: Type.Optional(PlannerInspectionSourceContextTextSchema),
  promptSourceSnippet: Type.Optional(PlannerInspectionSourceContextTextSchema),
});
export const PlannerInspectionOmittedCountsSchema = Type.Object({
  relevantFiles: Type.Optional(NonNegativeIntegerSchema),
  observedFacts: Type.Optional(NonNegativeIntegerSchema),
  importantFindings: Type.Optional(NonNegativeIntegerSchema),
  inferredImplementationAreas: Type.Optional(NonNegativeIntegerSchema),
  unresolvedQuestions: Type.Optional(NonNegativeIntegerSchema),
  toolUses: Type.Optional(NonNegativeIntegerSchema),
  toolResults: Type.Optional(NonNegativeIntegerSchema),
  toolUseSummaryBytes: Type.Optional(NonNegativeIntegerSchema),
  toolResultSnippetBytes: Type.Optional(NonNegativeIntegerSchema),
  importantFindingBytes: Type.Optional(NonNegativeIntegerSchema),
  messageBytes: Type.Optional(NonNegativeIntegerSchema),
  inferredImplementationAreaBytes: Type.Optional(NonNegativeIntegerSchema),
  sourceIdBytes: Type.Optional(NonNegativeIntegerSchema),
  sourceNameBytes: Type.Optional(NonNegativeIntegerSchema),
  sourcePathBytes: Type.Optional(NonNegativeIntegerSchema),
  buildIdBytes: Type.Optional(NonNegativeIntegerSchema),
  planSetNameBytes: Type.Optional(NonNegativeIntegerSchema),
  runIdBytes: Type.Optional(NonNegativeIntegerSchema),
  sourceSummaryBytes: Type.Optional(NonNegativeIntegerSchema),
  buildGoalBytes: Type.Optional(NonNegativeIntegerSchema),
  promptSourceSnippetBytes: Type.Optional(NonNegativeIntegerSchema),
  relevantFileBytes: Type.Optional(NonNegativeIntegerSchema),
  caveatBytes: Type.Optional(NonNegativeIntegerSchema),
}, { additionalProperties: false });

export const CompileRiskLevelSchema = Type.Union([
  Type.Literal('normal'),
  Type.Literal('elevated'),
  Type.Literal('overflow-risk'),
]);

export const CompileRecoveryActionSchema = Type.Union([
  Type.Literal('none'),
  Type.Literal('retry-as-expedition'),
  Type.Literal('bounded-decomposition'),
  Type.Literal('manual-reduce-scope'),
  Type.Literal('repair-existing-artifacts'),
]);

export const CompilePipelineScopeSchema = Type.Union([
  Type.Literal('errand'),
  Type.Literal('excursion'),
  Type.Literal('expedition'),
]);

export const CompileScopeContextSourceSchema = Type.Union([
  Type.Literal('preflight'),
  Type.Literal('live-context-guard'),
  Type.Literal('provider'),
  Type.Literal('decomposition'),
]);

export const CompileScopeContextFailureKindSchema = Type.Union([
  Type.Literal('context-budget'),
  Type.Literal('context-window'),
  Type.Literal('context-length'),
  Type.Literal('scope-too-broad'),
  Type.Literal('decomposition-exhausted'),
]);

export const CompilePreflightRiskSchema = Type.Object({
  level: CompileRiskLevelSchema,
  sourceBytes: NonNegativeIntegerSchema,
  promptSourceBytes: NonNegativeIntegerSchema,
  acceptanceCriteriaCount: NonNegativeIntegerSchema,
  score: Type.Number({ minimum: 0 }),
  generatedInventory: Type.Object({
    detected: Type.Boolean(),
    contentHashes: Type.Array(Sha256HexSchema, { maxItems: MAX_COMPILE_RISK_LIST_ITEMS }),
    pathReferences: BoundedStringListSchema,
    headings: BoundedStringListSchema,
    blockCount: NonNegativeIntegerSchema,
    sidecarCount: NonNegativeIntegerSchema,
    omittedBytes: NonNegativeIntegerSchema,
  }),
  subsystemBreadth: Type.Object({
    count: NonNegativeIntegerSchema,
    subsystems: BoundedStringListSchema,
    evidence: BoundedStringListSchema,
  }),
  selectedProfile: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  pipelineScope: Type.Optional(CompilePipelineScopeSchema),
  reasons: BoundedStringListSchema,
  recommendation: Type.Object({
    action: CompileRecoveryActionSchema,
    eligible: Type.Boolean(),
    reason: BoundedStringSchema,
  }),
});

export const CompileArtifactSummarySchema = Type.Object({
  orchestrationExists: Type.Boolean(),
  validPlanCount: NonNegativeIntegerSchema,
  invalidPlanCount: NonNegativeIntegerSchema,
  missingPlanFileCount: NonNegativeIntegerSchema,
  missingPlanFiles: BoundedStringListSchema,
  invalidPlanFiles: BoundedStringListSchema,
});

export const CompileContextGuardLimitsSchema = Type.Object({
  maxPromptBytes: PositiveIntegerSchema,
  maxObservedInputTokens: PositiveIntegerSchema,
  maxObservedTurns: Type.Optional(PositiveIntegerSchema),
  maxExplanationBytes: PositiveIntegerSchema,
});

export const CompileContextGuardMetadataSourceSchema = Type.Union([
  Type.Literal('registry'),
  Type.Literal('builtin'),
  Type.Literal('synthetic'),
  Type.Literal('fallback'),
]);

export const CompileContextGuardDiagnosticsSchema = Type.Object({
  provider: Type.Optional(Type.String()),
  modelId: Type.Optional(Type.String()),
  metadataSource: CompileContextGuardMetadataSourceSchema,
  fallbackReason: Type.Optional(BoundedStringSchema),
  contextWindow: Type.Optional(PositiveIntegerSchema),
  outputReserveTokens: PositiveIntegerSchema,
  overheadReserveTokens: PositiveIntegerSchema,
  safetyMargin: Type.Number({ exclusiveMinimum: 0, maximum: 1 }),
  limits: CompileContextGuardLimitsSchema,
});

export const PlannerInspectionBudgetDiagnosticsSchema = Type.Object({
  maxObservedInputTokens: NonNegativeIntegerSchema,
  softInputTokenThreshold: NonNegativeIntegerSchema,
  plannerMaxTurns: PositiveIntegerSchema,
  inspectionTurnBudget: NonNegativeIntegerSchema,
  softInputTokenRatio: Type.Number({ minimum: 0, maximum: 1 }),
  softTurnRatio: Type.Number({ minimum: 0, maximum: 1 }),
  guardDiagnostics: Type.Optional(CompileContextGuardDiagnosticsSchema),
  observed: PlannerContextObservationSchema,
  toolUseCount: NonNegativeIntegerSchema,
  toolResultCount: NonNegativeIntegerSchema,
});
export const PlannerInspectionSummarySchema = Type.Object({
  kind: Type.Literal('planner-inspection-handoff'),
  version: Type.Literal(1),
  source: PlannerInspectionIdentifiersSchema,
  relevantFiles: Type.Array(BoundedStringSchema, { maxItems: MAX_PLANNER_INSPECTION_RELEVANT_FILES }),
  observedFacts: Type.Array(BoundedStringSchema, { maxItems: MAX_PLANNER_INSPECTION_OBSERVED_FACTS }),
  importantFindings: Type.Array(BoundedStringSchema, { maxItems: MAX_PLANNER_INSPECTION_IMPORTANT_FINDINGS }),
  inferredImplementationAreas: Type.Array(BoundedStringSchema, { maxItems: MAX_PLANNER_INSPECTION_IMPLEMENTATION_AREAS }),
  unresolvedQuestions: Type.Array(BoundedStringSchema, { maxItems: MAX_PLANNER_INSPECTION_UNRESOLVED_QUESTIONS }),
  sourceBuildContext: PlannerInspectionSourceBuildContextSchema,
  budgetDiagnostics: PlannerInspectionBudgetDiagnosticsSchema,
  caveats: Type.Array(BoundedStringSchema, { maxItems: MAX_PLANNER_INSPECTION_CAVEATS }),
  omittedCounts: PlannerInspectionOmittedCountsSchema,
});

const CompileScopeContextFailureBaseSchema = Type.Object({
  source: CompileScopeContextSourceSchema,
  failureKind: CompileScopeContextFailureKindSchema,
  stage: Type.Union([
    Type.Literal('pipeline-composer'),
    Type.Literal('planner'),
    Type.Literal('module-planner'),
    Type.Literal('compile-expedition'),
    Type.Literal('compile'),
    Type.Literal('planning-decomposition'),
  ]),
  explanation: BoundedStringSchema,
  risk: Type.Optional(CompilePreflightRiskSchema),
  observed: Type.Optional(Type.Object({
    inputTokens: Type.Optional(NonNegativeIntegerSchema),
    outputTokens: Type.Optional(NonNegativeIntegerSchema),
    turns: Type.Optional(NonNegativeIntegerSchema),
    promptBytes: Type.Optional(NonNegativeIntegerSchema),
  })),
  guardDiagnostics: Type.Optional(CompileContextGuardDiagnosticsSchema),
  decompositionEvidence: Type.Optional(DecompositionFailureEvidenceSchema),
  recovery: Type.Object({
    action: CompileRecoveryActionSchema,
    eligible: Type.Boolean(),
    attempted: Type.Boolean(),
    attempt: Type.Integer({ minimum: 0 }),
    maxAttempts: Type.Integer({ minimum: 1 }),
    reason: BoundedStringSchema,
  }),
  artifacts: CompileArtifactSummarySchema,
});

const NonDecompositionCompileScopeContextSourceSchema = Type.Union([
  Type.Literal('preflight'),
  Type.Literal('live-context-guard'),
  Type.Literal('provider'),
]);

const NonExhaustedCompileScopeContextFailureKindSchema = Type.Union([
  Type.Literal('context-budget'),
  Type.Literal('context-window'),
  Type.Literal('context-length'),
  Type.Literal('scope-too-broad'),
]);

export const CompileScopeContextFailureSchema: typeof CompileScopeContextFailureBaseSchema = Type.Intersect([
  CompileScopeContextFailureBaseSchema,
  Type.Union([
    Type.Object({ source: Type.Literal('decomposition'), failureKind: Type.Literal('decomposition-exhausted'), stage: Type.Literal('planning-decomposition'), decompositionEvidence: DecompositionFailureEvidenceSchema }),
    Type.Object({ source: NonDecompositionCompileScopeContextSourceSchema, failureKind: NonExhaustedCompileScopeContextFailureKindSchema }),
  ]),
]) as unknown as typeof CompileScopeContextFailureBaseSchema;

Object.assign(CompileScopeContextFailureSchema, { properties: CompileScopeContextFailureBaseSchema.properties });

export const BoundedDiagnosticOptionsSchema = Type.Object({
  maxMessageBytes: Type.Integer({ minimum: 1 }),
  maxExcerptBytes: Type.Integer({ minimum: 1 }),
});

export const BoundedValidationDiagnosticSchema = Type.Object({
  schemaPath: Type.String(),
  expectedType: Type.String(),
  receivedType: Type.String(),
  excerpt: Type.String({ maxLength: MAX_VALIDATION_DIAGNOSTIC_EXCERPT_LENGTH, format: VALIDATION_DIAGNOSTIC_EXCERPT_FORMAT }),
  payloadBytes: NonNegativeIntegerSchema,
  payloadSha256: Sha256HexSchema,
  omittedBytes: NonNegativeIntegerSchema,
  truncated: Type.Boolean(),
  message: Type.String({ maxLength: MAX_VALIDATION_DIAGNOSTIC_MESSAGE_LENGTH, format: VALIDATION_DIAGNOSTIC_MESSAGE_FORMAT }),
});

export type CompileRiskLevel = Static<typeof CompileRiskLevelSchema>;
export type CompileRecoveryAction = Static<typeof CompileRecoveryActionSchema>;
export type CompilePipelineScope = Static<typeof CompilePipelineScopeSchema>;
export type CompileScopeContextSource = Static<typeof CompileScopeContextSourceSchema>;
export type CompileScopeContextFailureKind = Static<typeof CompileScopeContextFailureKindSchema>;
export type CompilePreflightRisk = Static<typeof CompilePreflightRiskSchema>;
export type CompileArtifactSummary = Static<typeof CompileArtifactSummarySchema>;
export type CompileContextGuardLimits = Static<typeof CompileContextGuardLimitsSchema>;
export type CompileContextGuardMetadataSource = Static<typeof CompileContextGuardMetadataSourceSchema>;
export type CompileContextGuardDiagnostics = Static<typeof CompileContextGuardDiagnosticsSchema>;
export type CompileScopeContextFailure = Static<typeof CompileScopeContextFailureSchema>;
export type PlannerContextObservation = Static<typeof PlannerContextObservationSchema>;
export type PlannerInspectionIdentifiers = Static<typeof PlannerInspectionIdentifiersSchema>;
export type PlannerInspectionSourceBuildContext = Static<typeof PlannerInspectionSourceBuildContextSchema>;
export type PlannerInspectionOmittedCounts = Static<typeof PlannerInspectionOmittedCountsSchema>;
export type PlannerInspectionBudgetDiagnostics = Static<typeof PlannerInspectionBudgetDiagnosticsSchema>;
export type PlannerInspectionSummary = Static<typeof PlannerInspectionSummarySchema>;
export type BoundedDiagnosticOptions = Static<typeof BoundedDiagnosticOptionsSchema>;
export type BoundedValidationDiagnostic = Static<typeof BoundedValidationDiagnosticSchema>;
