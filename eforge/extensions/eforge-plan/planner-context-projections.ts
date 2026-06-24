import {
  blockerRiskProjection,
  dependencyProjection,
  extractMarkdownSections,
  type BacklogEpic,
  type BacklogItem,
} from './backlog-domain.js';

export function projectPlannerItem(item: BacklogItem, sourceReference: string | undefined) {
  return {
    id: item.id,
    title: item.title,
    status: item.status,
    ...(item.epic !== undefined && { epic: item.epic }),
    tags: item.tags,
    dependencies: item.depends_on,
    sections: Object.fromEntries(extractMarkdownSections(item.body)),
    sourceReferences: sourceReference ? [sourceReference] : [],
  };
}

export function projectPlannerEpic(epic: BacklogEpic) {
  return {
    id: epic.id,
    title: epic.title,
    status: epic.status,
    tags: epic.tags,
    sections: Object.fromEntries(extractMarkdownSections(epic.body)),
  };
}

export function buildDependencyContext(items: readonly BacklogItem[]) {
  const risks = new Map(blockerRiskProjection(items).map((entry) => [entry.itemId, entry]));
  return dependencyProjection(items).map((entry) => ({
    ...entry,
    blockers: risks.get(entry.itemId)?.blockers ?? [],
    risks: risks.get(entry.itemId)?.risks ?? [],
  }));
}
