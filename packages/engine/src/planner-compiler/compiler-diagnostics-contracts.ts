import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { PlanningReduceGapIssueKindSchema } from './reduce-contracts.js';
import { LocalizationIssueKindSchema } from './localization-issue-contracts.js';
import { PlanningModuleDocsWorkSchema, PlanningModuleReviewDepthSchema, PlanningModuleTestOwnershipSchema, PlanningModuleTestWorkSchema } from './reduce-digest-contracts.js';

export const COMPILER_DIAGNOSTICS_ARTIFACT = 'compiler-diagnostics.json';
export const COMPILER_DIAGNOSTICS_VERSION = 2;
export const MAX_COMPILER_DIAGNOSTICS_BYTES = 262_144;

const boundedString = (maxLength: number) => Type.String({ maxLength });
const boundedIds = (maxLength: number, maxItems: number) => Type.Array(boundedString(maxLength), { maxItems });
const count = () => Type.Integer({ minimum: 0 });

const CompilerStatusSchema = Type.Union([Type.Literal('complete'), Type.Literal('complete-with-residue'), Type.Literal('incomplete'), Type.Literal('failed')]);
const RepairStatusSchema = Type.Union([Type.Literal('not-needed'), Type.Literal('repaired'), Type.Literal('unresolved'), Type.Literal('exhausted')]);
const RepairCoverageStatusSchema = Type.Union([Type.Literal('covered'), Type.Literal('missing'), Type.Literal('unknown')]);
const GapResolutionSchema = Type.Union([Type.Literal('residue-represented'), Type.Literal('informational'), Type.Literal('unrepresented')]);
const LocalizationOwnerStatusSchema = Type.Union([Type.Literal('resolved'), Type.Literal('partial'), Type.Literal('unresolved'), Type.Literal('ignored'), Type.Literal('budget-exceeded'), Type.Literal('none')]);
const EvidenceStatusSchema = Type.Union([Type.Literal('materialized'), Type.Literal('missing'), Type.Literal('non-actionable'), Type.Literal('directory'), Type.Literal('too-large'), Type.Literal('read-error'), Type.Literal('budget-exceeded'), Type.Literal('none')]);
const EvidenceFailureStatusSchema = Type.Union([Type.Literal('missing'), Type.Literal('non-actionable'), Type.Literal('directory'), Type.Literal('too-large'), Type.Literal('read-error'), Type.Literal('budget-exceeded')]);
const ExplorationOutcomeStatusSchema = Type.Union([Type.Literal('not-run'), Type.Literal('completed'), Type.Literal('needs-rescope'), Type.Literal('budget-exhausted'), Type.Literal('ambiguous')]);

const CompilerDiagnosticsCoverageCriterionSchema = Type.Object({
  criterionId: boundedString(80),
  complete: Type.Boolean(),
  requiredAspectIds: boundedIds(240, 128),
  resolvedAspectIds: boundedIds(240, 128),
  skippedAspectIds: boundedIds(240, 128),
  representedAspectIds: boundedIds(240, 128),
  pendingAspectIds: boundedIds(240, 128),
}, { additionalProperties: false });

const CompilerDiagnosticsCoverageAspectSchema = Type.Object({
  aspectId: boundedString(240),
  criterionId: boundedString(80),
  status: Type.Union([Type.Literal('pending'), Type.Literal('resolved'), Type.Literal('skipped'), Type.Literal('represented')]),
  satisfied: Type.Boolean(),
  completedByAtomIds: boundedIds(160, 16),
  reason: Type.Optional(boundedString(500)),
  representedByModuleId: Type.Optional(boundedString(160)),
}, { additionalProperties: false });

const CompilerDiagnosticsGapSchema = Type.Object({
  gapId: boundedString(160),
  title: boundedString(240),
  reduceNodeId: boundedString(160),
  issueKind: PlanningReduceGapIssueKindSchema,
  sourceLocalizationSignal: Type.Boolean(),
  representationRequired: Type.Boolean(),
  criterionIds: boundedIds(80, 64),
  aspectIds: boundedIds(240, 128),
  sourceNeedIds: boundedIds(160, 64),
  affectedAtomIds: boundedIds(160, 64),
  ownerPaths: boundedIds(300, 64),
  productScopedOutputRefs: boundedIds(300, 32),
  productScopedValidationRefs: boundedIds(300, 32),
  description: boundedString(2_000),
  resolution: GapResolutionSchema,
  representedByCandidateId: Type.Optional(boundedString(160)),
}, { additionalProperties: false });

