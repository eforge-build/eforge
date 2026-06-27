import { FormatRegistry, Type, type Static } from '@sinclair/typebox';

export const MAX_COMPILE_RISK_LIST_ITEMS = 12;
export const MAX_COMPILE_SCOPE_CONTEXT_EXPLANATION_LENGTH = 2000;
export const MAX_VALIDATION_DIAGNOSTIC_EXCERPT_LENGTH = 4096;
export const MAX_VALIDATION_DIAGNOSTIC_MESSAGE_LENGTH = 4096;

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
const Sha256HexSchema = Type.String({ pattern: '^[a-f0-9]{64}$' });

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
]);

export const CompileScopeContextFailureKindSchema = Type.Union([
  Type.Literal('context-budget'),
  Type.Literal('context-window'),
  Type.Literal('context-length'),
  Type.Literal('scope-too-broad'),
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

export const CompileScopeContextFailureSchema = Type.Object({
  source: CompileScopeContextSourceSchema,
  failureKind: CompileScopeContextFailureKindSchema,
  stage: Type.Union([
    Type.Literal('pipeline-composer'),
    Type.Literal('planner'),
    Type.Literal('module-planner'),
    Type.Literal('compile-expedition'),
    Type.Literal('compile'),
  ]),
  explanation: BoundedStringSchema,
  risk: Type.Optional(CompilePreflightRiskSchema),
  observed: Type.Optional(Type.Object({
    inputTokens: Type.Optional(NonNegativeIntegerSchema),
    outputTokens: Type.Optional(NonNegativeIntegerSchema),
    turns: Type.Optional(NonNegativeIntegerSchema),
    promptBytes: Type.Optional(NonNegativeIntegerSchema),
  })),
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
export type CompileScopeContextFailure = Static<typeof CompileScopeContextFailureSchema>;
export type BoundedDiagnosticOptions = Static<typeof BoundedDiagnosticOptionsSchema>;
export type BoundedValidationDiagnostic = Static<typeof BoundedValidationDiagnosticSchema>;
