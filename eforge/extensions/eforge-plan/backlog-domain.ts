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
