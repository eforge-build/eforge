import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { createEforgeProjectPaths } from '@eforge-build/extension-sdk';
import { parseWithSchema } from '@eforge-build/client';
import { userActionError } from './action-errors.js';
import {
  MAX_ROADMAP_ASSUMPTIONS,
  MAX_ROADMAP_ASSUMPTION_LENGTH,
  MAX_ROADMAP_CONFLICTS,
  MAX_ROADMAP_CONFLICT_MESSAGE_LENGTH,
  MAX_ROADMAP_CONTEXT_CONTENT_BYTES,
  MAX_ROADMAP_EXCERPT_BYTES,
  MAX_ROADMAP_EXCERPTS,
  MAX_ROADMAP_HEADING_LENGTH,
  MAX_ROADMAP_HEADINGS,
  MAX_ROADMAP_LOCAL_FOCUS_BYTES,
  MAX_ROADMAP_SHARED_SOURCES,
  RoadmapConfigSchema,
  type ConfiguredRoadmapSource,
  type RoadmapConfig,
  type RoadmapConflict,
  type RoadmapContext,
  type RoadmapSourceProjection,
  type RoadmapStateResponse,
  type UpdateRoadmapStateInput,
} from './roadmap-schemas.js';

export const ROADMAP_LOCAL_FOCUS_RELATIVE_PATH = '.eforge/storage/extensions/eforge-plan/roadmaps/local-focus.md';
export const ROADMAP_CONFIG_RELATIVE_PATH = '.eforge/storage/extensions/eforge-plan/roadmaps/config.json';
export const CONVENTIONAL_ROADMAP_PATH = 'docs/roadmap.md';

interface RoadmapBuildOptions {
  includeRoadmap?: boolean;
  includeLocalFocusContent?: boolean;
}

interface ProjectionTruncation {
  sourceExcerpts: number;
  sourceContent: number;
}

interface RoadmapConfigLoad {
  config: RoadmapConfig;
  conflicts: RoadmapConflict[];
}

export function roadmapStoragePaths(cwd: string): { localFocus: string; config: string } {
  const paths = createEforgeProjectPaths({ cwd, extensionName: 'eforge-plan' });
  return {
    localFocus: paths.extensionStoragePath('project-local', ['roadmaps', 'local-focus.md']),
    config: paths.extensionStoragePath('project-local', ['roadmaps', 'config.json']),
  };
}

export async function readRoadmapState(cwd: string, options: { includeLocalFocusContent?: boolean } = {}): Promise<RoadmapStateResponse> {
  const { config } = await readRoadmapConfig(cwd);
  return {
    schemaVersion: 1,
    config,
    context: await buildRoadmapContext(cwd, { includeLocalFocusContent: options.includeLocalFocusContent }),
    storagePaths: { localFocus: ROADMAP_LOCAL_FOCUS_RELATIVE_PATH, config: ROADMAP_CONFIG_RELATIVE_PATH },
  };
}

export async function updateRoadmapState(cwd: string, input: UpdateRoadmapStateInput): Promise<RoadmapStateResponse> {
  if (input.localFocusContent === undefined && input.sharedSources === undefined) {
    throw userActionError('update-roadmap-state requires localFocusContent or sharedSources.', { path: '' });
  }
  const paths = roadmapStoragePaths(cwd);
  if (input.expectedLocalFocusSha256 !== undefined) {
    const current = await readExistingText(paths.localFocus);
    const currentHash = current === null ? sha256('') : sha256(current);
    if (currentHash !== input.expectedLocalFocusSha256) {
      throw userActionError('Local focus roadmap changed before update.', { path: 'expectedLocalFocusSha256' });
    }
  }
  const localFocusContent = input.localFocusContent;
  if (localFocusContent !== undefined && Buffer.byteLength(localFocusContent, 'utf-8') > MAX_ROADMAP_LOCAL_FOCUS_BYTES) {
    throw userActionError(`Local focus roadmap exceeds ${MAX_ROADMAP_LOCAL_FOCUS_BYTES} bytes.`, { path: 'localFocusContent' });
  }
  const config = input.sharedSources === undefined
    ? undefined
    : { schemaVersion: 1, sharedSources: input.sharedSources.map((source, index) => normalizeConfiguredSource(cwd, source, index)) } satisfies RoadmapConfig;
  if (localFocusContent !== undefined) {
    await writeTextAtomically(paths.localFocus, localFocusContent);
  }
  if (config !== undefined) {
    await writeTextAtomically(paths.config, `${JSON.stringify(config, null, 2)}\n`);
  }
  return readRoadmapState(cwd, { includeLocalFocusContent: true });
}

