import { Type, type Static } from '@sinclair/typebox';

export const PLANNING_DECOMPOSITION_MAX_STRING_LENGTH = 2_000;
export const PLANNING_DECOMPOSITION_MAX_LIST_ITEMS = 32;
export const PLANNING_DECOMPOSITION_MAX_SOURCE_SLICES = 16;
export const PLANNING_DECOMPOSITION_MAX_CRITERIA = 64;
export const PLANNING_DECOMPOSITION_MAX_UNRESOLVED_CRITERIA = 32;
export const PLANNING_DECOMPOSITION_MAX_UNITS = 128;
export const PLANNING_DECOMPOSITION_MAX_DEPENDENCIES = 32;
export const PLANNING_DECOMPOSITION_MAX_BLOCKED_PAIRS = 64;
export const PLANNING_DECOMPOSITION_MAX_SPLIT_ATTEMPTS = 8;
export const PLANNING_DECOMPOSITION_MAX_COVERAGE_OMISSIONS = 10_000;

const BoundedStringSchema = Type.String({ maxLength: PLANNING_DECOMPOSITION_MAX_STRING_LENGTH });
const BoundedStringListSchema = Type.Array(BoundedStringSchema, { maxItems: PLANNING_DECOMPOSITION_MAX_LIST_ITEMS });
const NonNegativeIntegerSchema = Type.Integer({ minimum: 0 });
const PositiveIntegerSchema = Type.Integer({ minimum: 1 });
const Sha256HexSchema = Type.String({ pattern: '^[a-f0-9]{64}$' });

export const PLANNING_DECOMPOSITION_EVENT_TYPES = [
  'planning:decomposition:start',
  'planning:decomposition:unit:queued',
  'planning:decomposition:unit:running',
  'planning:decomposition:unit:progress',
  'planning:decomposition:unit:completed',
  'planning:decomposition:unit:skipped',
  'planning:decomposition:unit:failed',
  'planning:decomposition:schedule',
  'planning:decomposition:budget',
  'planning:decomposition:compact-handoff',
  'planning:decomposition:synthesis:complete',
] as const;

export const PlanningDecompositionUnitStatusSchema = Type.Union([
  Type.Literal('queued'),
  Type.Literal('running'),
  Type.Literal('completed'),
  Type.Literal('skipped'),
  Type.Literal('failed'),
]);

export const PlanningDecompositionLimitsSchema = Type.Object({
  parallelism: PositiveIntegerSchema,
  maxDepth: PositiveIntegerSchema,
  maxPromptSourceBytes: PositiveIntegerSchema,
  maxPromptBytes: PositiveIntegerSchema,
  maxObservedInputTokens: PositiveIntegerSchema,
  maxObservedTurns: Type.Optional(PositiveIntegerSchema),
  maxCompactHandoffBytes: PositiveIntegerSchema,
  maxLocalExplorationToolUses: PositiveIntegerSchema,
  maxCriteriaPerUnit: PositiveIntegerSchema,
  maxSubsystemsPerUnit: PositiveIntegerSchema,
  maxSplitAttemptsPerUnit: PositiveIntegerSchema,
}, { additionalProperties: false });

export const PlanningUnitBudgetSchema = Type.Object({
  maxRecursiveDepth: NonNegativeIntegerSchema,
  maxPromptSourceBytes: PositiveIntegerSchema,
  maxPromptBytes: PositiveIntegerSchema,
  maxObservedInputTokens: PositiveIntegerSchema,
  maxObservedTurns: Type.Optional(PositiveIntegerSchema),
  maxCompactHandoffBytes: PositiveIntegerSchema,
  maxLocalExplorationToolUses: PositiveIntegerSchema,
  maxCriteriaPerUnit: PositiveIntegerSchema,
  maxSubsystemsPerUnit: PositiveIntegerSchema,
  maxSplitAttemptsPerUnit: PositiveIntegerSchema,
}, { additionalProperties: false });