const CompilerDiagnosticsConflictSchema = Type.Object({
  conflictId: boundedString(160),
  title: boundedString(240),
  reduceNodeId: boundedString(160),
  criterionIds: boundedIds(80, 64),
  aspectIds: boundedIds(240, 128),
  description: boundedString(2_000),
  resolution: GapResolutionSchema,
  representedByCandidateId: Type.Optional(boundedString(160)),
}, { additionalProperties: false });

const RepairCoverageEntrySchema = (idLength: number) => Type.Object({ id: boundedString(idLength), status: RepairCoverageStatusSchema }, { additionalProperties: false });

const CompilerDiagnosticsRepairAttemptSchema = Type.Object({
  attempt: Type.Integer({ minimum: 0, maximum: 100 }),
  maxAttempts: Type.Integer({ minimum: 0, maximum: 100 }),
  status: RepairStatusSchema,
  gapIds: boundedIds(160, 64),
  gapClassifications: Type.Array(Type.Object({ gapId: boundedString(160), issueKind: PlanningReduceGapIssueKindSchema, sourceLocalizationSignal: Type.Boolean() }, { additionalProperties: false }), { maxItems: 64 }),
  sourceNeedIds: boundedIds(160, 64),
  affectedAtomIds: boundedIds(160, 64),
  criterionIds: boundedIds(80, 64),
  aspectIds: boundedIds(240, 128),
  localizedOwnerPaths: boundedIds(300, 64),
  localizedOwnerStatus: Type.Array(Type.Object({ path: boundedString(300), status: LocalizationOwnerStatusSchema, needIds: boundedIds(160, 16) }, { additionalProperties: false }), { maxItems: 64 }),
  evidenceMaterializationStatus: Type.Array(Type.Object({ path: boundedString(300), status: EvidenceStatusSchema, reason: Type.Optional(boundedString(500)), budgetAtomIds: Type.Optional(boundedIds(160, 16)), priority: Type.Optional(Type.Boolean()) }, { additionalProperties: false }), { maxItems: 64 }),
  coverageStatus: Type.Object({
    criteria: Type.Array(RepairCoverageEntrySchema(80), { maxItems: 256 }),
    aspects: Type.Array(RepairCoverageEntrySchema(240), { maxItems: 1_024 }),
    sourceNeeds: Type.Array(RepairCoverageEntrySchema(160), { maxItems: 256 }),
  }, { additionalProperties: false }),
  unresolvedReason: Type.Optional(boundedString(1_000)),
  residueSynthesisBlocked: Type.Boolean(),
}, { additionalProperties: false });

const CompilerDiagnosticsResidueCandidateSchema = Type.Object({
  candidateId: boundedString(160),
  title: boundedString(240),
  kind: Type.Union([Type.Literal('residue'), Type.Literal('follow-up')]),
  reason: boundedString(80),
  buildability: Type.Union([Type.Literal('buildable'), Type.Literal('repair-only')]),
  sourceLocalizationDerived: Type.Boolean(),
  criterionIds: boundedIds(80, 64),
  aspectIds: boundedIds(240, 128),
  localizedOwnerPaths: boundedIds(300, 64),
  sourceRefs: boundedIds(300, 32),
}, { additionalProperties: false });

const CompilerDiagnosticsEvidenceFailureSchema = Type.Object({
  path: boundedString(500),
  status: EvidenceFailureStatusSchema,
  reason: Type.Optional(boundedString(500)),
  error: Type.Optional(boundedString(500)),
  referencedByAtomIds: boundedIds(160, 16),
  budgetAtomIds: Type.Optional(boundedIds(160, 16)),
}, { additionalProperties: false });

const CompilerDiagnosticsSharedBriefBudgetEntrySchema = Type.Object({
  code: Type.Union([Type.Literal('atom-section-demoted'), Type.Literal('section-dropped-unreferenced'), Type.Literal('section-dropped-total-budget')]),
  sectionId: boundedString(300),
  atomId: Type.Optional(boundedString(160)),
  path: Type.Optional(boundedString(300)),
  message: boundedString(500),
}, { additionalProperties: false });

