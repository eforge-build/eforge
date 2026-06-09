import { BACKLOG_STATUSES, KANBAN_LANES, type BacklogStatus, type KanbanLane } from './schema.js';

export { BACKLOG_STATUSES, KANBAN_LANES, type BacklogStatus, type KanbanLane } from './schema.js';

export interface BacklogFrontmatterBase {
  id: string;
  status: BacklogStatus;
  priority?: string;
  source?: string;
  created?: string;
  updated?: string;
  last_checked?: string;
  stale_after?: string;
  tags: string[];
  eforge_plan?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface BacklogItem extends BacklogFrontmatterBase {
  depends_on: string[];
  epic?: string;
  title: string;
  body: string;
}

export interface BacklogEpic extends BacklogFrontmatterBase {
  title: string;
  body: string;
}

export type LifecycleState = 'none' | 'planned' | 'active' | 'queue' | 'build' | 'pr-open' | 'merged' | 'shipped' | 'failed' | 'partial';

export interface LifecycleLinkRow {
  kind: string;
  stage: string;
  status: string;
  label: string;
  session?: string;
  prdId?: string;
  runId?: string;
  sessionId?: string;
  featureBranch?: string;
  commitSha?: string;
  prUrl?: string;
  path?: string;
  timestamp?: string;
  affectedItemIds: string[];
}

export interface PlanSourceRefs {
  sourceItemIds: string[];
  sourceEpicIds: string[];
  recommendationRef?: string;
  promotedAt?: string;
}

export interface ItemLifecycleProjection {
  itemId: string;
  title: string;
  status: BacklogStatus;
  epic?: string;
  lifecycleState: LifecycleState;
  linkRows: LifecycleLinkRow[];
  failureEvidence: LifecycleLinkRow[];
}

export interface SessionPlanLifecycleProjection {
  sourceRefs: PlanSourceRefs;
  lifecycleState: LifecycleState;
  itemRows: ItemLifecycleProjection[];
  linkRows: LifecycleLinkRow[];
  failureEvidence: LifecycleLinkRow[];
}

export interface EpicProgressProjection {
  epicId: string;
  title: string;
  status: BacklogStatus;
  lifecycleState: LifecycleState;
  countsByBacklogStatus: Record<string, number>;
  countsByLifecycleState: Record<string, number>;
  itemRows: ItemLifecycleProjection[];
}

export interface TraceSummary {
  itemId: string;
  epicId?: string;
  hasActiveSessionPlan: boolean;
  hasActiveQueuePrd: boolean;
  hasActiveBuildRun: boolean;
  hasActiveBuildSession: boolean;
  hasActiveTrace: boolean;
  activeReasons: string[];
  lastEvent?: {
    type?: string;
    timestamp?: string;
    sessionId?: string;
    runId?: string;
    cursor?: number;
  };
  lifecycleState: LifecycleState;
  linkRows: LifecycleLinkRow[];
  prRefs: LifecycleLinkRow[];
  landingRefs: LifecycleLinkRow[];
  failureEvidence: LifecycleLinkRow[];
}

export function isBacklogStatus(value: unknown): value is BacklogStatus {
  return typeof value === 'string' && (BACKLOG_STATUSES as readonly string[]).includes(value);
}

export function assertBacklogStatus(value: unknown): asserts value is BacklogStatus {
  if (!isBacklogStatus(value)) {
    throw new Error(`Invalid backlog status "${String(value)}"`);
  }
}

export function isKanbanLane(value: unknown): value is KanbanLane {
  return typeof value === 'string' && (KANBAN_LANES as readonly string[]).includes(value);
}

export function isClosedStatus(status: BacklogStatus): boolean {
  return status === 'shipped' || status === 'stale' || status === 'superseded';
}

export function isOpenStatus(status: BacklogStatus): boolean {
  return !isClosedStatus(status);
}

export function normalizeStringArray(value: unknown): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
  }
  if (typeof value === 'string' && value.length > 0) {
    return [value];
  }
  return [];
}

export function extractMarkdownTitle(body: string, fallback: string): string {
  const titleLine = body.split(/\r?\n/).find((line) => line.startsWith('# '));
  return titleLine ? titleLine.slice(2).trim() : fallback;
}

export function extractMarkdownSections(body: string): Map<string, string> {
  const sections = new Map<string, string>();
  let currentTitle = '';
  let currentLines: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    const match = /^(#{2,6})\s+(.+)$/.exec(line);
    if (match) {
      if (currentTitle) {
        sections.set(currentTitle, currentLines.join('\n').trim());
      }
      currentTitle = match[2].trim();
      currentLines = [];
    } else if (currentTitle) {
      currentLines.push(line);
    }
  }
  if (currentTitle) {
    sections.set(currentTitle, currentLines.join('\n').trim());
  }
  return sections;
}