export const PlanningObservedBudgetPressureSchema = Type.Object({
  promptSourceBytes: Type.Optional(NonNegativeIntegerSchema),
  promptBytes: Type.Optional(NonNegativeIntegerSchema),
  observedInputTokens: Type.Optional(NonNegativeIntegerSchema),
  observedTurns: Type.Optional(NonNegativeIntegerSchema),
  compactHandoffBytes: Type.Optional(NonNegativeIntegerSchema),
  localExplorationToolUses: Type.Optional(NonNegativeIntegerSchema),
  criteriaCount: Type.Optional(NonNegativeIntegerSchema),
  subsystemCount: Type.Optional(NonNegativeIntegerSchema),
  splitAttempts: Type.Optional(NonNegativeIntegerSchema),
  triggeredLimitKeys: Type.Array(BoundedStringSchema, { maxItems: PLANNING_DECOMPOSITION_MAX_LIST_ITEMS }),
}, { additionalProperties: false });

export const PlanningSourceSliceSummarySchema = Type.Object({
  kind: Type.Union([Type.Literal('prd'), Type.Literal('artifact'), Type.Literal('file'), Type.Literal('criteria'), Type.Literal('other')]),
  sourceHash: Sha256HexSchema,
  path: Type.Optional(BoundedStringSchema),
  headingPath: Type.Optional(BoundedStringListSchema),
  startLine: Type.Optional(PositiveIntegerSchema),
  endLine: Type.Optional(PositiveIntegerSchema),
  byteStart: Type.Optional(NonNegativeIntegerSchema),
  byteEnd: Type.Optional(NonNegativeIntegerSchema),
  criteriaIds: Type.Array(BoundedStringSchema, { maxItems: PLANNING_DECOMPOSITION_MAX_CRITERIA }),
  byteLength: NonNegativeIntegerSchema,
}, { additionalProperties: false });

export const PlanningCriterionCoverageSchema = Type.Object({
  criterionId: BoundedStringSchema,
  sourceHash: Type.Optional(Sha256HexSchema),
  coveredByUnitIds: Type.Array(BoundedStringSchema, { maxItems: PLANNING_DECOMPOSITION_MAX_UNITS }),
}, { additionalProperties: false });

export const PlanningUnresolvedCriterionSchema = Type.Object({
  criterionId: BoundedStringSchema,
  reason: BoundedStringSchema,
  evidence: Type.Optional(BoundedStringSchema),
}, { additionalProperties: false });

export const PlanningCoverageSummarySchema = Type.Object({
  totalCriteria: Type.Optional(NonNegativeIntegerSchema),
  omittedCriteriaCount: Type.Optional(Type.Integer({ minimum: 0, maximum: PLANNING_DECOMPOSITION_MAX_COVERAGE_OMISSIONS })),
  coveredCriteria: Type.Array(PlanningCriterionCoverageSchema, { maxItems: PLANNING_DECOMPOSITION_MAX_CRITERIA }),
  unresolvedCriteria: Type.Array(PlanningUnresolvedCriterionSchema, { maxItems: PLANNING_DECOMPOSITION_MAX_UNRESOLVED_CRITERIA }),
}, { additionalProperties: false });

export const PlanningUnitConstraintSchema = Type.Object({
  path: Type.Optional(BoundedStringSchema),
  description: BoundedStringSchema,
}, { additionalProperties: false });

export const PlanningDecompositionUnitSummarySchema = Type.Object({
  unitId: BoundedStringSchema,
  parentUnitId: Type.Optional(BoundedStringSchema),
  depth: NonNegativeIntegerSchema,
  sourceSlices: Type.Array(PlanningSourceSliceSummarySchema, { maxItems: PLANNING_DECOMPOSITION_MAX_SOURCE_SLICES }),
  coverage: PlanningCoverageSummarySchema,
  subsystemHints: BoundedStringListSchema,
  dependencies: Type.Array(BoundedStringSchema, { maxItems: PLANNING_DECOMPOSITION_MAX_DEPENDENCIES }),
  interfaceConstraints: Type.Array(PlanningUnitConstraintSchema, { maxItems: PLANNING_DECOMPOSITION_MAX_LIST_ITEMS }),
  sharedFileConstraints: Type.Array(PlanningUnitConstraintSchema, { maxItems: PLANNING_DECOMPOSITION_MAX_LIST_ITEMS }),
  budgets: PlanningUnitBudgetSchema,
  status: PlanningDecompositionUnitStatusSchema,
}, { additionalProperties: false });

