import type { BacklogEpic, BacklogItem, BacklogStatus } from '../backlog-domain.js';
import type { BacklogItemRow, BacklogItemUpsert, EforgePlanStore, EpicRow, EpicUpsert, ItemDependencyUpsert, JsonObject, SectionUpsert, UserStatus } from '../sqlite/index.js';
import { getBacklogItem, getEpic, listBacklogItems, listEpics, replaceBacklogItemSections, replaceBacklogItemTags, replaceEpicSections, replaceEpicTags, replaceItemDependencies, upsertBacklogItem, upsertEpic } from '../sqlite/index.js';
import { markEpicDirty, markItemDirty } from './search-dirty.js';
import { canonicalNowIso, canonicalSha256, withCanonicalTransaction } from './store.js';

export interface CanonicalBacklogItemInput {
  id: string;
  title: string;
  body?: string;
  status?: BacklogStatus | UserStatus;
  userStatus?: UserStatus;
  priority?: string;
  tags?: string[];
  dependsOn?: string[];
  dependencies?: ItemDependencyUpsert[];
  epic?: string | null;
  epicId?: string | null;
  created?: string;
  updated?: string;
  frontmatter?: Record<string, unknown>;
  sections?: SectionUpsert[];
}

export interface CanonicalEpicInput {
  id: string;
  title: string;
  body?: string;
  status?: BacklogStatus | UserStatus;
  userStatus?: UserStatus;
  priority?: string;
  tags?: string[];
  created?: string;
  updated?: string;
  frontmatter?: Record<string, unknown>;
  sections?: SectionUpsert[];
}

export function captureCanonicalBacklogItem(cwd: string, input: CanonicalBacklogItemInput): BacklogItemRow {
  return withCanonicalTransaction(cwd, (store) => upsertCanonicalBacklogItem(store, input));
}

export function updateCanonicalBacklogItem(cwd: string, id: string, updates: Partial<CanonicalBacklogItemInput>): BacklogItemRow {
  return withCanonicalTransaction(cwd, (store) => {
    const existing = getBacklogItem(store, id);
    if (!existing) throw new Error(`Backlog item not found: ${id}`);
    return upsertCanonicalBacklogItem(store, {
      id,
      title: updates.title ?? existing.title,
      body: updates.body ?? existing.body,
      status: updates.status ?? updates.userStatus ?? existing.userStatus,
      priority: updates.priority ?? existing.priority,
      tags: updates.tags,
      dependsOn: updates.dependsOn,
      dependencies: updates.dependencies,
      epic: Object.prototype.hasOwnProperty.call(updates, 'epic') ? updates.epic : existing.epicRef,
      epicId: Object.prototype.hasOwnProperty.call(updates, 'epicId') ? updates.epicId : existing.epicId,
      created: updates.created ?? existing.createdAt,
      updated: updates.updated ?? canonicalNowIso(),
      frontmatter: { ...existing.frontmatter, ...updates.frontmatter },
      sections: updates.sections,
    });
  });
}

export function upsertCanonicalBacklogItem(store: EforgePlanStore, input: CanonicalBacklogItemInput): BacklogItemRow {
  const now = canonicalNowIso();
  const existing = getBacklogItem(store, input.id);
  const body = input.body ?? existing?.body ?? '';
  const userStatus = normalizeUserStatus(input.userStatus ?? input.status ?? existing?.userStatus ?? 'candidate');
  const priority = input.priority ?? existing?.priority;
  const epicRef = Object.prototype.hasOwnProperty.call(input, 'epic') ? input.epic ?? undefined : existing?.epicRef;
  const epicId = Object.prototype.hasOwnProperty.call(input, 'epicId') ? input.epicId ?? undefined : existing?.epicId;
  const createdAt = input.created ?? existing?.createdAt ?? now;
  const updatedAt = input.updated ?? now;
  const row = upsertBacklogItem(store, {
    id: input.id,
    title: input.title,
    body,
    userStatus,
    priority,
    createdAt,
    updatedAt,
    epicRef,
    epicId,
    frontmatter: toJsonObject({ ...(existing?.frontmatter ?? {}), ...(input.frontmatter ?? {}), id: input.id, status: userStatus, priority, tags: input.tags ?? existing?.frontmatter.tags ?? [], depends_on: input.dependsOn ?? existing?.frontmatter.depends_on ?? [], epic: epicRef, created: createdAt, updated: updatedAt }),
    bodySha256: canonicalSha256(body),
    recordSha256: canonicalSha256(JSON.stringify({ id: input.id, title: input.title, body, userStatus, priority, epic: epicRef })),
  } satisfies BacklogItemUpsert);
  if (input.tags) replaceBacklogItemTags(store, input.id, input.tags);
  if (input.sections) replaceBacklogItemSections(store, input.id, input.sections);
  if (input.dependencies ?? input.dependsOn) replaceItemDependencies(store, input.id, input.dependencies ?? (input.dependsOn ?? []).map((dependencyRef) => ({ dependencyRef })));
  markItemDirty(store, input.id);
  if (existing?.epicRef !== epicRef || existing?.epicId !== epicId) for (const epicDocumentId of new Set([existing?.epicRef, existing?.epicId, epicRef, epicId].filter((value): value is string => !!value))) markEpicDirty(store, epicDocumentId);
  return row;
}

