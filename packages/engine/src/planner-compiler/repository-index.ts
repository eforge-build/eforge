import { execFile } from 'node:child_process';
import { lstat, open, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { classifyEvidenceCandidate, isGeneratedPlanningArtifactPath, normalizeEvidenceValue } from './evidence-hygiene.js';
import { normalizeSourceLocalizationInputs, type SourceLocalizationDiagnostic, type SourceLocalizationInputHints, type SourceLocalizationLimits } from './source-localization-contracts.js';

const execFileAsync = promisify(execFile);
const DEFAULT_IGNORE_PREFIXES = ['.git/', '.eforge/', '.decomposition/', 'node_modules/', 'dist/', 'build/', 'coverage/', '.cache/', '.next/', '.turbo/', '.pnpm-store/', 'tmp/', 'temp/'];
const DEFAULT_IGNORE_SEGMENTS = new Set(['.git', '.eforge', '.decomposition', 'node_modules', 'dist', 'build', 'coverage', '.cache', '.next', '.turbo', '.pnpm-store']);
const DEFAULT_IGNORE_GLOBS = ['**/node_modules/**', '**/dist/**', '**/build/**', '**/coverage/**', '**/.cache/**', '**/.decomposition/**'];
const TEXT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.yaml', '.yml', '.md', '.mdx', '.css', '.scss', '.html', '.vue', '.svelte', '.py', '.rb', '.go', '.rs', '.java', '.scala', '.kt', '.sh']);
const MANIFEST_NAMES = new Set(['package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'composer.json', 'Gemfile', 'Makefile']);
const ENTRYPOINT_NAMES = new Set(['index', 'main', 'cli', 'app', 'server', 'worker']);

export interface RepositoryIndexFile { path: string; dirname: string; basename: string; extension: string; segments: string[]; byteLength: number; scannedBytes: number; textSample?: string; keywords: string[]; surfaces: string[]; manifestEntrypoints: string[] }
export interface RepositoryIndex { cwd: string; files: RepositoryIndexFile[]; diagnostics: SourceLocalizationDiagnostic[]; limits: SourceLocalizationLimits; ignoredPrefixes: string[]; ignoredGlobs: string[]; usedGit: boolean; truncated: boolean }
export interface DeriveRepositoryIndexInput { cwd: string; hints?: SourceLocalizationInputHints; limits?: Partial<SourceLocalizationLimits> }

export async function deriveRepositoryIndex(input: DeriveRepositoryIndexInput): Promise<RepositoryIndex> {
  const normalized = normalizeSourceLocalizationInputs(input.hints, input.limits);
  const limits = normalized.limits;
  const ignoredPrefixes = normalizeIgnorePrefixes([...(normalized.hints.ignorePrefixes ?? []), ...DEFAULT_IGNORE_PREFIXES]);
  const ignoredGlobs = [...DEFAULT_IGNORE_GLOBS, ...(normalized.hints.ignoreGlobs ?? [])];
  const diagnostics: SourceLocalizationDiagnostic[] = [...normalized.diagnostics];
  const root = await realpath(input.cwd);
  const listed = await listRepositoryPaths(root, limits, ignoredPrefixes, ignoredGlobs, diagnostics);
  const paths = listed.paths.filter((candidate) => !isIgnoredPath(candidate, ignoredPrefixes, ignoredGlobs));
  const truncated = listed.truncated || paths.length > limits.maxIndexedFiles;
  if (paths.length > limits.maxIndexedFiles) diagnostics.push({ code: 'index-file-limit', message: `Repository index capped at ${limits.maxIndexedFiles} files.`, severity: 'warning' });
  const files = await inspectFiles(root, paths.slice(0, limits.maxIndexedFiles).sort(), limits, diagnostics);
  return { cwd: input.cwd, files, diagnostics, limits, ignoredPrefixes, ignoredGlobs, usedGit: listed.usedGit, truncated };
}

export function isRepositoryIndexPathIgnored(pathValue: string, hints?: SourceLocalizationInputHints): boolean {
  const normalized = normalizeSourceLocalizationInputs(hints);
  return isIgnoredPath(normalizeEvidenceValue(pathValue), normalizeIgnorePrefixes([...(normalized.hints.ignorePrefixes ?? []), ...DEFAULT_IGNORE_PREFIXES]), [...DEFAULT_IGNORE_GLOBS, ...(normalized.hints.ignoreGlobs ?? [])]);
}

async function listRepositoryPaths(root: string, limits: SourceLocalizationLimits, ignoredPrefixes: string[], ignoredGlobs: string[], diagnostics: SourceLocalizationDiagnostic[]): Promise<{ paths: string[]; usedGit: boolean; truncated: boolean }> {
  try {
    const { stdout } = await execFileAsync('git', ['-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', 'ls-files', '-z'], { cwd: root, env: sanitizedGitEnv(), maxBuffer: 20_000_000 });
    const paths = stdout.split('\0').map(normalizePath).filter(Boolean);
    if (paths.length > 0) return { paths, usedGit: true, truncated: false };
  } catch {
    diagnostics.push({ code: 'git-ls-files-unavailable', message: 'Falling back to bounded workspace traversal.', severity: 'info' });
  }
  return { paths: await walkWorkspace(root, root, limits, ignoredPrefixes, ignoredGlobs, diagnostics), usedGit: false, truncated: diagnostics.some((diagnostic) => diagnostic.code === 'index-file-limit') };
}

async function walkWorkspace(root: string, dir: string, limits: SourceLocalizationLimits, ignoredPrefixes: string[], ignoredGlobs: string[], diagnostics: SourceLocalizationDiagnostic[], result: string[] = []): Promise<string[]> {
  if (result.length >= limits.maxIndexedFiles) return result;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (result.length >= limits.maxIndexedFiles) { pushIndexLimitDiagnostic(diagnostics, limits); break; }
    const absolute = path.join(dir, entry.name);
    const relative = normalizePath(path.relative(root, absolute));
    if (entry.isSymbolicLink()) { diagnostics.push({ code: 'index-symlink-skipped', message: 'Symlink skipped during repository indexing.', severity: 'info', path: relative }); continue; }
    if (isIgnoredPath(relative, ignoredPrefixes, ignoredGlobs)) continue;
    if (entry.isDirectory()) await walkWorkspace(root, absolute, limits, ignoredPrefixes, ignoredGlobs, diagnostics, result);
    else if (entry.isFile()) result.push(relative);
  }
  return result;
}

async function inspectFiles(root: string, paths: string[], limits: SourceLocalizationLimits, diagnostics: SourceLocalizationDiagnostic[]): Promise<RepositoryIndexFile[]> {
  let scannedTotal = 0;
  const files: RepositoryIndexFile[] = [];
  for (const relative of paths) {
    const absolute = path.resolve(root, relative);
    if (!isInside(root, absolute)) { diagnostics.push({ code: 'index-path-outside-root', message: 'Indexed path resolved outside root.', severity: 'warning', path: relative }); continue; }
    const linkInfo = await lstat(absolute).catch(() => undefined);
    if (linkInfo?.isSymbolicLink()) { diagnostics.push({ code: 'index-symlink-skipped', message: 'Symlink skipped during repository indexing.', severity: 'info', path: relative }); continue; }
    const info = linkInfo?.isFile() ? await stat(absolute).catch(() => undefined) : undefined;
    if (!info?.isFile()) continue;
    const extension = path.posix.extname(relative);
    const canScan = TEXT_EXTENSIONS.has(extension) || MANIFEST_NAMES.has(path.posix.basename(relative));
    const remaining = limits.maxTotalScannedBytes - scannedTotal;
    const scannedBytes = canScan && remaining > 0 ? Math.min(info.size, limits.maxBytesPerScannedFile, remaining) : 0;
    const textSample = scannedBytes > 0 ? await readSample(absolute, scannedBytes, relative, diagnostics) : undefined;
    scannedTotal += scannedBytes;
    if (canScan && scannedBytes === 0) diagnostics.push({ code: 'scan-budget-exhausted', message: 'Repository text scan budget exhausted.', severity: 'warning', path: relative });
    files.push(fileRecord(relative, info.size, scannedBytes, textSample));
  }
  if (scannedTotal >= limits.maxTotalScannedBytes) diagnostics.push({ code: 'scan-total-budget', message: `Text scan capped at ${limits.maxTotalScannedBytes} bytes.`, severity: 'info' });
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function fileRecord(relative: string, byteLength: number, scannedBytes: number, textSample?: string): RepositoryIndexFile {
  const basename = path.posix.basename(relative);
  const dirname = path.posix.dirname(relative) === '.' ? '' : path.posix.dirname(relative);
  const extension = path.posix.extname(relative);
  const keywords = extractKeywords(`${relative} ${textSample ?? ''}`);
  const surfaces = detectSurfaces(relative, textSample ?? '');
  return { path: relative, dirname, basename, extension, segments: relative.split('/'), byteLength, scannedBytes, ...(textSample !== undefined ? { textSample } : {}), keywords, surfaces, manifestEntrypoints: manifestEntrypoints(relative, textSample) };
}

function detectSurfaces(relative: string, text: string): string[] {
  const lower = `${relative} ${text.slice(0, 4_000)}`.toLowerCase();
  const hits: string[] = [];
  if (MANIFEST_NAMES.has(path.posix.basename(relative))) hits.push('manifest');
  if (ENTRYPOINT_NAMES.has(path.posix.basename(relative, path.posix.extname(relative)))) hits.push('entrypoint');
  if (/\b(config|settings|options)\b|\.(ya?ml|json|toml)$/.test(lower)) hits.push('config');
  if (/\b(schema|contract|interface|typebox|zod)\b/.test(lower)) hits.push('schema', 'contract');
  if (/\b(command|commander|cli)\b/.test(lower)) hits.push('command');
  if (/\b(route|router|endpoint|\/api\/)\b/.test(lower)) hits.push('route', 'api');
  if (/\b(component|view|page|screen|button|react|vue|svelte|tsx|jsx)\b/.test(lower)) hits.push('ui');
  if (/\b(plugin|extension|contribution|hook)\b/.test(lower)) hits.push('extension');
  if (/\b(readme|docs?|guide|manual)\b/.test(lower)) hits.push('docs');
  if (/\b(test|spec|fixture)\b/.test(lower)) hits.push('test');
  if (/\b(api|cli|ui|plugin|extension|public|consumer|user-facing)\b/.test(lower)) hits.push('consumer-surface');
  return [...new Set(hits)].sort();
}

function manifestEntrypoints(relative: string, text?: string): string[] {
  if (path.posix.basename(relative) !== 'package.json' || !text) return [];
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return [...new Set([...entryValues(parsed.main), ...entryValues(parsed.module), ...entryValues(parsed.types), ...entryValues(parsed.bin), ...entryValues(parsed.exports)].map((entry) => normalizePath(path.posix.join(path.posix.dirname(relative), entry))).filter(Boolean))].sort();
  } catch { return []; }
}

function entryValues(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(entryValues);
  if (value && typeof value === 'object') return Object.values(value).flatMap(entryValues);
  return [];
}

function pushIndexLimitDiagnostic(diagnostics: SourceLocalizationDiagnostic[], limits: SourceLocalizationLimits): void {
  if (!diagnostics.some((diagnostic) => diagnostic.code === 'index-file-limit')) diagnostics.push({ code: 'index-file-limit', message: `Repository index capped at ${limits.maxIndexedFiles} files.`, severity: 'warning' });
}

function sanitizedGitEnv(): NodeJS.ProcessEnv {
  const allowed = ['HOME', 'LANG', 'LC_ALL', 'PATH', 'SystemRoot', 'TMPDIR', 'TMP', 'TEMP'];
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.includes(key) || key.startsWith('npm_')));
}

