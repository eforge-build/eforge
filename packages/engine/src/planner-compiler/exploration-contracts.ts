import { Type, type Static } from '@sinclair/typebox';
import {
  normalizeSourceLocalizationInputs,
  type SourceLocalizationBundle,
  type SourceLocalizationDiagnostic,
  type SourceLocalizationInputHints,
  type SourceLocalizationNeedKind,
} from './source-localization-contracts.js';

/**
 * Repository exploration hint kinds mirror SourceLocalizationNeedKind so a
 * submission survives normalizeSourceLocalizationInputs unchanged. The
 * `satisfies` clause fails the build if a listed kind drifts from the
 * localization contract.
 */
export const REPOSITORY_EXPLORATION_HINT_KINDS = ['literal-path', 'directory', 'subsystem', 'interface', 'symbol', 'keyword', 'manifest', 'entrypoint', 'docs', 'test', 'config', 'command', 'route', 'api', 'ui', 'extension', 'consumer-surface'] as const satisfies readonly SourceLocalizationNeedKind[];

const boundedString = (maxLength: number): ReturnType<typeof Type.String> => Type.String({ minLength: 1, maxLength });
const hintStringList = () => Type.Optional(Type.Array(boundedString(1_000), { maxItems: 100 }));

export const RepositoryExplorationHintSchema = Type.Object({
  kind: Type.Union(REPOSITORY_EXPLORATION_HINT_KINDS.map((kind) => Type.Literal(kind))),
  query: boundedString(1_000),
  paths: hintStringList(),
  keywords: hintStringList(),
  subsystemHints: hintStringList(),
  interfaceKeys: hintStringList(),
  criterionIds: hintStringList(),
  aspectIds: hintStringList(),
}, { additionalProperties: false });

export const RepositoryExplorationSubmissionSchema = Type.Object({
  projectHints: Type.Array(RepositoryExplorationHintSchema, { maxItems: 100 }),
  notes: Type.Optional(Type.String({ maxLength: 2_000 })),
}, { additionalProperties: false });

export type RepositoryExplorationSubmission = Static<typeof RepositoryExplorationSubmissionSchema>;

export interface ExplorationHintsFromSubmissionResult { hints?: SourceLocalizationInputHints; diagnostics: SourceLocalizationDiagnostic[] }

/**
 * Convert a raw exploration submission into validated localization hints.
 * Invalid entries are dropped individually with diagnostics; the returned
 * hints are already normalized, so re-normalization inside the compiler's
 * localization pass produces no error diagnostics (a malformed payload must
 * degrade to no-hints, never fail the compile).
 */
export function explorationHintsFromSubmission(submission: RepositoryExplorationSubmission): ExplorationHintsFromSubmissionResult {
  const normalized = normalizeSourceLocalizationInputs({ projectHints: submission.projectHints });
  const projectHints = normalized.hints.projectHints ?? [];
  return {
    ...(projectHints.length > 0 ? { hints: { projectHints } } : {}),
    diagnostics: normalized.diagnostics,
  };
}

/**
 * Minimum share of literal-path/directory needs that must already be
 * resolved with high confidence for exploration to be skipped.
 */
export const EXPLORATION_SKIP_HIGH_CONFIDENCE_SHARE = 0.6;

export interface ExplorationSkipDecision { skip: boolean; literalNeedCount: number; highConfidenceCount: number; share: number; reason: string }

/**
 * Skip heuristic for the repository exploration agent. Only literal-path and
 * directory needs count: they are the needs the source can ground directly,
 * and they are the only kinds that can score high-confidence exact matches.
 * Subsystem/keyword/surface needs cap at medium confidence even for detailed
 * PRDs and would defeat the skip if counted. A source with zero acceptance
 * criteria also skips: hints are keyed to criterion/aspect ids, so there is
 * nothing for exploration output to ground.
 */
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
