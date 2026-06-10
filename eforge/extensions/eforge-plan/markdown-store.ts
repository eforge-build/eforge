import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { createEforgeProjectPaths } from '../../../packages/extension-sdk/src/index.js';
import {
  normalizeBacklogEpic,
  normalizeBacklogItem,
  type BacklogEpic,
  type BacklogItem,
} from './backlog-domain.js';
import {
  assertSafeBacklogId,
  canonicalJson,
  dropUndefined,
  orderFrontmatter,
  resolveContainedPath,
  safeId,
  sha256,
  toProjectRelativePath,
  toRecord,
} from './markdown-store-support.js';

const ITEM_FRONTMATTER_ORDER = [
  'id',
  'status',
  'priority',
  'source',
  'created',
  'updated',
  'last_checked',
  'stale_after',
  'tags',
  'depends_on',
  'epic',
  'eforge_plan',
];

const EPIC_FRONTMATTER_ORDER = [
  'id',
  'status',
  'priority',
  'source',
  'created',
  'updated',
  'last_checked',
  'stale_after',
  'tags',
  'eforge_plan',
];

export type BacklogStorageOrigin = 'private' | 'legacy';
export type BacklogRecordKind = 'item' | 'epic';

export interface ParsedMarkdownRecord {
  frontmatter: Record<string, unknown>;
  body: string;
}

export interface BacklogRecordSnapshot<T> {
  kind: BacklogRecordKind;
  origin: BacklogStorageOrigin;
  id: string;
  path: string;
  relativePath: string;
  record: T;
  frontmatter: Record<string, unknown>;
  body: string;
  updated?: string;
  bodySha256: string;
  recordSha256: string;
}

export interface BacklogItemWrite {
  id: BacklogItem['id'];
  status: BacklogItem['status'];
  priority?: string;
  source?: string;
  created?: string;
  updated?: string;
  last_checked?: string;
  stale_after?: string;
  tags?: string[];
  depends_on?: string[];
  epic?: string;
  eforge_plan?: Record<string, unknown>;
  body?: string;
  [key: string]: unknown;
}

export interface BacklogEpicWrite {
  id: BacklogEpic['id'];
  status: BacklogEpic['status'];
  priority?: string;
  source?: string;
  created?: string;
  updated?: string;
  last_checked?: string;
  stale_after?: string;
  tags?: string[];
  eforge_plan?: Record<string, unknown>;
  body?: string;
  [key: string]: unknown;
}

export interface BacklogImportResult {
  schemaVersion: 1;
  items: BacklogImportKindResult;
  epics: BacklogImportKindResult;
}

export interface BacklogImportKindResult {
  copied: Array<{ id: string; path: string }>;
  skipped: Array<{ id: string; reason: 'private-exists' }>;
}

// --- eforge:region backlog-storage-paths ---

export { assertSafeBacklogId } from './markdown-store-support.js';

export function resolveBacklogItemPath(cwd: string, id: string): string {
  return privateRecordPath(cwd, 'item', id);
}

export function resolveBacklogEpicPath(cwd: string, id: string): string {
  return privateRecordPath(cwd, 'epic', id);
}

export function resolveLegacyBacklogItemPath(cwd: string, id: string): string {
  return resolveContainedPath(resolve(cwd, '.backlog', 'items'), `${safeId(id)}.md`);
}

export function resolveLegacyBacklogEpicPath(cwd: string, id: string): string {
  return resolveContainedPath(resolve(cwd, '.backlog', 'epics'), `${safeId(id)}.md`);
}

export function resolveBacklogItemRelativePath(cwd: string, id: string): string {
  return toProjectRelativePath(cwd, resolveBacklogItemPath(cwd, id));
}

export function resolveBacklogEpicRelativePath(cwd: string, id: string): string {
  return toProjectRelativePath(cwd, resolveBacklogEpicPath(cwd, id));
}

// --- eforge:endregion backlog-storage-paths ---

// --- eforge:region markdown-parse-serialize ---