export function normalizeBacklogItem(frontmatter: Record<string, unknown>, body: string): BacklogItem {
  assertBacklogStatus(frontmatter.status);
  return {
    ...frontmatter,
    id: requireString(frontmatter.id, 'id'),
    status: frontmatter.status,
    priority: optionalString(frontmatter.priority),
    source: optionalString(frontmatter.source),
    created: optionalString(frontmatter.created),
    updated: optionalString(frontmatter.updated),
    last_checked: optionalString(frontmatter.last_checked),
    stale_after: optionalString(frontmatter.stale_after),
    tags: normalizeStringArray(frontmatter.tags),
    depends_on: normalizeStringArray(frontmatter.depends_on),
    epic: optionalString(frontmatter.epic),
    eforge_plan: optionalObject(frontmatter.eforge_plan),
    title: extractMarkdownTitle(body, requireString(frontmatter.id, 'id')),
    body,
  };
}

export function normalizeBacklogEpic(frontmatter: Record<string, unknown>, body: string): BacklogEpic {
  assertBacklogStatus(frontmatter.status);
  return {
    ...frontmatter,
    id: requireString(frontmatter.id, 'id'),
    status: frontmatter.status,
    priority: optionalString(frontmatter.priority),
    source: optionalString(frontmatter.source),
    created: optionalString(frontmatter.created),
    updated: optionalString(frontmatter.updated),
    last_checked: optionalString(frontmatter.last_checked),
    stale_after: optionalString(frontmatter.stale_after),
    tags: normalizeStringArray(frontmatter.tags),
    eforge_plan: optionalObject(frontmatter.eforge_plan),
    title: extractMarkdownTitle(body, requireString(frontmatter.id, 'id')),
    body,
  };
}

export function unresolvedDependencies(item: BacklogItem, items: readonly BacklogItem[]): string[] {
  const byId = new Map(items.map((candidate) => [candidate.id, candidate]));
  return item.depends_on.filter((dependencyId) => {
    const dependency = byId.get(dependencyId);
    return !dependency || !isClosedStatus(dependency.status);
  });
}

export function summarizeTraceActivity(summary: TraceSummary | undefined): string[] {
  return summary?.activeReasons ?? [];
}

export interface SourceItemSummary {
  id: string;
  title: string;
  status: BacklogStatus;
  epic?: string;
  dependsOn: string[];
}

export interface SourceEpicSummary {
  id: string;
  title: string;
  status: BacklogStatus;
}

export interface DependencyProjection {
  itemId: string;
  dependsOn: string[];
  internalDependsOn: string[];
  externalDependsOn: string[];
}

export interface RiskProjection {
  itemId: string;
  blockers: string[];
  risks: string[];
}

export function itemsForEpic(items: readonly BacklogItem[], epicId: string): BacklogItem[] {
  return items.filter((item) => item.epic === epicId && isOpenStatus(item.status));
}

export function selectedSourceSummaries(items: readonly BacklogItem[]): SourceItemSummary[] {
  return items.map((item) => ({
    id: item.id,
    title: item.title,
    status: item.status,
    ...(item.epic !== undefined && { epic: item.epic }),
    dependsOn: item.depends_on,
  }));
}

export function selectedEpicSummaries(epics: readonly BacklogEpic[]): SourceEpicSummary[] {
  return epics.map((epic) => ({ id: epic.id, title: epic.title, status: epic.status }));
}

export function dependencyProjection(items: readonly BacklogItem[]): DependencyProjection[] {
  const selectedIds = new Set(items.map((item) => item.id));
  return items.map((item) => ({
    itemId: item.id,
    dependsOn: item.depends_on,
    internalDependsOn: item.depends_on.filter((id) => selectedIds.has(id)),
    externalDependsOn: item.depends_on.filter((id) => !selectedIds.has(id)),
  }));
}

export function blockerRiskProjection(items: readonly BacklogItem[]): RiskProjection[] {
  return items.map((item) => {
    const sections = extractMarkdownSections(item.body);
    return {
      itemId: item.id,
      blockers: linesFromSection(firstAvailableSection(sections, ['Blockers', 'Blocked By'])),
      risks: linesFromSection(firstAvailableSection(sections, ['Risks', 'Risk Notes'])),
    };
  });
}

export function orderedSourceReferenceSummaries(items: readonly BacklogItem[], epics: readonly BacklogEpic[]): string[] {
  return [
    ...items.map((item, index) => `${index + 1}. backlog item ${item.id}: ${item.title}`),
    ...epics.map((epic, index) => `${items.length + index + 1}. epic ${epic.id}: ${epic.title}`),
  ];
}

export function sortItemsDependencyBeforeDependent(items: readonly BacklogItem[]): BacklogItem[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const sortedIds = [...byId.keys()].sort();
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const result: BacklogItem[] = [];
  const visit = (id: string): void => {
    if (visited.has(id) || visiting.has(id)) return;
    visiting.add(id);
    const item = byId.get(id);
    for (const dependencyId of item?.depends_on ?? []) {
      if (byId.has(dependencyId)) visit(dependencyId);
    }
    visiting.delete(id);
    visited.add(id);
    if (item) result.push(item);
  };
  for (const id of sortedIds) visit(id);
  return result;
}

function firstAvailableSection(sections: Map<string, string>, names: string[]): string {
  for (const name of names) {
    const value = sections.get(name);
    if (value && value.trim().length > 0) return value.trim();
  }
  return '';
}

function linesFromSection(section: string): string[] {
  return section.split(/\r?\n/).map((line) => line.replace(/^[-*]\s+/, '').trim()).filter((line) => line.length > 0);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Backlog frontmatter field "${field}" must be a non-empty string`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function optionalObject(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}