export function upsertCanonicalEpic(cwd: string, input: CanonicalEpicInput): EpicRow {
  return withCanonicalTransaction(cwd, (store) => upsertCanonicalEpicRecord(store, input));
}

export function upsertCanonicalEpicRecord(store: EforgePlanStore, input: CanonicalEpicInput): EpicRow {
  const now = canonicalNowIso();
  const existing = getEpic(store, input.id);
  const body = input.body ?? existing?.body ?? '';
  const userStatus = normalizeUserStatus(input.userStatus ?? input.status ?? existing?.userStatus ?? 'candidate');
  const priority = input.priority ?? existing?.priority;
  const createdAt = input.created ?? existing?.createdAt ?? now;
  const updatedAt = input.updated ?? now;
  const row = upsertEpic(store, {
    id: input.id,
    title: input.title,
    body,
    userStatus,
    priority,
    createdAt,
    updatedAt,
    frontmatter: toJsonObject({ ...(existing?.frontmatter ?? {}), ...(input.frontmatter ?? {}), id: input.id, status: userStatus, priority, tags: input.tags ?? existing?.frontmatter.tags ?? [], created: createdAt, updated: updatedAt }),
    bodySha256: canonicalSha256(body),
    recordSha256: canonicalSha256(JSON.stringify({ id: input.id, title: input.title, body, userStatus })),
  } satisfies EpicUpsert);
  if (input.tags) replaceEpicTags(store, input.id, input.tags);
  if (input.sections) replaceEpicSections(store, input.id, input.sections);
  markEpicDirty(store, input.id);
  return row;
}

export function readCanonicalBacklogItem(cwd: string, id: string): BacklogItemRow | undefined {
  return withCanonicalTransaction(cwd, (store) => getBacklogItem(store, id));
}

export function readCanonicalEpic(cwd: string, id: string): EpicRow | undefined {
  return withCanonicalTransaction(cwd, (store) => getEpic(store, id));
}

export function listCanonicalBacklogItems(cwd: string): BacklogItemRow[] {
  return withCanonicalTransaction(cwd, listBacklogItems);
}

export function listCanonicalEpics(cwd: string): EpicRow[] {
  return withCanonicalTransaction(cwd, listEpics);
}

export function backlogItemRowToDomain(row: BacklogItemRow): BacklogItem {
  return { id: row.id, title: row.title, body: row.body, status: row.userStatus as BacklogStatus, priority: row.priority, tags: arrayOfStrings(row.frontmatter.tags), depends_on: arrayOfStrings(row.frontmatter.depends_on), epic: row.epicRef, created: row.createdAt, updated: row.updatedAt, eforge_plan: objectOrUndefined(row.frontmatter.eforge_plan) };
}

export function epicRowToDomain(row: EpicRow): BacklogEpic {
  return { id: row.id, title: row.title, body: row.body, status: row.userStatus as BacklogStatus, priority: row.priority, tags: arrayOfStrings(row.frontmatter.tags), created: row.createdAt, updated: row.updatedAt, eforge_plan: objectOrUndefined(row.frontmatter.eforge_plan) };
}

function normalizeUserStatus(value: string): UserStatus {
  if (value === 'active') return 'active';
  if (value === 'planned') return 'planned';
  if (value === 'shipped') return 'shipped';
  if (value === 'stale') return 'stale';
  if (value === 'superseded') return 'superseded';
  return 'candidate';
}

function toJsonObject(value: Record<string, unknown>): JsonObject {
  return JSON.parse(JSON.stringify(value, (_key, entry) => entry === undefined ? undefined : entry)) as JsonObject;
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function objectOrUndefined(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