export function parseMarkdownRecord(raw: string): ParsedMarkdownRecord {
  if (!raw.startsWith('---')) {
    return { frontmatter: {}, body: raw };
  }
  const normalized = raw.replace(/^---\r?\n/, '---\n');
  const closing = normalized.indexOf('\n---', 4);
  if (closing === -1) {
    return { frontmatter: {}, body: raw };
  }
  const yamlText = normalized.slice(4, closing);
  const afterFence = normalized.slice(closing).replace(/^\n---\r?\n?/, '');
  const parsed = parseYaml(yamlText) as unknown;
  return { frontmatter: toRecord(parsed), body: afterFence };
}

export function serializeMarkdownRecord(
  frontmatter: Record<string, unknown>,
  body: string,
  knownOrder: readonly string[],
): string {
  const ordered = orderFrontmatter(frontmatter, knownOrder);
  const yaml = stringifyYaml(ordered, { lineWidth: 0 }).trimEnd();
  return `---\n${yaml}\n---\n${body}`;
}

// --- eforge:endregion markdown-parse-serialize ---

// --- eforge:region backlog-storage-read-list ---

export async function readBacklogItem(cwd: string, id: string): Promise<BacklogItem | null> {
  return (await readBacklogItemSnapshot(cwd, id))?.record ?? null;
}

export async function readBacklogEpic(cwd: string, id: string): Promise<BacklogEpic | null> {
  return (await readBacklogEpicSnapshot(cwd, id))?.record ?? null;
}

export async function readBacklogItemSnapshot(cwd: string, id: string): Promise<BacklogRecordSnapshot<BacklogItem> | null> {
  return readVisibleSnapshot(cwd, 'item', id, parseItem);
}

export async function readBacklogEpicSnapshot(cwd: string, id: string): Promise<BacklogRecordSnapshot<BacklogEpic> | null> {
  return readVisibleSnapshot(cwd, 'epic', id, parseEpic);
}

export async function listBacklogItems(cwd: string): Promise<BacklogItem[]> {
  return (await listBacklogItemSnapshots(cwd)).map((snapshot) => snapshot.record);
}

export async function listBacklogEpics(cwd: string): Promise<BacklogEpic[]> {
  return (await listBacklogEpicSnapshots(cwd)).map((snapshot) => snapshot.record);
}

export async function listBacklogItemSnapshots(cwd: string): Promise<Array<BacklogRecordSnapshot<BacklogItem>>> {
  return listVisibleSnapshots(cwd, 'item', parseItem);
}

export async function listBacklogEpicSnapshots(cwd: string): Promise<Array<BacklogRecordSnapshot<BacklogEpic>>> {
  return listVisibleSnapshots(cwd, 'epic', parseEpic);
}

export const loadBacklogItems = listBacklogItems;
export const loadBacklogEpics = listBacklogEpics;

// --- eforge:endregion backlog-storage-read-list ---

// --- eforge:region backlog-storage-write-import ---

export async function writeBacklogItem(cwd: string, item: BacklogItemWrite): Promise<BacklogItem> {
  const existing = await readExistingParsedForWrite(cwd, 'item', item.id);
  const body = item.body ?? existing?.body ?? `# ${item.id}\n`;
  const frontmatter = { ...(existing?.frontmatter ?? {}), ...frontmatterFromWrite(item) };
  const normalized = normalizeBacklogItem(frontmatter, body);
  assertRecordIdMatches(item.id, normalized.id, resolveBacklogItemPath(cwd, item.id));
  const filePath = resolveBacklogItemPath(cwd, item.id);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, serializeMarkdownRecord(frontmatter, body, ITEM_FRONTMATTER_ORDER));
  return parseItem(await readFile(filePath, 'utf-8'));
}

export async function writeBacklogEpic(cwd: string, epic: BacklogEpicWrite): Promise<BacklogEpic> {
  const existing = await readExistingParsedForWrite(cwd, 'epic', epic.id);
  const body = epic.body ?? existing?.body ?? `# ${epic.id}\n`;
  const frontmatter = { ...(existing?.frontmatter ?? {}), ...frontmatterFromWrite(epic) };
  const normalized = normalizeBacklogEpic(frontmatter, body);
  assertRecordIdMatches(epic.id, normalized.id, resolveBacklogEpicPath(cwd, epic.id));
  const filePath = resolveBacklogEpicPath(cwd, epic.id);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, serializeMarkdownRecord(frontmatter, body, EPIC_FRONTMATTER_ORDER));
  return parseEpic(await readFile(filePath, 'utf-8'));
}

