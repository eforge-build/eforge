import { access, readFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { analyzeAcceptanceCriteria, formatAcDiagnostics } from '@eforge-build/input';
import type { ExtensionActionContext } from '@eforge-build/extension-sdk';
import { parsePlaybook, playbookFrontmatterSchema, type Playbook, type PlaybookScope } from './model.js';
import { copyPlaybookToScope, listPlaybooks, loadPlaybook, resolvePlaybookPath, writePlaybook, type PlaybookEntry } from './storage-core.js';
import { invalidField, notFound, userError, wrapUserError } from './action-errors.js';
import type { SavePlaybookInput } from './schemas.js';
import { omitUndefined } from './json-safe.js';

export function playbookPath(ctx: ExtensionActionContext, scope: PlaybookScope, name: string): string {
  return resolvePlaybookPath(scope, { cwd: ctx.cwd, configDir: ctx.paths.configDir }, name);
}

export async function exists(path: string): Promise<boolean> {
  try { await access(path, fsConstants.F_OK); return true; } catch { return false; }
}

export async function loadExact(ctx: ExtensionActionContext, name: string, scope?: PlaybookScope) {
  if (scope === undefined) {
    const result = await loadPlaybook({ cwd: ctx.cwd, configDir: ctx.paths.configDir, name }).catch((err) => wrapUserError(err, `Playbook "${name}" was not found.`));
    const listed = await listPlaybooks({ cwd: ctx.cwd, configDir: ctx.paths.configDir });
    const entry = listed.playbooks.find((item) => item.name === name && item.source === result.source);
    return { playbook: result.playbook, source: { source: result.source, path: entry?.path ?? playbookPath(ctx, result.source as PlaybookScope, name) }, shadows: result.shadows };
  }
  const path = playbookPath(ctx, scope, name);
  if (!await exists(path)) throw notFound(name);
  const raw = await readFile(path, 'utf-8');
  try { return { playbook: parsePlaybook(raw), source: { source: scope, path }, shadows: [] }; }
  catch (err) { return wrapUserError(err, `Playbook "${name}" at ${path} is invalid.`); }
}

export function projectEntry(entry: PlaybookEntry, includeShadowed: boolean): PlaybookEntry {
  return omitUndefined({ ...entry, shadows: includeShadowed ? entry.shadows : [] });
}

export function assertRequestedPlaybookName(requestedName: string, actualName: string): void {
  if (requestedName !== actualName) throw invalidField('/name', `Requested playbook name "${requestedName}" does not match loaded playbook name "${actualName}".`);
}

function assertPayloadScopeMatchesRequest(declaredScope: PlaybookScope | undefined, requestedScope: PlaybookScope): void {
  if (declaredScope !== undefined && declaredScope !== requestedScope) {
    throw invalidField('/scope', `Payload scope "${declaredScope}" does not match requested scope "${requestedScope}".`);
  }
}

export function normalizeSavePayload(input: SavePlaybookInput): Playbook {
  const hasFlattenedPayload = input.description !== undefined
    || input.mode !== undefined
    || input.profile !== undefined
    || input.postMerge !== undefined
    || input.goal !== undefined
    || input.outOfScope !== undefined
    || input.acceptanceCriteria !== undefined
    || input.plannerNotes !== undefined;
  const variants = [input.raw !== undefined, input.playbook !== undefined, hasFlattenedPayload].filter(Boolean).length;
  if (variants !== 1) throw userError('Select exactly one save payload variant: raw, playbook, or flattened fields.');
  let playbook: Playbook;
  if (input.raw !== undefined) {
    try { playbook = parsePlaybook(input.raw); } catch (err) { return wrapUserError(err, 'Invalid playbook markdown.'); }
    assertPayloadScopeMatchesRequest(playbook.scope, input.scope);
  } else if (input.playbook !== undefined) {
    assertPayloadScopeMatchesRequest(input.playbook.frontmatter.scope, input.scope);
    const frontmatter = { ...input.playbook.frontmatter, scope: input.playbook.frontmatter.scope ?? input.scope };
    const parsed = playbookFrontmatterSchema.safeParse(frontmatter);
    if (!parsed.success) throw userError(`Invalid playbook frontmatter: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`);
    playbook = {
      ...parsed.data,
      goal: input.playbook.body.goal,
      outOfScope: input.playbook.body.outOfScope ?? '',
      acceptanceCriteria: input.playbook.body.acceptanceCriteria ?? '',
      plannerNotes: input.playbook.body.plannerNotes ?? '',
    };
  } else {
    if (input.name === undefined || input.description === undefined || input.mode === undefined || input.goal === undefined) {
      throw userError('Flattened save payload requires name, description, mode, and goal.');
    }
    playbook = { name: input.name, description: input.description, scope: input.scope, mode: input.mode, profile: input.profile, postMerge: input.postMerge, goal: input.goal, outOfScope: input.outOfScope ?? '', acceptanceCriteria: input.acceptanceCriteria ?? '', plannerNotes: input.plannerNotes ?? '' };
    const parsed = playbookFrontmatterSchema.safeParse(playbook);
    if (!parsed.success) throw userError(`Invalid playbook frontmatter: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`);
  }
  if (input.name !== undefined && input.name !== playbook.name) throw invalidField('/name', `Top-level name "${input.name}" does not match playbook name "${playbook.name}".`);
  return { ...playbook, scope: input.scope };
}

export function assertAcceptanceCriteria(playbook: Playbook, path = '/playbook/body/acceptanceCriteria'): void {
  if (!playbook.acceptanceCriteria.trim()) return;
  const result = analyzeAcceptanceCriteria(playbook.acceptanceCriteria);
  if (!result.valid) throw userError(formatAcDiagnostics(result.diagnostics), path, { diagnostics: result.diagnostics });
}

export async function savePlaybook(ctx: ExtensionActionContext, input: SavePlaybookInput) {
  const playbook = normalizeSavePayload(input);
  assertAcceptanceCriteria(playbook);
  const path = playbookPath(ctx, input.scope, playbook.name);
  if (input.overwrite === false && await exists(path)) throw userError(`Playbook "${playbook.name}" already exists at ${path}.`, '/overwrite');
  return writePlaybook({ cwd: ctx.cwd, configDir: ctx.paths.configDir, scope: input.scope, playbook });
}

export async function copyHighest(ctx: ExtensionActionContext, name: string, targetScope: PlaybookScope, overwrite?: boolean) {
  const source = await loadPlaybook({ cwd: ctx.cwd, configDir: ctx.paths.configDir, name }).catch((err) => wrapUserError(err, `Playbook "${name}" was not found.`));
  assertRequestedPlaybookName(name, source.playbook.name);
  const target = playbookPath(ctx, targetScope, name);
  if (overwrite === false && await exists(target)) throw userError(`Playbook "${name}" already exists at ${target}.`, '/overwrite');
  return copyPlaybookToScope({ cwd: ctx.cwd, configDir: ctx.paths.configDir, name, targetScope }).catch((err) => wrapUserError(err, `Playbook "${name}" was not found.`));
}
