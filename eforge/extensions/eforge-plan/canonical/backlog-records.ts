import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import type { BacklogEpic, BacklogItem, BacklogStatus } from '../backlog-domain.js';
import type { BacklogItemRow, BacklogItemUpsert, EforgePlanStore, EpicRow, EpicUpsert, ItemDependencyUpsert, JsonObject, SectionUpsert, UserStatus } from '../sqlite/index.js';
import { getBacklogItem, getEpic, listBacklogItems, listEpics, replaceBacklogItemSections, replaceBacklogItemTags, replaceEpicSections, replaceEpicTags, replaceItemDependencies, upsertBacklogItem, upsertEpic } from '../sqlite/index.js';
import { markEpicDirty, markItemDirty } from './search-dirty.js';
import { canonicalNowIso, canonicalSha256, withCanonicalTransaction } from './store.js';
import { resolveBacklogEpicPath, resolveBacklogItemPath } from '../markdown-store.js';

export interface CanonicalBacklogItemInput {
  id: string;
  title: string;
  body?: string;
  status?: BacklogStatus | UserStatus;
  userStatus?: UserStatus;
  priority?: string;
  source?: string;
  tags?: string[];
  dependsOn?: string[];
  dependencies?: ItemDependencyUpsert[];
  epic?: string | null;
  epicId?: string | null;
  created?: string;
  updated?: string;
  lastCheckedAt?: string;
  staleAfter?: string;
  importOrigin?: string;
  importPath?: string;
  frontmatter?: Record<string, unknown>;
  sections?: SectionUpsert[];
  expectedBodySha256?: string;
  expectedRecordSha256?: string;
  expectedUpdatedAt?: string;
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

export class CanonicalOptimisticLockError extends Error {
  constructor(public readonly token: 'expectedBodySha256' | 'expectedRecordSha256' | 'expectedUpdatedAt') {
    super(`${token} is stale; re-read get-item before retrying update-item.`);
  }
}

export function updateCanonicalBacklogItem(cwd: string, id: string, updates: Partial<CanonicalBacklogItemInput>): BacklogItemRow {
  return withCanonicalTransaction(cwd, (store) => {
    const existing = getBacklogItem(store, id);
    if (!existing) throw new Error(`Backlog item not found: ${id}`);
    assertOptimisticPreconditions(existing, updates);
    return upsertCanonicalBacklogItem(store, {
      id,
      title: updates.title ?? existing.title,
      body: updates.body ?? existing.body,
      status: updates.status ?? updates.userStatus ?? existing.userStatus,
      priority: updates.priority ?? existing.priority,
      source: updates.source ?? existing.source,
      tags: updates.tags,
      dependsOn: updates.dependsOn,
      dependencies: updates.dependencies,
      epic: Object.prototype.hasOwnProperty.call(updates, 'epic') ? updates.epic : existing.epicRef,
      epicId: Object.prototype.hasOwnProperty.call(updates, 'epicId') ? updates.epicId : existing.epicId,
      created: updates.created ?? existing.createdAt,
      updated: updates.updated ?? canonicalNowIso(),
      lastCheckedAt: updates.lastCheckedAt ?? existing.lastCheckedAt,
      staleAfter: updates.staleAfter ?? existing.staleAfter,
      importOrigin: updates.importOrigin ?? existing.importOrigin,
      importPath: updates.importPath ?? existing.importPath,
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
  const source = input.source ?? stringFrontmatter(input.frontmatter?.source) ?? existing?.source;
  const epicRef = Object.prototype.hasOwnProperty.call(input, 'epic') ? input.epic ?? undefined : existing?.epicRef;
  const epicId = Object.prototype.hasOwnProperty.call(input, 'epicId') ? input.epicId ?? undefined : existing?.epicId;
  const createdAt = input.created ?? existing?.createdAt ?? now;
  const updatedAt = input.updated ?? now;
  const lastCheckedAt = input.lastCheckedAt ?? stringFrontmatter(input.frontmatter?.last_checked) ?? existing?.lastCheckedAt;
  const staleAfter = input.staleAfter ?? stringFrontmatter(input.frontmatter?.stale_after) ?? existing?.staleAfter;
  const frontmatter = toJsonObject({ ...(existing?.frontmatter ?? {}), ...(input.frontmatter ?? {}), id: input.id, status: userStatus, priority, ...(source !== undefined && { source }), tags: input.tags ?? existing?.frontmatter.tags ?? [], depends_on: input.dependsOn ?? existing?.frontmatter.depends_on ?? [], epic: epicRef, created: createdAt, updated: updatedAt, ...(lastCheckedAt !== undefined && { last_checked: lastCheckedAt }), ...(staleAfter !== undefined && { stale_after: staleAfter }) });
  const recordShape = canonicalRecordShape({
    id: input.id,
    title: input.title,
    body,
    userStatus,
    priority,
    source,
    createdAt,
    updatedAt,
    lastCheckedAt,
    staleAfter,
    epicRef,
    epicId,
    frontmatter,
    tags: input.tags ?? existing?.frontmatter.tags ?? [],
    dependsOn: input.dependsOn ?? existing?.frontmatter.depends_on ?? [],
    importOrigin: input.importOrigin ?? existing?.importOrigin,
    importPath: input.importPath ?? existing?.importPath,
  });
  const row = upsertBacklogItem(store, {
    id: input.id,
    title: input.title,
    body,
    userStatus,
    priority,
    source,
    createdAt,
    updatedAt,
    lastCheckedAt,
    staleAfter,
    epicRef,
    epicId,
    frontmatter,
    bodySha256: canonicalSha256(body),
    recordSha256: canonicalSha256(JSON.stringify(recordShape)),
    importOrigin: input.importOrigin ?? existing?.importOrigin,
    importPath: input.importPath ?? existing?.importPath,
  } satisfies BacklogItemUpsert);
  if (input.tags) replaceBacklogItemTags(store, input.id, input.tags);
  if (input.sections) replaceBacklogItemSections(store, input.id, input.sections);
  if (input.dependencies ?? input.dependsOn) replaceItemDependencies(store, input.id, normalizeInputDependencies(store, input));
  mirrorBacklogItem(storeCwd(store), input.id, row.frontmatter, body);
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
  mirrorBacklogEpic(storeCwd(store), input.id, row.frontmatter, body);
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

export function canonicalBacklogItemLockHashes(row: { id: string; title: string; body: string; userStatus: UserStatus; priority?: string; source?: string; createdAt?: string; updatedAt?: string; lastCheckedAt?: string; staleAfter?: string; epicRef?: string; epicId?: string; frontmatter: Record<string, unknown>; bodySha256?: string; recordSha256?: string; importOrigin?: string; importPath?: string }): { bodySha256: string; recordSha256: string } {
  const bodySha256 = row.bodySha256 ?? canonicalSha256(row.body);
  const recordShape = canonicalRecordShape({
    id: row.id,
    title: row.title,
    body: row.body,
    userStatus: row.userStatus,
    priority: row.priority,
    source: row.source,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastCheckedAt: row.lastCheckedAt,
    staleAfter: row.staleAfter,
    epicRef: row.epicRef,
    epicId: row.epicId,
    frontmatter: row.frontmatter,
    tags: arrayOfStrings(row.frontmatter.tags),
    dependsOn: arrayOfStrings(row.frontmatter.depends_on),
    importOrigin: row.importOrigin,
    importPath: row.importPath,
  });
  return { bodySha256, recordSha256: row.recordSha256 ?? canonicalSha256(JSON.stringify(recordShape)) };
}

function assertOptimisticPreconditions(existing: BacklogItemRow, updates: Partial<CanonicalBacklogItemInput>): void {
  const hashes = canonicalBacklogItemLockHashes(existing);
  if (updates.expectedBodySha256 !== undefined && updates.expectedBodySha256 !== hashes.bodySha256) throw new CanonicalOptimisticLockError('expectedBodySha256');
  if (updates.expectedRecordSha256 !== undefined && updates.expectedRecordSha256 !== hashes.recordSha256) throw new CanonicalOptimisticLockError('expectedRecordSha256');
  if (updates.expectedUpdatedAt !== undefined && updates.expectedUpdatedAt !== existing.updatedAt) throw new CanonicalOptimisticLockError('expectedUpdatedAt');
}

function normalizeInputDependencies(store: EforgePlanStore, input: CanonicalBacklogItemInput): ItemDependencyUpsert[] {
  const dependencies: ItemDependencyUpsert[] = input.dependencies ?? (input.dependsOn ?? []).map((dependencyRef) => ({ dependencyRef }));
  return dependencies.map((dependency) => {
    if (dependency.dependencyStatus === 'external') return dependency;
    const target = getBacklogItem(store, dependency.resolvedDependencyItemId ?? dependency.dependencyRef);
    if (!target) return dependency;
    return { ...dependency, resolvedDependencyItemId: target.id, dependencyStatus: isClosedDependencyTarget(target.userStatus) ? 'closed' : 'open' };
  });
}

function isClosedDependencyTarget(status: UserStatus): boolean {
  return status === 'shipped' || status === 'stale' || status === 'superseded';
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

function canonicalRecordShape(value: Record<string, unknown>): JsonObject {
  return sortJsonValue(toJsonObject(value)) as JsonObject;
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, sortJsonValue(entry)]));
  }
  return value;
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function objectOrUndefined(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringFrontmatter(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

const ITEM_FRONTMATTER_ORDER = ['id', 'status', 'priority', 'source', 'created', 'updated', 'last_checked', 'stale_after', 'tags', 'depends_on', 'epic', 'eforge_plan'];
const EPIC_FRONTMATTER_ORDER = ['id', 'status', 'priority', 'source', 'created', 'updated', 'last_checked', 'stale_after', 'tags', 'eforge_plan'];

function mirrorBacklogItem(cwd: string, id: string, frontmatter: Record<string, unknown>, body: string): void {
  writeMarkdownMirror(resolveBacklogItemPath(cwd, id), frontmatter, body, ITEM_FRONTMATTER_ORDER);
}

function mirrorBacklogEpic(cwd: string, id: string, frontmatter: Record<string, unknown>, body: string): void {
  writeMarkdownMirror(resolveBacklogEpicPath(cwd, id), frontmatter, body, EPIC_FRONTMATTER_ORDER);
}

function writeMarkdownMirror(path: string, frontmatter: Record<string, unknown>, body: string, order: readonly string[]): void {
  const ordered = Object.fromEntries([...order.filter((key) => frontmatter[key] !== undefined).map((key) => [key, frontmatter[key]]), ...Object.entries(frontmatter).filter(([key, value]) => !order.includes(key) && value !== undefined)]);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `---\n${stringifyYaml(ordered, { lineWidth: 0 }).trimEnd()}\n---\n${body}`);
}

function storeCwd(store: EforgePlanStore): string {
  return resolve(dirname(store.path), '..', '..', '..', '..');
}
