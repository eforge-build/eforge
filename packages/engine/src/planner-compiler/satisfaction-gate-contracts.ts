import { Type, type Static } from '@sinclair/typebox';
import type { SourceInventory } from './source-inventory.js';

const boundedString = (maxLength: number): ReturnType<typeof Type.String> => Type.String({ minLength: 1, maxLength });

export const SatisfactionVerdictSchema = Type.Object({
  criterionId: boundedString(160),
  satisfied: Type.Boolean(),
  evidencePaths: Type.Array(boundedString(1_000), { maxItems: 16 }),
  explanation: boundedString(2_000),
}, { additionalProperties: false });

export const SatisfactionGateSubmissionSchema = Type.Object({
  alreadySatisfied: Type.Boolean(),
  reason: boundedString(2_000),
  verdicts: Type.Array(SatisfactionVerdictSchema, { maxItems: 200 }),
}, { additionalProperties: false });

export type SatisfactionGateSubmission = Static<typeof SatisfactionGateSubmissionSchema>;

export interface PlanningSatisfactionSkipDecision { skip: boolean; reason: string }

/**
 * Conservative, deterministic verdict over the gate agent's submission. A
 * false skip silently drops requested work while a false build only costs a
 * planning pass, so every hole in the submission resolves to "build": the
 * agent must claim full satisfaction, cover every inventory criterion with a
 * satisfied verdict, and ground each verdict in repository paths that
 * actually exist.
 */
export function decidePlanningSatisfactionSkip(
  inventory: SourceInventory,
  submission: SatisfactionGateSubmission | undefined,
  pathExists: (path: string) => boolean,
): PlanningSatisfactionSkipDecision {
  if (inventory.criteria.length === 0) return { skip: false, reason: 'source has no acceptance criteria to verify against the repository' };
  if (!submission) return { skip: false, reason: 'satisfaction gate produced no submission' };
  if (!submission.alreadySatisfied) return { skip: false, reason: submission.reason };
  const verdictsByCriterionId = new Map(submission.verdicts.map((verdict) => [verdict.criterionId, verdict]));
  for (const criterion of inventory.criteria) {
    const verdict = verdictsByCriterionId.get(criterion.id);
    if (!verdict) return { skip: false, reason: `criterion ${criterion.id} has no satisfaction verdict` };
    if (!verdict.satisfied) return { skip: false, reason: `criterion ${criterion.id} is not satisfied: ${verdict.explanation}` };
    if (verdict.evidencePaths.length === 0) return { skip: false, reason: `criterion ${criterion.id} verdict cites no evidence paths` };
    for (const path of verdict.evidencePaths) {
      if (!isRepoRelativePath(path)) return { skip: false, reason: `criterion ${criterion.id} cites a non-repository-relative evidence path: ${path}` };
      if (!pathExists(path)) return { skip: false, reason: `criterion ${criterion.id} cites a nonexistent evidence path: ${path}` };
    }
  }
  return { skip: true, reason: submission.reason };
}

function isRepoRelativePath(path: string): boolean {
  return !path.startsWith('/') && !/^[A-Za-z]:/.test(path) && !path.split('/').includes('..') && !path.includes('\\');
}