const CompilerDiagnosticsExplorationSchema = Type.Object({
  outcomeStatus: ExplorationOutcomeStatusSchema,
  unresolvedNeedIds: boundedIds(160, 100),
  reasons: Type.Array(LocalizationIssueKindSchema, { maxItems: 32 }),
  attemptedQueries: Type.Array(Type.Object({ needId: Type.Optional(boundedString(160)), query: boundedString(1_000), tool: Type.Optional(boundedString(120)), result: Type.Optional(boundedString(1_000)) }, { additionalProperties: false }), { maxItems: 100 }),
  candidatePaths: boundedIds(300, 100),
  rescopeHints: Type.Array(boundedString(1_000), { maxItems: 32 }),
  notes: Type.Optional(boundedString(2_000)),
  unknownIdDrops: Type.Array(Type.Object({ field: boundedString(80), id: boundedString(240), index: Type.Optional(Type.Integer({ minimum: 0 })) }, { additionalProperties: false }), { maxItems: 100 }),
  toolUseCount: count(),
}, { additionalProperties: false });

const CompilerDiagnosticsRescopeSchema = Type.Object({
  status: Type.Union([Type.Literal('not-needed'), Type.Literal('warning-only'), Type.Literal('rescoped'), Type.Literal('exhausted-proceeded'), Type.Literal('fail-closed')]),
  attempts: Type.Integer({ minimum: 0, maximum: 100 }),
  maxAttempts: Type.Integer({ minimum: 0, maximum: 100 }),
  originalAtomCount: count(),
  revisedAtomCount: count(),
  ledger: Type.Object({ totalToolUseBudget: count(), usedToolUses: count() }, { additionalProperties: false }),
  riskReasons: Type.Array(boundedString(240), { maxItems: 16 }),
  splitGroups: Type.Array(Type.Object({
    directiveId: boundedString(160),
    groupKey: boundedString(160),
    criterionIds: boundedIds(80, 64),
    rationale: boundedString(500),
  }, { additionalProperties: false }), { maxItems: 64 }),
  rerunScopeKeys: boundedIds(160, 64),
  preservedScopeKeys: boundedIds(160, 64),
  unresolvedCriticalNeedIds: boundedIds(160, 100),
}, { additionalProperties: false });

const BuildStageSpecSchema = Type.Union([boundedString(80), Type.Array(boundedString(80), { minItems: 1, maxItems: 8 })]);
const CompilerDiagnosticsNormalizationChangeSchema = Type.Object({
  field: Type.Union([Type.Literal('docsWork'), Type.Literal('testWork'), Type.Literal('testOwnership'), Type.Literal('reviewDepth'), Type.Literal('fileOwnership')]),
  kind: Type.Union([Type.Literal('fallback'), Type.Literal('normalized'), Type.Literal('safety-escalation')]),
  reason: boundedString(500),
}, { additionalProperties: false });
const CompilerDiagnosticsNormalizationModuleSchema = Type.Object({
  moduleId: boundedString(160),
  proposed: Type.Object({
    docsWork: Type.Optional(PlanningModuleDocsWorkSchema),
    testWork: Type.Optional(PlanningModuleTestWorkSchema),
    testOwnership: Type.Optional(PlanningModuleTestOwnershipSchema),
    reviewDepth: Type.Optional(PlanningModuleReviewDepthSchema),
    reviewRationale: Type.Optional(boundedString(500)),
    dependsOnModuleIds: boundedIds(160, 16),
  }, { additionalProperties: false }),
  normalized: Type.Object({
    docsWork: PlanningModuleDocsWorkSchema,
    testWork: PlanningModuleTestWorkSchema,
    testOwnership: PlanningModuleTestOwnershipSchema,
    reviewDepth: PlanningModuleReviewDepthSchema,
    build: Type.Array(BuildStageSpecSchema, { maxItems: 16 }),
  }, { additionalProperties: false }),
  ownedPaths: boundedIds(500, 64),
  changes: Type.Array(CompilerDiagnosticsNormalizationChangeSchema, { maxItems: 16 }),
}, { additionalProperties: false });
const CompilerDiagnosticsNormalizationSchema = Type.Object({
  status: Type.Union([Type.Literal('not-run'), Type.Literal('accepted'), Type.Literal('normalized'), Type.Literal('rejected')]),
  modules: Type.Array(CompilerDiagnosticsNormalizationModuleSchema, { maxItems: 64 }),
  fileOwnershipConflicts: Type.Array(Type.Object({ path: boundedString(500), ownerModuleIds: boundedIds(160, 16) }, { additionalProperties: false }), { maxItems: 64 }),
  validationErrors: Type.Array(boundedString(500), { maxItems: 128 }),
}, { additionalProperties: false });

