import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep, win32 } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import {
  normalizeBacklogEpic,
  normalizeBacklogItem,
  type BacklogEpic,
  type BacklogItem,
} from './backlog-domain.js';

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

export interface ParsedMarkdownRecord {
  frontmatter: Record<string, unknown>;
  body: string;
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

export function assertSafeBacklogId(id: string): void {
  if (id.length === 0) {
    throw new Error('Backlog id must not be empty');
  }
  if (id === '.' || id === '..') {
    throw new Error(`Unsafe backlog id "${id}": traversal segments are not allowed`);
  }
  if (id.includes('\0')) {
    throw new Error('Unsafe backlog id: null bytes are not allowed');
  }
  if (id.includes('/') || id.includes('\\')) {
    throw new Error(`Unsafe backlog id "${id}": path separators are not allowed`);
  }
  if (isAbsolute(id) || win32.isAbsolute(id)) {
    throw new Error(`Unsafe backlog id "${id}": absolute paths are not allowed`);
  }
}

export function resolveBacklogItemPath(cwd: string, id: string): string {
  return resolveContainedPath(resolve(cwd, '.backlog', 'items'), `${safeId(id)}.md`);
}

export function resolveBacklogEpicPath(cwd: string, id: string): string {
  return resolveContainedPath(resolve(cwd, '.backlog', 'epics'), `${safeId(id)}.md`);
}

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

export async function readBacklogItem(cwd: string, id: string): Promise<BacklogItem | null> {
  const filePath = resolveBacklogItemPath(cwd, id);
  if (!existsSync(filePath)) {
    return null;
  }
  return parseItem(await readFile(filePath, 'utf-8'));
}

export async function readBacklogEpic(cwd: string, id: string): Promise<BacklogEpic | null> {
  const filePath = resolveBacklogEpicPath(cwd, id);
  if (!existsSync(filePath)) {
    return null;
  }
  return parseEpic(await readFile(filePath, 'utf-8'));
}

export async function listBacklogItems(cwd: string): Promise<BacklogItem[]> {
  return listMarkdownRecords(resolve(cwd, '.backlog', 'items'), parseItem);
}

export async function listBacklogEpics(cwd: string): Promise<BacklogEpic[]> {
  return listMarkdownRecords(resolve(cwd, '.backlog', 'epics'), parseEpic);
}

export const loadBacklogItems = listBacklogItems;
export const loadBacklogEpics = listBacklogEpics;

export async function writeBacklogItem(cwd: string, item: BacklogItemWrite): Promise<BacklogItem> {
  const filePath = resolveBacklogItemPath(cwd, item.id);
  const existing = existsSync(filePath) ? parseMarkdownRecord(await readFile(filePath, 'utf-8')) : undefined;
  const body = item.body ?? existing?.body ?? `# ${item.id}\n`;
  const frontmatter = { ...(existing?.frontmatter ?? {}), ...frontmatterFromWrite(item) };
  normalizeBacklogItem(frontmatter, body);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, serializeMarkdownRecord(frontmatter, body, ITEM_FRONTMATTER_ORDER));
  return parseItem(await readFile(filePath, 'utf-8'));
}

export async function writeBacklogEpic(cwd: string, epic: BacklogEpicWrite): Promise<BacklogEpic> {
  const filePath = resolveBacklogEpicPath(cwd, epic.id);
  const existing = existsSync(filePath) ? parseMarkdownRecord(await readFile(filePath, 'utf-8')) : undefined;
  const body = epic.body ?? existing?.body ?? `# ${epic.id}\n`;
  const frontmatter = { ...(existing?.frontmatter ?? {}), ...frontmatterFromWrite(epic) };
  normalizeBacklogEpic(frontmatter, body);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, serializeMarkdownRecord(frontmatter, body, EPIC_FRONTMATTER_ORDER));
  return parseEpic(await readFile(filePath, 'utf-8'));
}

export async function updateBacklogItemFrontmatter(
  cwd: string,
  id: string,
  updates: Record<string, unknown>,
): Promise<BacklogItem> {
  const current = await readRequiredRecord(resolveBacklogItemPath(cwd, id));
  const frontmatter = { ...current.frontmatter, ...updates, id };
  normalizeBacklogItem(frontmatter, current.body);
  await writeFile(resolveBacklogItemPath(cwd, id), serializeMarkdownRecord(frontmatter, current.body, ITEM_FRONTMATTER_ORDER));
  return parseItem(await readFile(resolveBacklogItemPath(cwd, id), 'utf-8'));
}

export async function updateBacklogEpicFrontmatter(
  cwd: string,
  id: string,
  updates: Record<string, unknown>,
): Promise<BacklogEpic> {
  const current = await readRequiredRecord(resolveBacklogEpicPath(cwd, id));
  const frontmatter = { ...current.frontmatter, ...updates, id };
  normalizeBacklogEpic(frontmatter, current.body);
  await writeFile(resolveBacklogEpicPath(cwd, id), serializeMarkdownRecord(frontmatter, current.body, EPIC_FRONTMATTER_ORDER));
  return parseEpic(await readFile(resolveBacklogEpicPath(cwd, id), 'utf-8'));
}

function parseItem(raw: string): BacklogItem {
  const parsed = parseMarkdownRecord(raw);
  return normalizeBacklogItem(parsed.frontmatter, parsed.body);
}

function parseEpic(raw: string): BacklogEpic {
  const parsed = parseMarkdownRecord(raw);
  return normalizeBacklogEpic(parsed.frontmatter, parsed.body);
}

async function listMarkdownRecords<T>(dir: string, parser: (raw: string) => T): Promise<T[]> {
  if (!existsSync(dir)) {
    return [];
  }
  const names = (await readdir(dir)).filter((name) => name.endsWith('.md')).sort();
  return Promise.all(names.map(async (name) => parser(await readFile(resolveContainedPath(dir, name), 'utf-8'))));
}

async function readRequiredRecord(filePath: string): Promise<ParsedMarkdownRecord> {
  if (!existsSync(filePath)) {
    throw new Error(`Backlog record not found: ${filePath}`);
  }
  return parseMarkdownRecord(await readFile(filePath, 'utf-8'));
}

function frontmatterFromWrite(record: BacklogItemWrite | BacklogEpicWrite): Record<string, unknown> {
  const { body: _body, title: _title, ...frontmatter } = record as Record<string, unknown>;
  return dropUndefined(frontmatter);
}

function orderFrontmatter(frontmatter: Record<string, unknown>, knownOrder: readonly string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of knownOrder) {
    if (frontmatter[key] !== undefined) {
      result[key] = frontmatter[key];
    }
  }
  for (const key of Object.keys(frontmatter).filter((key) => !knownOrder.includes(key)).sort()) {
    if (frontmatter[key] !== undefined) {
      result[key] = frontmatter[key];
    }
  }
  return result;
}

function safeId(id: string): string {
  assertSafeBacklogId(id);
  return id;
}

function resolveContainedPath(root: string, leaf: string): string {
  const resolved = resolve(root, leaf);
  const rel = relative(root, resolved);
  if (rel === '' || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) {
    throw new Error(`Resolved backlog path "${resolved}" escapes ${root}${sep}`);
  }
  return resolved;
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function dropUndefined(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}