export async function updateBacklogItemFrontmatter(
  cwd: string,
  id: string,
  updates: Record<string, unknown>,
): Promise<BacklogItem> {
  const current = await readRequiredVisibleParsed(cwd, 'item', id, parseItem);
  const frontmatter = { ...current.frontmatter, ...updates, id };
  normalizeBacklogItem(frontmatter, current.body);
  const filePath = resolveBacklogItemPath(cwd, id);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, serializeMarkdownRecord(frontmatter, current.body, ITEM_FRONTMATTER_ORDER));
  return parseItem(await readFile(filePath, 'utf-8'));
}

export async function updateBacklogEpicFrontmatter(
  cwd: string,
  id: string,
  updates: Record<string, unknown>,
): Promise<BacklogEpic> {
  const current = await readRequiredVisibleParsed(cwd, 'epic', id, parseEpic);
  const frontmatter = { ...current.frontmatter, ...updates, id };
  normalizeBacklogEpic(frontmatter, current.body);
  const filePath = resolveBacklogEpicPath(cwd, id);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, serializeMarkdownRecord(frontmatter, current.body, EPIC_FRONTMATTER_ORDER));
  return parseEpic(await readFile(filePath, 'utf-8'));
}

export async function importLegacyBacklogItems(cwd: string, ids?: string[]): Promise<BacklogImportKindResult> {
  return importLegacyKind(cwd, 'item', parseItem, ids);
}

export async function importLegacyBacklogEpics(cwd: string, ids?: string[]): Promise<BacklogImportKindResult> {
  return importLegacyKind(cwd, 'epic', parseEpic, ids);
}

export async function importLegacyBacklog(
  cwd: string,
  input: { kind?: 'items' | 'epics' | 'all'; ids?: string[] },
): Promise<BacklogImportResult> {
  const kind = input.kind ?? 'all';
  if (kind === 'all' && input.ids !== undefined) {
    throw new Error('Legacy backlog import ids may only be used with kind "items" or "epics".');
  }
  const itemsPlan = kind === 'epics' ? emptyImportKindPlan() : await planLegacyKindImport(cwd, 'item', parseItem, input.ids);
  const epicsPlan = kind === 'items' ? emptyImportKindPlan() : await planLegacyKindImport(cwd, 'epic', parseEpic, input.ids);
  return {
    schemaVersion: 1,
    items: await copyLegacyImportPlan(cwd, itemsPlan),
    epics: await copyLegacyImportPlan(cwd, epicsPlan),
  };
}

// --- eforge:endregion backlog-storage-write-import ---

function parseItem(raw: string): BacklogItem {
  const parsed = parseMarkdownRecord(raw);
  return normalizeBacklogItem(parsed.frontmatter, parsed.body);
}

function parseEpic(raw: string): BacklogEpic {
  const parsed = parseMarkdownRecord(raw);
  return normalizeBacklogEpic(parsed.frontmatter, parsed.body);
}

async function readVisibleSnapshot<T extends BacklogItem | BacklogEpic>(
  cwd: string,
  kind: BacklogRecordKind,
  id: string,
  parser: (raw: string) => T,
): Promise<BacklogRecordSnapshot<T> | null> {
  assertSafeBacklogId(id);
  const privatePath = recordPath(cwd, kind, 'private', id);
  if (existsSync(privatePath)) return readSnapshot(cwd, kind, 'private', id, privatePath, parser);
  const legacyPath = recordPath(cwd, kind, 'legacy', id);
  return existsSync(legacyPath) ? readSnapshot(cwd, kind, 'legacy', id, legacyPath, parser) : null;
}