export const PlanningScheduleBlockedPairSchema = Type.Object({
  unitId: BoundedStringSchema,
  blockedByUnitId: BoundedStringSchema,
  reason: Type.Optional(BoundedStringSchema),
}, { additionalProperties: false });

export const PlanningScheduleWaitingReasonSchema = Type.Object({
  unitId: BoundedStringSchema,
  reasons: Type.Array(BoundedStringSchema, { maxItems: PLANNING_DECOMPOSITION_MAX_LIST_ITEMS }),
}, { additionalProperties: false });

export const PlanningScheduleDecisionSchema = Type.Object({
  readyUnitIds: Type.Array(BoundedStringSchema, { maxItems: PLANNING_DECOMPOSITION_MAX_UNITS }),
  runningUnitIds: Type.Array(BoundedStringSchema, { maxItems: PLANNING_DECOMPOSITION_MAX_UNITS }),
  waitingUnitIds: Type.Array(BoundedStringSchema, { maxItems: PLANNING_DECOMPOSITION_MAX_UNITS }),
  waitingReasons: Type.Array(PlanningScheduleWaitingReasonSchema, { maxItems: PLANNING_DECOMPOSITION_MAX_UNITS }),
  selectedBatchUnitIds: Type.Array(BoundedStringSchema, { maxItems: PLANNING_DECOMPOSITION_MAX_UNITS }),
  parallelism: PositiveIntegerSchema,
  blockedPairs: Type.Array(PlanningScheduleBlockedPairSchema, { maxItems: PLANNING_DECOMPOSITION_MAX_BLOCKED_PAIRS }),
}, { additionalProperties: false });

export const PlanningSplitAttemptEvidenceSchema = Type.Object({
  unitId: Type.Optional(BoundedStringSchema),
  attempt: PositiveIntegerSchema,
  reason: BoundedStringSchema,
  resultingUnitIds: Type.Array(BoundedStringSchema, { maxItems: PLANNING_DECOMPOSITION_MAX_UNITS }),
  observed: Type.Optional(PlanningObservedBudgetPressureSchema),
}, { additionalProperties: false });

export const DecompositionFailureEvidenceSchema = Type.Object({
  unitId: BoundedStringSchema,
  parentUnitId: Type.Optional(BoundedStringSchema),
  depth: NonNegativeIntegerSchema,
  budgets: PlanningUnitBudgetSchema,
  observed: PlanningObservedBudgetPressureSchema,
  assignedCriteriaIds: Type.Array(BoundedStringSchema, { maxItems: PLANNING_DECOMPOSITION_MAX_CRITERIA }),
  unresolvedCriteria: Type.Array(PlanningUnresolvedCriterionSchema, { maxItems: PLANNING_DECOMPOSITION_MAX_UNRESOLVED_CRITERIA }),
  blockers: BoundedStringListSchema,
  splitAttempts: Type.Array(PlanningSplitAttemptEvidenceSchema, { maxItems: PLANNING_DECOMPOSITION_MAX_SPLIT_ATTEMPTS }),
}, { additionalProperties: false });

export const PlanningDecompositionStartFields = {
  runId: Type.Optional(Type.String()),
  graphId: BoundedStringSchema,
  rootUnitId: BoundedStringSchema,
  unitCount: NonNegativeIntegerSchema,
  edgeCount: NonNegativeIntegerSchema,
  limits: PlanningDecompositionLimitsSchema,
} as const;

const PlanningQueuedDecompositionUnitSummarySchema = Type.Intersect([
  PlanningDecompositionUnitSummarySchema,
  Type.Object({ status: Type.Literal('queued') }),
]);
const PlanningCompletedDecompositionUnitSummarySchema = Type.Intersect([
  PlanningDecompositionUnitSummarySchema,
  Type.Object({ status: Type.Literal('completed') }),
]);
const PlanningSkippedDecompositionUnitSummarySchema = Type.Intersect([
  PlanningDecompositionUnitSummarySchema,
  Type.Object({ status: Type.Literal('skipped') }),
]);