function extractKeywords(value: string): string[] {
  return [...new Set(value.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) ?? [])].sort().slice(0, 300);
}

async function readSample(absolute: string, bytes: number, relative: string, diagnostics: SourceLocalizationDiagnostic[]): Promise<string | undefined> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(absolute, 'r');
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } catch (err) { diagnostics.push({ code: 'scan-read-failed', message: err instanceof Error ? err.message : String(err), severity: 'warning', path: relative }); return undefined; }
  finally { await handle?.close().catch(() => undefined); }
}

function isIgnoredPath(pathValue: string, prefixes: string[], globs: string[]): boolean {
  const value = normalizePath(pathValue);
  if (!value || value.startsWith('../') || path.isAbsolute(value)) return true;
  if (classifyEvidenceCandidate(value).kind === 'generated-artifact' || isGeneratedPlanningArtifactPath(value)) return true;
  if (value.split('/').some((segment) => DEFAULT_IGNORE_SEGMENTS.has(segment))) return true;
  if (prefixes.some((prefix) => value === prefix.slice(0, -1) || value.startsWith(prefix))) return true;
  return globs.some((glob) => globToRegExp(glob).test(value));
}

function normalizeIgnorePrefixes(prefixes: string[]): string[] {
  return [...new Set(prefixes.map((prefix) => normalizePath(prefix).replace(/\/$/, '')).filter(Boolean).map((prefix) => `${prefix}/`))].sort();
}

function globToRegExp(glob: string): RegExp {
  const normalized = normalizePath(glob);
  let source = '';
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    if (char === '*' && normalized[index + 1] === '*') { source += '.*'; index += 1; }
    else if (char === '*') source += '[^/]*';
    else source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/');
}

function isInside(root: string, candidate: string): boolean {
  const normalizedRoot = path.resolve(root);
  const normalizedCandidate = path.resolve(candidate);
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`);
}