export const CompilerDiagnosticsSchema = Type.Object({
  version: Type.Literal(COMPILER_DIAGNOSTICS_VERSION),
  planSetName: boundedString(200),
  sourceHash: boundedString(80),
  graphId: boundedString(160),
  compilerStatus: CompilerStatusSchema,
  validationErrors: Type.Array(boundedString(500), { maxItems: 128 }),
  normalization: CompilerDiagnosticsNormalizationSchema,
  coverage: Type.Object({
    completeCriteria: boundedIds(80, 256),
    incompleteCriteria: boundedIds(80, 256),
    criteria: Type.Array(CompilerDiagnosticsCoverageCriterionSchema, { maxItems: 256 }),
    aspects: Type.Array(CompilerDiagnosticsCoverageAspectSchema, { maxItems: 1_024 }),
  }, { additionalProperties: false }),
  reduce: Type.Object({
    gaps: Type.Array(CompilerDiagnosticsGapSchema, { maxItems: 128 }),
    conflicts: Type.Array(CompilerDiagnosticsConflictSchema, { maxItems: 128 }),
  }, { additionalProperties: false }),
  exploration: CompilerDiagnosticsExplorationSchema,
  rescope: Type.Optional(CompilerDiagnosticsRescopeSchema),
  repair: Type.Object({
    status: RepairStatusSchema,
    attempts: Type.Array(CompilerDiagnosticsRepairAttemptSchema, { maxItems: 8 }),
  }, { additionalProperties: false }),
  residue: Type.Object({
    synthesisBlocked: Type.Boolean(),
    blockedReasons: Type.Array(boundedString(500), { maxItems: 64 }),
    candidates: Type.Array(CompilerDiagnosticsResidueCandidateSchema, { maxItems: 80 }),
  }, { additionalProperties: false }),
  evidenceFailures: Type.Array(CompilerDiagnosticsEvidenceFailureSchema, { maxItems: 128 }),
  sharedBriefBudget: Type.Array(CompilerDiagnosticsSharedBriefBudgetEntrySchema, { maxItems: 128 }),
  omitted: Type.Object({
    gaps: count(),
    conflicts: count(),
    repairAttempts: count(),
    evidenceFailures: count(),
    coverageAspects: count(),
    coverageCriteria: count(),
    residueCandidates: count(),
    validationErrors: count(),
    descriptionBytes: count(),
    sharedBriefBudget: count(),
    normalizationModules: count(),
    normalizationChanges: count(),
    normalizationOwnedPaths: count(),
    normalizationValidationErrors: count(),
    fileOwnershipConflicts: count(),
  }, { additionalProperties: false }),
}, { additionalProperties: false });

export type CompilerDiagnostics = Static<typeof CompilerDiagnosticsSchema>;
export type CompilerDiagnosticsGap = Static<typeof CompilerDiagnosticsGapSchema>;
export type CompilerDiagnosticsConflict = Static<typeof CompilerDiagnosticsConflictSchema>;
export type CompilerDiagnosticsRepairAttempt = Static<typeof CompilerDiagnosticsRepairAttemptSchema>;
export type CompilerDiagnosticsExploration = Static<typeof CompilerDiagnosticsExplorationSchema>;
export type CompilerDiagnosticsRescope = Static<typeof CompilerDiagnosticsRescopeSchema>;
export type CompilerDiagnosticsOmittedCounts = CompilerDiagnostics['omitted'];

export function validateCompilerDiagnostics(value: unknown): { ok: true; errors: [] } | { ok: false; errors: string[] } {
  if (Value.Check(CompilerDiagnosticsSchema, value)) return { ok: true, errors: [] };
  const errors = [...Value.Errors(CompilerDiagnosticsSchema, value)].slice(0, 32).map((error) => `${error.path || '/'}: ${error.message}`);
  return { ok: false, errors };
}
