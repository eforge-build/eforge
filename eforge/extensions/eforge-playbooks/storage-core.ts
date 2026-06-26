import { access, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { getScopeDirectory, listNamedSet, resolveNamedSet, type Scope, type ScopeShadow } from '@eforge-build/scopes';
import {
  playbookScopeSchema,
  serializePlaybook,
  splitFrontmatter,
  validatePlaybook,
  type Playbook,
  type PlaybookMode,
  type PlaybookScope,
} from './model.js';

export class PlaybookNotFoundError extends Error {
  constructor(name: string) {
    super(`Playbook "${name}" not found in any tier (project-local, project-team, user).`);
    this.name = 'PlaybookNotFoundError';
  }
}

export interface PlaybookShadowEntry {
  source: ScopeShadow;
  path: string;
}

export interface PlaybookEntry {
  name: string;
  description: string;
  scope: PlaybookScope;
  mode: PlaybookMode;
  source: Scope;
  shadows: PlaybookShadowEntry[];
  path: string;
  profile?: string;
}

export interface ListPlaybooksOpts { configDir: string; cwd: string }
export interface LoadPlaybookOpts { configDir: string; cwd: string; name: string }
export interface WritePlaybookOpts { configDir: string; cwd: string; scope: PlaybookScope; playbook: Playbook }
export interface MovePlaybookOpts { configDir: string; cwd: string; name: string; fromScope: PlaybookScope; toScope: PlaybookScope; overwrite?: boolean }
export interface CopyPlaybookToScopeOpts { configDir: string; cwd: string; name: string; targetScope: PlaybookScope }
export interface CopyPlaybookToScopeResult { sourcePath: string; targetPath: string; targetScope: PlaybookScope }

function playbooksDir(scope: PlaybookScope, opts: { cwd: string; configDir: string }): string {
  return resolve(getScopeDirectory(scope, opts), 'playbooks');
}

export function resolvePlaybookPath(scope: PlaybookScope, opts: { cwd: string; configDir: string }, name: string): string {
  return resolve(playbooksDir(scope, opts), `${name}.md`);
}

function shadowEntries(name: string, shadows: ScopeShadow[], opts: { cwd: string; configDir: string }): PlaybookShadowEntry[] {
  return shadows.map((source) => ({ source, path: resolvePlaybookPath(source as PlaybookScope, opts, name) }));
}

function assertPlaybookNameMatchesRequested(requestedName: string, playbook: Playbook, path: string): void {
  if (playbook.name !== requestedName) {
    throw new Error(`Playbook "${requestedName}" at ${path} is invalid: frontmatter name "${playbook.name}" does not match requested name "${requestedName}".`);
  }
}

async function fileExists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

export async function listPlaybooks(opts: ListPlaybooksOpts): Promise<{ playbooks: PlaybookEntry[]; warnings: string[] }> {
  const entries = await listNamedSet('playbooks', { ...opts, extension: 'md' });
  const playbooks: PlaybookEntry[] = [];
  const warnings: string[] = [];

  await Promise.all(entries.map(async (entry) => {
    let description = '';
    let scope: PlaybookScope = entry.scope as PlaybookScope;
    let mode: PlaybookMode = 'autonomous';
    let profile: string | undefined;
    try {
      const raw = await readFile(entry.path, 'utf-8');
      const [fm] = splitFrontmatter(raw);
      if (typeof fm.description === 'string') description = fm.description;
      const scopeResult = playbookScopeSchema.safeParse(fm.scope);
      if (scopeResult.success) {
        const declaredScope = scopeResult.data;
        const expectedScope = entry.scope as PlaybookScope;
        if (declaredScope !== expectedScope) {
          warnings.push(`Playbook "${entry.name}" at ${entry.path}: frontmatter scope "${declaredScope}" does not match storage tier "${expectedScope}".`);
        }
        scope = declaredScope;
      }
      if (fm.mode === 'autonomous' || fm.mode === 'planning') mode = fm.mode;
      if (typeof fm.profile === 'string' && fm.profile.trim().length > 0) profile = fm.profile.trim();
    } catch {
      // Keep unreadable entries listable with safe defaults.
    }
    playbooks.push({
      name: entry.name,
      description,
      scope,
      mode,
      source: entry.scope,
      shadows: shadowEntries(entry.name, entry.shadows, opts),
      path: entry.path,
      ...(profile !== undefined && { profile }),
    });
  }));

  playbooks.sort((a, b) => a.name.localeCompare(b.name));
  return { playbooks, warnings };
}

export async function loadPlaybook(opts: LoadPlaybookOpts): Promise<{ playbook: Playbook; source: Scope; shadows: PlaybookShadowEntry[] }> {
  const map = await resolveNamedSet('playbooks', { ...opts, extension: 'md' });
  const entry = map.get(opts.name);
  if (!entry) throw new PlaybookNotFoundError(opts.name);
  const raw = await readFile(entry.path, 'utf-8');
  const result = validatePlaybook(raw);
  if (!result.ok) throw new Error(`Playbook "${opts.name}" at ${entry.path} is invalid: ${result.errors.join('; ')}`);
  assertPlaybookNameMatchesRequested(opts.name, result.playbook, entry.path);
  return { playbook: result.playbook, source: entry.scope, shadows: shadowEntries(opts.name, entry.shadows, opts) };
}

export async function writePlaybook(opts: WritePlaybookOpts): Promise<{ path: string }> {
  const targetDir = playbooksDir(opts.scope, opts);
  await mkdir(targetDir, { recursive: true });
  const filePath = resolve(targetDir, `${opts.playbook.name}.md`);
  const tmp = `${filePath}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tmp, serializePlaybook(opts.playbook), 'utf-8');
  await rename(tmp, filePath);
  return { path: filePath };
}

export async function movePlaybook(opts: MovePlaybookOpts): Promise<{ path: string }> {
  if (opts.fromScope === opts.toScope) {
    throw new Error(`Cannot move playbook "${opts.name}" within the same scope "${opts.fromScope}".`);
  }
  const src = resolvePlaybookPath(opts.fromScope, opts, opts.name);
  const dst = resolvePlaybookPath(opts.toScope, opts, opts.name);
  const raw = await readFile(src, 'utf-8');
  const result = validatePlaybook(raw);
  if (!result.ok) throw new Error(`Playbook "${opts.name}" at ${src} is invalid: ${result.errors.join('; ')}`);
  assertPlaybookNameMatchesRequested(opts.name, result.playbook, src);
  await mkdir(playbooksDir(opts.toScope, opts), { recursive: true });
  if (!opts.overwrite && await fileExists(dst)) throw new Error(`Playbook "${opts.name}" already exists at ${dst}. Pass overwrite: true to replace it.`);
  const tmp = `${dst}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tmp, serializePlaybook({ ...result.playbook, scope: opts.toScope }), 'utf-8');
  await rename(tmp, dst);
  await unlink(src);
  return { path: dst };
}

export async function copyPlaybookToScope(opts: CopyPlaybookToScopeOpts): Promise<CopyPlaybookToScopeResult> {
  const map = await resolveNamedSet('playbooks', { cwd: opts.cwd, configDir: opts.configDir, extension: 'md' });
  const entry = map.get(opts.name);
  if (!entry) throw new PlaybookNotFoundError(opts.name);
  const raw = await readFile(entry.path, 'utf-8');
  const result = validatePlaybook(raw);
  if (!result.ok) throw new Error(`Playbook "${opts.name}" at ${entry.path} is invalid: ${result.errors.join('; ')}`);
  assertPlaybookNameMatchesRequested(opts.name, result.playbook, entry.path);
  const { path: targetPath } = await writePlaybook({ ...opts, scope: opts.targetScope, playbook: { ...result.playbook, scope: opts.targetScope } });
  return { sourcePath: entry.path, targetPath, targetScope: opts.targetScope };
}