export async function buildRoadmapContext(cwd: string, options: RoadmapBuildOptions = {}): Promise<RoadmapContext> {
  const truncation: ProjectionTruncation = { sourceExcerpts: 0, sourceContent: 0 };
  if (options.includeRoadmap === false) {
    return finalizeRoadmapContext({
      schemaVersion: 1,
      localSteering: {
        kind: 'local-focus',
        role: 'local-steering',
        path: ROADMAP_LOCAL_FOCUS_RELATIVE_PATH,
        configured: true,
        editable: true,
        exists: false,
        headings: [],
        excerpts: [],
        maxContentBytes: MAX_ROADMAP_LOCAL_FOCUS_BYTES,
      },
      sharedContextSources: [],
      discoveredContextSources: [],
      assumptions: ['Roadmap context omitted because includeRoadmap was false.'],
      conflicts: [],
      truncation,
    });
  }
  const { config, conflicts } = await readRoadmapConfig(cwd);
  const localSteering = await projectPathSource(cwd, ROADMAP_LOCAL_FOCUS_RELATIVE_PATH, {
    absolutePath: roadmapStoragePaths(cwd).localFocus,
    kind: 'local-focus',
    role: 'local-steering',
    configured: true,
    editable: true,
    includeContent: options.includeLocalFocusContent,
    truncation,
  });
  appendSourceReadConflict(conflicts, localSteering);
  const enabledSources = collectEnabledConfiguredSources(config, conflicts);
  const sharedContextSources = await Promise.all(enabledSources.map((source) => projectConfiguredSource(cwd, source, truncation, conflicts)));
  const configuredPaths = new Set(enabledSources.map((source) => source.path));
  const discoveredContextSources = configuredPaths.has(CONVENTIONAL_ROADMAP_PATH)
    ? []
    : [await projectPathSource(cwd, CONVENTIONAL_ROADMAP_PATH, { kind: 'discovered-conventional', role: 'shared-context', configured: false, editable: false, truncation })].filter((source) => source.exists);
  for (const source of discoveredContextSources) appendSourceReadConflict(conflicts, source);
  const assumptions = [
    'Local focus roadmap is private extension storage and may be edited by eforge-plan actions.',
    'Shared and discovered roadmap sources are read-only context for planning flows.',
  ];
  return finalizeRoadmapContext({ schemaVersion: 1, localSteering, sharedContextSources, discoveredContextSources, assumptions, conflicts, truncation });
}

async function readRoadmapConfig(cwd: string): Promise<RoadmapConfigLoad> {
  const configPath = roadmapStoragePaths(cwd).config;
  if (!existsSync(configPath)) return { config: { schemaVersion: 1, sharedSources: [] }, conflicts: [] };
  try {
    const raw = JSON.parse(await readFile(configPath, 'utf-8')) as unknown;
    const parsed = parseWithSchema(RoadmapConfigSchema, raw);
    return { config: { schemaVersion: 1, sharedSources: parsed.sharedSources.slice(0, MAX_ROADMAP_SHARED_SOURCES).map((source, index) => normalizeConfiguredSource(cwd, source, index)) }, conflicts: [] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      config: { schemaVersion: 1, sharedSources: [] },
      conflicts: [{ code: 'invalid-config', message: `Invalid roadmap config "${ROADMAP_CONFIG_RELATIVE_PATH}": ${message}`, path: ROADMAP_CONFIG_RELATIVE_PATH }],
    };
  }
}