async function listVisibleSnapshots<T extends BacklogItem | BacklogEpic>(
  cwd: string,
  kind: BacklogRecordKind,
  parser: (raw: string) => T,
): Promise<Array<BacklogRecordSnapshot<T>>> {
  const privateSnapshots = await listOriginSnapshots(cwd, kind, 'private', parser);
  const privateIds = new Set(privateSnapshots.map((snapshot) => snapshot.id));
  const legacySnapshots = (await listOriginSnapshots(cwd, kind, 'legacy', parser)).filter((snapshot) => !privateIds.has(snapshot.id));
  return [...privateSnapshots, ...legacySnapshots].sort((left, right) => left.id.localeCompare(right.id));
}

async function listOriginSnapshots<T extends BacklogItem | BacklogEpic>(
  cwd: string,
  kind: BacklogRecordKind,
  origin: BacklogStorageOrigin,
  parser: (raw: string) => T,
): Promise<Array<BacklogRecordSnapshot<T>>> {
  const root = recordRoot(cwd, kind, origin);
  if (!existsSync(root)) return [];
  const names = (await readdir(root)).filter((name) => name.endsWith('.md')).sort();
  return Promise.all(names.map(async (name) => {
    const id = name.slice(0, -'.md'.length);
    assertSafeBacklogId(id);
    return readSnapshot(cwd, kind, origin, id, recordPathForName(cwd, kind, origin, name), parser);
  }));
}

async function readSnapshot<T extends BacklogItem | BacklogEpic>(
  cwd: string,
  kind: BacklogRecordKind,
  origin: BacklogStorageOrigin,
  expectedId: string,
  filePath: string,
  parser: (raw: string) => T,
): Promise<BacklogRecordSnapshot<T>> {
  const rawContent = await readFile(filePath);
  return createSnapshotFromRawContent(cwd, kind, origin, expectedId, filePath, parser, rawContent);
}

function createSnapshotFromRawContent<T extends BacklogItem | BacklogEpic>(
  cwd: string,
  kind: BacklogRecordKind,
  origin: BacklogStorageOrigin,
  expectedId: string,
  filePath: string,
  parser: (raw: string) => T,
  rawContent: Buffer,
): BacklogRecordSnapshot<T> {
  const raw = rawContent.toString('utf-8');
  const parsed = parseMarkdownRecord(raw);
  const record = parser(raw);
  assertRecordIdMatches(expectedId, record.id, filePath);
  return createSnapshot(cwd, kind, origin, filePath, record, parsed);
}

function createSnapshot<T extends BacklogItem | BacklogEpic>(
  cwd: string,
  kind: BacklogRecordKind,
  origin: BacklogStorageOrigin,
  filePath: string,
  record: T,
  parsed: ParsedMarkdownRecord,
): BacklogRecordSnapshot<T> {
  return {
    kind,
    origin,
    id: record.id,
    path: filePath,
    relativePath: toProjectRelativePath(cwd, filePath),
    record,
    frontmatter: parsed.frontmatter,
    body: parsed.body,
    updated: typeof record.updated === 'string' ? record.updated : undefined,
    bodySha256: sha256(parsed.body),
    recordSha256: sha256(canonicalJson({ frontmatter: parsed.frontmatter, body: parsed.body })),
  };
}

async function readExistingParsedForWrite(cwd: string, kind: BacklogRecordKind, id: string): Promise<ParsedMarkdownRecord | undefined> {
  const snapshot = await readVisibleSnapshot(cwd, kind, id, kind === 'item' ? parseItem : parseEpic);
  return snapshot ? { frontmatter: snapshot.frontmatter, body: snapshot.body } : undefined;
}

async function readRequiredVisibleParsed<T extends BacklogItem | BacklogEpic>(
  cwd: string,
  kind: BacklogRecordKind,
  id: string,
  parser: (raw: string) => T,
): Promise<ParsedMarkdownRecord> {
  const snapshot = await readVisibleSnapshot(cwd, kind, id, parser);
  if (!snapshot) {
    throw new Error(`Backlog record not found: ${recordPath(cwd, kind, 'private', id)}`);
  }
  return { frontmatter: snapshot.frontmatter, body: snapshot.body };
}

interface BacklogImportKindPlan {
  copy: Array<{ id: string; sourcePath: string; privatePath: string }>;
  skipped: BacklogImportKindResult['skipped'];
}