export const PlanningDecompositionUnitQueuedFields = { unit: PlanningQueuedDecompositionUnitSummarySchema } as const;
export const PlanningDecompositionUnitRunningFields = { unitId: BoundedStringSchema } as const;
export const PlanningDecompositionUnitProgressFields = {
  unitId: BoundedStringSchema,
  message: BoundedStringSchema,
  observed: Type.Optional(PlanningObservedBudgetPressureSchema),
} as const;
export const PlanningDecompositionUnitCompletedFields = { unit: PlanningCompletedDecompositionUnitSummarySchema } as const;
export const PlanningDecompositionUnitSkippedFields = {
  unitId: BoundedStringSchema,
  reason: BoundedStringSchema,
  unit: Type.Optional(PlanningSkippedDecompositionUnitSummarySchema),
} as const;
export const PlanningDecompositionUnitFailedFields = {
  unitId: BoundedStringSchema,
  reason: BoundedStringSchema,
  evidence: DecompositionFailureEvidenceSchema,
} as const;
export const PlanningDecompositionScheduleFields = { decision: PlanningScheduleDecisionSchema } as const;
export const PlanningUnitBudgetEntrySchema = Type.Object({
  unitId: BoundedStringSchema,
  budget: PlanningUnitBudgetSchema,
}, { additionalProperties: false });

export const PlanningDecompositionBudgetFields = {
  limits: PlanningDecompositionLimitsSchema,
  unitId: BoundedStringSchema,
  unitBudgets: Type.Array(PlanningUnitBudgetEntrySchema, { maxItems: PLANNING_DECOMPOSITION_MAX_UNITS }),
  observed: Type.Optional(PlanningObservedBudgetPressureSchema),
} as const;
export const PlanningDecompositionCompactHandoffFields = {
  unitId: BoundedStringSchema,
  artifactPath: BoundedStringSchema,
  byteLength: NonNegativeIntegerSchema,
  contentHash: Sha256HexSchema,
  omittedUnitIds: Type.Array(BoundedStringSchema, { maxItems: PLANNING_DECOMPOSITION_MAX_UNITS }),
} as const;
export const PlanningDecompositionSynthesisCompleteFields = {
  unitCount: NonNegativeIntegerSchema,
  completedUnitCount: NonNegativeIntegerSchema,
  failedUnitCount: NonNegativeIntegerSchema,
  skippedUnitCount: NonNegativeIntegerSchema,
  coverage: PlanningCoverageSummarySchema,
  artifactPaths: Type.Array(BoundedStringSchema, { maxItems: PLANNING_DECOMPOSITION_MAX_LIST_ITEMS }),
} as const;

export type PlanningDecompositionEventType = typeof PLANNING_DECOMPOSITION_EVENT_TYPES[number];
export type PlanningDecompositionUnitStatus = Static<typeof PlanningDecompositionUnitStatusSchema>;
export type PlanningDecompositionLimits = Static<typeof PlanningDecompositionLimitsSchema>;
export type PlanningUnitBudget = Static<typeof PlanningUnitBudgetSchema>;
export type PlanningObservedBudgetPressure = Static<typeof PlanningObservedBudgetPressureSchema>;
export type PlanningSourceSliceSummary = Static<typeof PlanningSourceSliceSummarySchema>;
export type PlanningCriterionCoverage = Static<typeof PlanningCriterionCoverageSchema>;
export type PlanningUnresolvedCriterion = Static<typeof PlanningUnresolvedCriterionSchema>;
export type PlanningCoverageSummary = Static<typeof PlanningCoverageSummarySchema>;
export type PlanningUnitConstraint = Static<typeof PlanningUnitConstraintSchema>;
export type PlanningDecompositionUnitSummary = Static<typeof PlanningDecompositionUnitSummarySchema>;
export type PlanningScheduleBlockedPair = Static<typeof PlanningScheduleBlockedPairSchema>;
export type PlanningScheduleWaitingReason = Static<typeof PlanningScheduleWaitingReasonSchema>;
export type PlanningScheduleDecision = Static<typeof PlanningScheduleDecisionSchema>;
export type PlanningUnitBudgetEntry = Static<typeof PlanningUnitBudgetEntrySchema>;
export type PlanningSplitAttemptEvidence = Static<typeof PlanningSplitAttemptEvidenceSchema>;
export type DecompositionFailureEvidence = Static<typeof DecompositionFailureEvidenceSchema>;