function collectEnabledConfiguredSources(config: RoadmapConfig, conflicts: RoadmapConflict[]): ConfiguredRoadmapSource[] {
  const enabled = config.sharedSources.filter((source) => source.enabled !== false).slice(0, MAX_ROADMAP_SHARED_SOURCES);
  const seenIds = new Map<string, ConfiguredRoadmapSource>();
  const seenPaths = new Map<string, ConfiguredRoadmapSource>();
  for (const source of enabled) {
    if (seenIds.has(source.id)) conflicts.push({ code: 'duplicate-source', message: `Duplicate enabled roadmap source id "${source.id}".`, sourceId: source.id, path: source.path });
    if (seenPaths.has(source.path)) conflicts.push({ code: 'duplicate-source', message: `Duplicate enabled roadmap source path "${source.path}".`, sourceId: source.id, path: source.path });
    seenIds.set(source.id, source);
    seenPaths.set(source.path, source);
  }
  return enabled;
}

function normalizeConfiguredSource(cwd: string, source: ConfiguredRoadmapSource, index: number): ConfiguredRoadmapSource {
  const path = normalizeProjectRelativePath(cwd, source.path, `sharedSources[${index}].path`);
  return {
    id: boundSourceString(source.id, `source-${index + 1}`),
    path,
    ...(source.label !== undefined && { label: boundSourceString(source.label, source.label) }),
    ...(source.enabled !== undefined && { enabled: source.enabled }),
  };
}

export function normalizeProjectRelativePath(cwd: string, value: string, errorPath = 'path'): string {
  if (value.includes('\0') || value.trim().length === 0 || /^[a-zA-Z]:[\\/]/.test(value) || value.includes('\\') || isAbsolute(value)) {
    throw userActionError('Roadmap source path must be a project-relative contained path.', { path: errorPath });
  }
  const normalized = value.split('/').filter((part) => part.length > 0).join('/');
  const absolute = resolve(cwd, normalized);
  const rel = relative(cwd, absolute);
  if (rel === '' || rel.startsWith('..') || rel.includes(`..${sep}`) || isAbsolute(rel)) {
    throw userActionError('Roadmap source path must stay inside the project.', { path: errorPath });
  }
  if (rel.length > 240) throw userActionError('Roadmap source path is too long.', { path: errorPath });
  return rel.split(sep).join('/');
}

async function projectConfiguredSource(cwd: string, source: ConfiguredRoadmapSource, truncation: ProjectionTruncation, conflicts: RoadmapConflict[]): Promise<RoadmapSourceProjection> {
  const projection = await projectPathSource(cwd, source.path, {
    kind: 'configured-shared',
    role: 'shared-context',
    configured: true,
    editable: false,
    id: source.id,
    label: source.label,
    truncation,
  });
  if (!projection.exists) conflicts.push({ code: 'configured-source-missing', message: `Configured roadmap source "${source.path}" does not exist.`, sourceId: source.id, path: source.path });
  appendSourceReadConflict(conflicts, projection);
  return projection;
}

function finalizeRoadmapContext(context: RoadmapContext): RoadmapContext {
  return {
    ...context,
    assumptions: context.assumptions.slice(0, MAX_ROADMAP_ASSUMPTIONS).map((assumption) => boundString(assumption, MAX_ROADMAP_ASSUMPTION_LENGTH, () => {})),
    conflicts: context.conflicts.slice(0, MAX_ROADMAP_CONFLICTS).map((conflict) => ({
      ...conflict,
      message: boundString(conflict.message, MAX_ROADMAP_CONFLICT_MESSAGE_LENGTH, () => {}),
    })),
  };
}

function appendSourceReadConflict(conflicts: RoadmapConflict[], projection: RoadmapSourceProjection): void {
  if (projection.readError === undefined) return;
  conflicts.push({ code: 'source-read-error', message: projection.readError, ...(projection.id !== undefined && { sourceId: projection.id }), path: projection.path });
}

