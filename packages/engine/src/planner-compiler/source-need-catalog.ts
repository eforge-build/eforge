import type { SourceLocalizationBundle } from './source-localization-contracts.js';

/** Returns the authoritative source-need catalog for one reduce node. */
export function sourceNeedIdsForReduceNode(
  records: SourceLocalizationBundle['records'] | undefined,
  descendantAtomIds: Set<string>,
  criterionIds: string[],
  aspectIds: string[],
): string[] {
  return (records ?? [])
    .filter((record) => record.assignedAtomIds.length > 0
      ? record.assignedAtomIds.some((atomId) => descendantAtomIds.has(atomId))
      : record.linkedCriterionIds.some((id) => criterionIds.includes(id))
        || record.linkedAspectIds.some((id) => aspectIds.includes(id)))
    .sort((a, b) => sourceNeedPriority(a) - sourceNeedPriority(b) || a.needId.localeCompare(b.needId))
    .map((record) => record.needId);
}

function sourceNeedPriority(record: SourceLocalizationBundle['records'][number]): number {
  return (record.status !== 'resolved' ? 0 : 8) + (record.confidence !== 'high' ? 0 : 4) + (record.kind === 'literal-path' ? 0 : 2) + (record.linkedCriterionIds.length > 0 ? 0 : 1);
}
