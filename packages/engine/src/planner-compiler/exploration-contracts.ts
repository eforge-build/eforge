import { Type, type Static } from '@sinclair/typebox';
import {
  normalizeSourceLocalizationInputs,
  type SourceLocalizationBundle,
  type SourceLocalizationDiagnostic,
  type SourceLocalizationInputHints,
  type SourceLocalizationNeedKind,
} from './source-localization-contracts.js';
import { LocalizationIssueKindSchema, type LocalizationIssueKind } from './localization-issue-contracts.js';

/**
 * Repository exploration hint kinds mirror SourceLocalizationNeedKind so a
 * submission survives normalizeSourceLocalizationInputs unchanged. The
 * `satisfies` clause fails the build if a listed kind drifts from the
 * localization contract.
 */
export const REPOSITORY_EXPLORATION_HINT_KINDS = ['literal-path', 'directory', 'subsystem', 'interface', 'symbol', 'keyword', 'manifest', 'entrypoint', 'docs', 'test', 'config', 'command', 'route', 'api', 'ui', 'extension', 'consumer-surface'] as const satisfies readonly SourceLocalizationNeedKind[];
export const REPOSITORY_EXPLORATION_OUTCOME_STATUSES = ['completed', 'needs-rescope', 'budget-exhausted', 'ambiguous'] as const;

const boundedString = (maxLength: number): ReturnType<typeof Type.String> => Type.String({ minLength: 1, maxLength });
const hintStringList = () => Type.Optional(Type.Array(boundedString(1_000), { maxItems: 100 }));

export const RepositoryExplorationHintSchema = Type.Object({
  needId: Type.Optional(boundedString(160)),
  kind: Type.Union(REPOSITORY_EXPLORATION_HINT_KINDS.map((kind) => Type.Literal(kind))),
  query: boundedString(1_000),
  paths: hintStringList(),
  keywords: hintStringList(),
  subsystemHints: hintStringList(),
  interfaceKeys: hintStringList(),
  criterionIds: hintStringList(),
  aspectIds: hintStringList(),
}, { additionalProperties: false });

export const RepositoryExplorationAttemptedQuerySchema = Type.Object({
  needId: Type.Optional(boundedString(160)),
  query: boundedString(1_000),
  tool: Type.Optional(boundedString(120)),
  result: Type.Optional(Type.String({ maxLength: 1_000 })),
}, { additionalProperties: false });

export const RepositoryExplorationOutcomeSchema = Type.Object({
  status: Type.Union(REPOSITORY_EXPLORATION_OUTCOME_STATUSES.map((status) => Type.Literal(status))),
  projectHints: Type.Optional(Type.Array(RepositoryExplorationHintSchema, { maxItems: 100 })),
  unresolvedNeedIds: Type.Optional(Type.Array(boundedString(160), { maxItems: 100 })),
  reasons: Type.Optional(Type.Array(LocalizationIssueKindSchema, { maxItems: 32 })),
  attemptedQueries: Type.Optional(Type.Array(RepositoryExplorationAttemptedQuerySchema, { maxItems: 100 })),
  candidatePaths: hintStringList(),
  rescopeHints: Type.Optional(Type.Array(Type.String({ maxLength: 1_000 }), { maxItems: 32 })),
  notes: Type.Optional(Type.String({ maxLength: 2_000 })),
  toolUseCount: Type.Optional(Type.Integer({ minimum: 0, maximum: 10_000 })),
}, { additionalProperties: false });

export type RepositoryExplorationOutcome = Static<typeof RepositoryExplorationOutcomeSchema>;
export type RepositoryExplorationOutcomeStatus = RepositoryExplorationOutcome['status'];
export interface ExplorationUnknownIdDrop { field: 'needId' | 'unresolvedNeedIds' | 'criterionIds' | 'aspectIds' | 'attemptedQueries.needId'; id: string; index?: number }
export interface ExplorationHintsFromSubmissionResult { outcome: RepositoryExplorationOutcome; hints?: SourceLocalizationInputHints; diagnostics: SourceLocalizationDiagnostic[]; unknownIdDrops: ExplorationUnknownIdDrop[] }
export interface ExplorationIdValidationContext { allowedNeedIds?: string[]; allowedCriterionIds?: string[]; allowedAspectIds?: string[] }

/**
 * Convert a raw exploration outcome into validated localization hints. Invalid
 * hint entries and unknown echoed ids are dropped individually with diagnostics;
 * malformed ids never reject the whole outcome.
 */
export function explorationHintsFromSubmission(submission: RepositoryExplorationOutcome, context: ExplorationIdValidationContext = {}): ExplorationHintsFromSubmissionResult {
  const { outcome, diagnostics: idDiagnostics, unknownIdDrops } = dropUnknownIds(submission, context);
  if (outcome.status !== 'completed') {
    return { outcome, diagnostics: idDiagnostics, unknownIdDrops };
  }
  const projectHintsForLocalization = (outcome.projectHints ?? []).map(({ needId: _needId, ...hint }) => hint);
  const normalized = normalizeSourceLocalizationInputs({ projectHints: projectHintsForLocalization });
  const projectHints = normalized.hints.projectHints ?? [];
  return {
    outcome,
    ...(projectHints.length > 0 ? { hints: { projectHints } } : {}),
    diagnostics: [...idDiagnostics, ...normalized.diagnostics],
    unknownIdDrops,
  };
}