async function projectPathSource(
  cwd: string,
  path: string,
  options: {
    absolutePath?: string;
    kind: RoadmapSourceProjection['kind'];
    role: RoadmapSourceProjection['role'];
    configured: boolean;
    editable: boolean;
    id?: string;
    label?: string;
    includeContent?: boolean;
    truncation: ProjectionTruncation;
  },
): Promise<RoadmapSourceProjection> {
  const absolutePath = options.absolutePath ?? resolve(cwd, path);
  const base = { kind: options.kind, role: options.role, path, ...(options.id !== undefined && { id: options.id }), ...(options.label !== undefined && { label: options.label }), configured: options.configured, editable: options.editable, ...(options.kind === 'local-focus' && { maxContentBytes: MAX_ROADMAP_LOCAL_FOCUS_BYTES }) };
  if (!existsSync(absolutePath)) return { ...base, exists: false, headings: [], excerpts: [] };
  try {
    const raw = await readFile(absolutePath, 'utf-8');
    const fileStat = await stat(absolutePath);
    const content = boundUtf8String(raw, MAX_ROADMAP_CONTEXT_CONTENT_BYTES, () => { options.truncation.sourceContent += 1; });
    const projected: RoadmapSourceProjection = {
      ...base,
      exists: true,
      sha256: sha256(raw),
      updatedAt: fileStat.mtime.toISOString(),
      headings: extractHeadings(content),
      excerpts: extractExcerpts(content, options.truncation),
    };
    if (options.includeContent === true) {
      const fullContent = boundUtf8String(raw, MAX_ROADMAP_LOCAL_FOCUS_BYTES, () => { projected.contentTruncated = true; });
      projected.content = fullContent;
    }
    return projected;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const readError = boundUtf8String(`Failed to read roadmap source "${path}": ${message}`, MAX_ROADMAP_CONTEXT_CONTENT_BYTES, () => { options.truncation.sourceContent += 1; });
    return { ...base, exists: true, headings: [], excerpts: [], readError };
  }
}

function extractHeadings(markdown: string): string[] {
  const headings = markdown.split(/\r?\n/).map((line) => /^#{1,6}\s+(.+)$/.exec(line)?.[1]?.trim()).filter((line): line is string => Boolean(line));
  return headings.slice(0, MAX_ROADMAP_HEADINGS).map((heading) => boundString(heading, MAX_ROADMAP_HEADING_LENGTH, () => {}));
}

function extractExcerpts(markdown: string, truncation: ProjectionTruncation): string[] {
  const blocks = markdown.split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
  truncation.sourceExcerpts += Math.max(0, blocks.length - MAX_ROADMAP_EXCERPTS);
  return blocks.slice(0, MAX_ROADMAP_EXCERPTS).map((block) => boundUtf8String(block, MAX_ROADMAP_EXCERPT_BYTES, () => { truncation.sourceExcerpts += 1; }));
}

function boundString(value: string, limit: number, onTruncate: () => void): string {
  if (value.length <= limit) return value;
  onTruncate();
  return `${value.slice(0, Math.max(0, limit - 16))}\n…[truncated]`;
}

function boundUtf8String(value: string, limit: number, onTruncate: () => void): string {
  if (Buffer.byteLength(value, 'utf-8') <= limit) return value;
  onTruncate();
  const suffix = '\n…[truncated]';
  const suffixBytes = Buffer.byteLength(suffix, 'utf-8');
  let result = '';
  let bytes = 0;
  for (const char of value) {
    const charBytes = Buffer.byteLength(char, 'utf-8');
    if (bytes + charBytes + suffixBytes > limit) break;
    result += char;
    bytes += charBytes;
  }
  return `${result}${suffix}`;
}

function boundSourceString(value: string, fallback: string): string {
  const trimmed = value.trim();
  return boundString(trimmed.length > 0 ? trimmed : fallback, 120, () => {});
}

async function readExistingText(path: string): Promise<string | null> {
  if (!existsSync(path)) return null;
  return readFile(path, 'utf-8');
}

async function writeTextAtomically(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, content, 'utf-8');
  await rename(tempPath, path);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