async function importLegacyKind<T extends BacklogItem | BacklogEpic>(
  cwd: string,
  kind: BacklogRecordKind,
  parser: (raw: string) => T,
  ids?: string[],
): Promise<BacklogImportKindResult> {
  return copyLegacyImportPlan(cwd, await planLegacyKindImport(cwd, kind, parser, ids));
}

async function planLegacyKindImport<T extends BacklogItem | BacklogEpic>(
  cwd: string,
  kind: BacklogRecordKind,
  parser: (raw: string) => T,
  ids?: string[],
): Promise<BacklogImportKindPlan> {
  const candidates = ids === undefined
    ? await listOriginSnapshots(cwd, kind, 'legacy', parser)
    : await Promise.all([...new Set(ids)].map(async (id) => {
      assertSafeBacklogId(id);
      return readSnapshot(cwd, kind, 'legacy', id, recordPath(cwd, kind, 'legacy', id), parser);
    }));
  const copy: BacklogImportKindPlan['copy'] = [];
  const skipped: BacklogImportKindPlan['skipped'] = [];
  for (const candidate of candidates.sort((left, right) => left.id.localeCompare(right.id))) {
    const privatePath = recordPath(cwd, kind, 'private', candidate.id);
    if (existsSync(privatePath)) {
      skipped.push({ id: candidate.id, reason: 'private-exists' });
      continue;
    }
    copy.push({ id: candidate.id, sourcePath: candidate.path, privatePath });
  }
  return { copy, skipped };
}

async function copyLegacyImportPlan(cwd: string, plan: BacklogImportKindPlan): Promise<BacklogImportKindResult> {
  const copied: BacklogImportKindResult['copied'] = [];
  for (const candidate of plan.copy) {
    await mkdir(dirname(candidate.privatePath), { recursive: true });
    await copyFile(candidate.sourcePath, candidate.privatePath);
    copied.push({ id: candidate.id, path: toProjectRelativePath(cwd, candidate.privatePath) });
  }
  return { copied, skipped: plan.skipped };
}

function emptyImportKindPlan(): BacklogImportKindPlan {
  return { copy: [], skipped: [] };
}

function recordRoot(cwd: string, kind: BacklogRecordKind, origin: BacklogStorageOrigin): string {
  if (origin === 'legacy') return resolve(cwd, '.backlog', kind === 'item' ? 'items' : 'epics');
  const paths = createEforgeProjectPaths({ cwd, extensionName: 'eforge-plan' });
  return paths.extensionStoragePath('project-local', ['backlog', kind === 'item' ? 'items' : 'epics']);
}

function recordPath(cwd: string, kind: BacklogRecordKind, origin: BacklogStorageOrigin, id: string): string {
  return recordPathForName(cwd, kind, origin, `${safeId(id)}.md`);
}

function recordPathForName(cwd: string, kind: BacklogRecordKind, origin: BacklogStorageOrigin, name: string): string {
  if (origin === 'legacy') return resolveContainedPath(recordRoot(cwd, kind, origin), name);
  const paths = createEforgeProjectPaths({ cwd, extensionName: 'eforge-plan' });
  const root = recordRoot(cwd, kind, origin);
  const filePath = paths.extensionStoragePath('project-local', ['backlog', kind === 'item' ? 'items' : 'epics', name]);
  assertContained(root, filePath);
  return filePath;
}

function privateRecordPath(cwd: string, kind: BacklogRecordKind, id: string): string {
  return recordPath(cwd, kind, 'private', id);
}

function assertContained(root: string, filePath: string): void {
  const rel = relative(root, filePath);
  if (rel === '' || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) {
    throw new Error(`Resolved backlog path "${filePath}" escapes ${root}${sep}`);
  }
}

function assertRecordIdMatches(expectedId: string, actualId: string, filePath: string): void {
  assertSafeBacklogId(actualId);
  if (actualId !== expectedId) {
    throw new Error(`Backlog record id mismatch in ${filePath}: frontmatter id "${actualId}" does not match filename id "${expectedId}"`);
  }
}

function frontmatterFromWrite(record: BacklogItemWrite | BacklogEpicWrite): Record<string, unknown> {
  const { body: _body, title: _title, ...frontmatter } = record as Record<string, unknown>;
  return dropUndefined(frontmatter);
}

