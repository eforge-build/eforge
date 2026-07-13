import { Type, type Static } from '@sinclair/typebox';
import type { PlanningDecompositionLimits } from '@eforge-build/client';
import type { PlanningRescopeDirective } from './atom-graph.js';
import { GENERIC_SURFACE_TERMS, stableSlug } from './source-analysis.js';
import type { SourceInventory } from './source-inventory.js';

/** Lexical labels too generic to indicate a real subsystem boundary. */
export const GENERIC_SCOPE_LABELS: ReadonlySet<string> = new Set([...GENERIC_SURFACE_TERMS, 'general']);

const MAX_JUDGMENT_GROUPS = 12;

export const DecompositionJudgmentSubmissionSchema = Type.Object({
  decision: Type.Union([Type.Literal('cohesive'), Type.Literal('split')]),
  rationale: Type.String({ minLength: 1, maxLength: 2000 }),
  groups: Type.Optional(Type.Array(Type.Object({
    groupKey: Type.String({ minLength: 1, maxLength: 120 }),
    criterionIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
    rationale: Type.String({ minLength: 1, maxLength: 500 }),
  }), { maxItems: MAX_JUDGMENT_GROUPS })),
});

export type DecompositionJudgmentSubmission = Static<typeof DecompositionJudgmentSubmissionSchema>;

export interface CollapsedRootDiversity { diverse: boolean; concreteSubsystemCount: number }

/**
 * Deterministic screen deciding whether a collapsed root warrants a
 * decomposition judgment: the criterion set must span more concrete
 * (non-generic) subsystems than one planning unit allows. Cheap and
 * over-inclusive by design - the split/keep decision itself is the
 * judgment agent's, not this screen's.
 */
export function classifyCollapsedRootDiversity(inventory: SourceInventory, limits: PlanningDecompositionLimits, atomCount: number): CollapsedRootDiversity {
  // A single criterion can never partition into two groups, so a judgment
  // call would be wasted regardless of how many subsystems it names.
  if (atomCount !== 1 || inventory.criteria.length < 2) return { diverse: false, concreteSubsystemCount: 0 };
  const subsystems = new Set(inventory.criteria.flatMap((criterion) => criterion.subsystemHints).filter((hint) => !GENERIC_SCOPE_LABELS.has(hint)));
  return { diverse: subsystems.size > limits.maxSubsystemsPerUnit, concreteSubsystemCount: subsystems.size };
}

export type DecompositionJudgmentValidation =
  | { ok: true; directives: PlanningRescopeDirective[] }
  | { ok: false; problems: string[] };

/**
 * Maps agent-proposed criterion groups onto rescope directives. Fail-closed
 * validation: every group key must carry known criterion ids, every inventory
 * criterion must be assigned exactly once, and at least two groups must
 * remain. Any violation reports problems so the caller can fall back to
 * deterministic grouping.
 */
export function directivesFromJudgmentGroups(inventory: SourceInventory, groups: NonNullable<DecompositionJudgmentSubmission['groups']>): DecompositionJudgmentValidation {
  const problems: string[] = [];
  const knownIds = new Set(inventory.criteria.map((criterion) => criterion.id));
  const assigned = new Map<string, string>();
  // A repeated id within one group is agent sloppiness, not a real conflict —
  // dedupe it; only cross-group double assignment fails the submission.
  const dedupedGroups = groups.map((group) => ({ ...group, criterionIds: [...new Set(group.criterionIds)] }));
  for (const [index, group] of dedupedGroups.entries()) {
    for (const criterionId of group.criterionIds) {
      if (!knownIds.has(criterionId)) problems.push(`group ${index + 1} (${group.groupKey}) references unknown criterion id ${criterionId}`);
      else if (assigned.has(criterionId)) problems.push(`criterion ${criterionId} assigned to both ${assigned.get(criterionId)} and ${group.groupKey}`);
      else assigned.set(criterionId, group.groupKey);
    }
  }
  for (const id of knownIds) if (!assigned.has(id)) problems.push(`criterion ${id} is not assigned to any group`);
  if (dedupedGroups.length < 2) problems.push(`split judgment proposed ${dedupedGroups.length} group(s); at least 2 are required`);
  if (problems.length > 0) return { ok: false, problems };
  // Dedupe on the FINAL directive id, not the bare slug: agent-controlled group
  // keys can slug into another group's slug-plus-suffix, and atom ids derive
  // from directive ids, so uniqueness here is what keeps atom ids unique.
  const usedIds = new Set<string>();
  const directives = dedupedGroups.map((group) => {
    const base = `risk-${stableSlug(group.groupKey)}`;
    let directiveId = base;
    for (let suffix = 2; usedIds.has(directiveId); suffix += 1) directiveId = `${base}-${suffix}`;
    usedIds.add(directiveId);
    return {
      directiveId,
      groupKey: group.groupKey,
      criterionIds: [...group.criterionIds].sort((a, b) => a.localeCompare(b)),
      rationale: `risk split (agent): ${group.rationale}`,
      origin: 'risk-split' as const,
    };
  });
  return { ok: true, directives };
}