export function capPlanningDecompositionString(value: string, maxLength = PLANNING_DECOMPOSITION_MAX_STRING_LENGTH): string {
  return value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function projectPlanningCoverageSummaryForWire(coverage: PlanningCoverageSummary & { coverageByUnit?: unknown }): PlanningCoverageSummary {
  const coveredCriteria = coverage.coveredCriteria.slice(0, PLANNING_DECOMPOSITION_MAX_CRITERIA).map((criterion) => ({
    criterionId: capPlanningDecompositionString(criterion.criterionId),
    ...(criterion.sourceHash ? { sourceHash: criterion.sourceHash } : {}),
    coveredByUnitIds: criterion.coveredByUnitIds.slice(0, PLANNING_DECOMPOSITION_MAX_UNITS).map((unitId) => capPlanningDecompositionString(unitId)),
  }));
  const unresolvedCriteria = coverage.unresolvedCriteria.slice(0, PLANNING_DECOMPOSITION_MAX_UNRESOLVED_CRITERIA).map((criterion) => ({
    criterionId: capPlanningDecompositionString(criterion.criterionId),
    reason: capPlanningDecompositionString(criterion.reason),
    ...(criterion.evidence ? { evidence: capPlanningDecompositionString(criterion.evidence) } : {}),
  }));
  const omitted = Math.max(0, coverage.coveredCriteria.length - coveredCriteria.length) + Math.max(0, coverage.unresolvedCriteria.length - unresolvedCriteria.length);
  return {
    ...(coverage.totalCriteria !== undefined ? { totalCriteria: coverage.totalCriteria } : {}),
    ...(omitted > 0 ? { omittedCriteriaCount: Math.min(omitted, PLANNING_DECOMPOSITION_MAX_COVERAGE_OMISSIONS) } : {}),
    coveredCriteria,
    unresolvedCriteria,
  };
}

export function projectPlanningDecompositionUnitSummaryForWire(unit: PlanningDecompositionUnitSummary): PlanningDecompositionUnitSummary {
  return {
    unitId: capPlanningDecompositionString(unit.unitId),
    ...(unit.parentUnitId ? { parentUnitId: capPlanningDecompositionString(unit.parentUnitId) } : {}),
    depth: unit.depth,
    sourceSlices: unit.sourceSlices.slice(0, PLANNING_DECOMPOSITION_MAX_SOURCE_SLICES).map((slice) => ({
      kind: slice.kind,
      sourceHash: slice.sourceHash,
      ...(slice.path ? { path: capPlanningDecompositionString(slice.path) } : {}),
      ...(slice.headingPath ? { headingPath: slice.headingPath.slice(0, PLANNING_DECOMPOSITION_MAX_LIST_ITEMS).map((part) => capPlanningDecompositionString(part)) } : {}),
      ...(slice.startLine ? { startLine: slice.startLine } : {}),
      ...(slice.endLine ? { endLine: slice.endLine } : {}),
      criteriaIds: slice.criteriaIds.slice(0, PLANNING_DECOMPOSITION_MAX_CRITERIA).map((id) => capPlanningDecompositionString(id)),
      byteLength: slice.byteLength,
    })),
    coverage: projectPlanningCoverageSummaryForWire(unit.coverage),
    subsystemHints: unit.subsystemHints.slice(0, PLANNING_DECOMPOSITION_MAX_LIST_ITEMS).map((hint) => capPlanningDecompositionString(hint)),
    dependencies: unit.dependencies.slice(0, PLANNING_DECOMPOSITION_MAX_DEPENDENCIES).map((dependency) => capPlanningDecompositionString(dependency)),
    interfaceConstraints: unit.interfaceConstraints.slice(0, PLANNING_DECOMPOSITION_MAX_LIST_ITEMS).map((constraint) => ({ ...(constraint.path ? { path: capPlanningDecompositionString(constraint.path) } : {}), description: capPlanningDecompositionString(constraint.description) })),
    sharedFileConstraints: unit.sharedFileConstraints.slice(0, PLANNING_DECOMPOSITION_MAX_LIST_ITEMS).map((constraint) => ({ ...(constraint.path ? { path: capPlanningDecompositionString(constraint.path) } : {}), description: capPlanningDecompositionString(constraint.description) })),
    budgets: unit.budgets,
    status: unit.status,
  };
}