export function synthesizeBudgetExhaustedExplorationOutcome(bundle: SourceLocalizationBundle, toolUseCount: number): RepositoryExplorationOutcome {
  return {
    status: 'budget-exhausted',
    unresolvedNeedIds: unresolvedNeedIds(bundle),
    reasons: ['tool-budget'],
    attemptedQueries: [],
    candidatePaths: [],
    rescopeHints: [],
    notes: `Exploration tool budget exhausted after ${toolUseCount} tool uses without a structured submission.`,
    toolUseCount,
  };
}

function dropUnknownIds(submission: RepositoryExplorationOutcome, context: ExplorationIdValidationContext): Pick<ExplorationHintsFromSubmissionResult, 'outcome' | 'diagnostics' | 'unknownIdDrops'> {
  const needIds = context.allowedNeedIds ? new Set(context.allowedNeedIds) : undefined;
  const criterionIds = context.allowedCriterionIds ? new Set(context.allowedCriterionIds) : undefined;
  const aspectIds = context.allowedAspectIds ? new Set(context.allowedAspectIds) : undefined;
  const diagnostics: SourceLocalizationDiagnostic[] = [];
  const unknownIdDrops: ExplorationUnknownIdDrop[] = [];
  const drop = (field: ExplorationUnknownIdDrop['field'], id: string, index?: number): void => {
    unknownIdDrops.push({ field, id, ...(index === undefined ? {} : { index }) });
    diagnostics.push({ code: 'exploration-unknown-id-dropped', message: `Dropped unknown ${field} id: ${id}`, severity: 'warning', needId: field.includes('needId') ? id : undefined });
  };
  const filterIds = (values: string[] | undefined, allowed: Set<string> | undefined, field: ExplorationUnknownIdDrop['field'], index?: number): string[] | undefined => {
    if (!values || !allowed) return values;
    return values.filter((id) => allowed.has(id) || (drop(field, id, index), false));
  };
  const projectHints = submission.projectHints?.map((hint, index) => {
    const { needId: submittedNeedId, ...rest } = hint;
    const needId = submittedNeedId && needIds && !needIds.has(submittedNeedId) ? (drop('needId', submittedNeedId, index), undefined) : submittedNeedId;
    return {
      ...rest,
      ...(needId ? { needId } : {}),
      criterionIds: filterIds(hint.criterionIds, criterionIds, 'criterionIds', index),
      aspectIds: filterIds(hint.aspectIds, aspectIds, 'aspectIds', index),
    };
  });
  const attemptedQueries = submission.attemptedQueries?.map((query, index) => {
    const { needId: submittedNeedId, ...rest } = query;
    const needId = submittedNeedId && needIds && !needIds.has(submittedNeedId) ? (drop('attemptedQueries.needId', submittedNeedId, index), undefined) : submittedNeedId;
    return { ...rest, ...(needId ? { needId } : {}) };
  });
  return {
    outcome: {
      ...submission,
      ...(projectHints ? { projectHints } : {}),
      unresolvedNeedIds: filterIds(submission.unresolvedNeedIds, needIds, 'unresolvedNeedIds'),
      ...(attemptedQueries ? { attemptedQueries } : {}),
    },
    diagnostics,
    unknownIdDrops,
  };
}

function unresolvedNeedIds(bundle: SourceLocalizationBundle): string[] {
  return bundle.records.filter((record) => record.status !== 'resolved' || record.confidence !== 'high').map((record) => record.needId).sort();
}

/** Minimum share of literal-path/directory needs that must already be resolved with high confidence for exploration to be skipped. */
export const EXPLORATION_SKIP_HIGH_CONFIDENCE_SHARE = 0.6;

export interface ExplorationSkipDecision { skip: boolean; literalNeedCount: number; highConfidenceCount: number; share: number; reason: string }

/** Skip heuristic for the repository exploration agent. */
export function decideExplorationSkip(bundle: SourceLocalizationBundle, criterionCount?: number): ExplorationSkipDecision {
  if (criterionCount === 0) {
    return { skip: true, literalNeedCount: 0, highConfidenceCount: 0, share: 0, reason: 'source has no acceptance criteria to key exploration hints to' };
  }
  const literalRecords = bundle.records.filter((record) => record.kind === 'literal-path' || record.kind === 'directory');
  if (literalRecords.length === 0) {
    return { skip: false, literalNeedCount: 0, highConfidenceCount: 0, share: 0, reason: 'source yields no literal path or directory needs; exploration required' };
  }
  const highConfidenceCount = literalRecords.filter((record) => record.status === 'resolved' && record.confidence === 'high').length;
  const share = highConfidenceCount / literalRecords.length;
  const skip = share >= EXPLORATION_SKIP_HIGH_CONFIDENCE_SHARE;
  const summary = `${highConfidenceCount}/${literalRecords.length} literal source needs resolved with high confidence`;
  return { skip, literalNeedCount: literalRecords.length, highConfidenceCount, share, reason: skip ? `${summary}; exploration skipped` : `${summary}; exploration required` };
}

export type ExplorationDiagnosticReason = LocalizationIssueKind;
