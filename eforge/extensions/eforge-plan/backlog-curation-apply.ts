import { safeParseWithSchema } from '@eforge-build/client';
import { EforgePlanPlanningBacklogCurationDraftSchema } from '../../../packages/client/src/extension-agent-tasks.js';
import { ExtensionActionInputValidationError } from '../../../packages/extension-sdk/src/index.js';
import { isBacklogStatus, isClosedStatus, isOpenStatus, normalizeBacklogEpic, normalizeBacklogItem, type BacklogEpic, type BacklogItem } from './backlog-domain.js';
import { buildBacklogCurationSource } from './backlog-curation-source.js';
import {
  assertSafeBacklogId,
  listBacklogEpicSnapshots,
  listBacklogItemSnapshots,
  replaceBacklogEpicRecord,
  replaceBacklogItemRecord,
  type BacklogRecordSnapshot,
} from './markdown-store.js';
import { canonicalJson } from './markdown-store-support.js';
import { computeRecommendationSourceFingerprint, markRecommendationsStaleForBacklogMutation, recordPlannerRecommendationAppliedForSourceFingerprint, validateRecommendationReferencesAgainstIds } from './recommendation-status.js';
import { parseRecommendationModel, resolveRecommendationsPathForCwd, summarizeRecommendations, writeRecommendations } from './recommendations-store.js';
import { markPlanningTaskWorkflowEntryApplied, isBacklogCurationWorkflowEntry } from './planning-task-workflow-store.js';
import type { ApplyPlanningAgentTaskResultInput, PlanningTaskWorkflowEntry } from './planning-agent-task-schemas.js';
import type { BacklogCurationApplyDetails } from './backlog-curation-schemas.js';
import type { BacklogRecommendationModel } from './schema.js';

interface PlanningAgentTaskRecordLike {
  taskId: string;
  kind: string;
  status: string;
  result?: unknown;
}

type Draft = ReturnType<typeof parseDraft>;
type ItemPatch = Draft['itemChanges'][number];
type EpicPatch = Draft['epicChanges'][number];
type Recheck = Draft['noOpRechecks'][number];
type Patch = ItemPatch | EpicPatch;

type ProspectiveItem = { snapshot: BacklogRecordSnapshot<BacklogItem>; frontmatter: Record<string, unknown>; body: string; changed: boolean; patchPath?: string };
type ProspectiveEpic = { snapshot: BacklogRecordSnapshot<BacklogEpic>; frontmatter: Record<string, unknown>; body: string; changed: boolean; patchPath?: string };

export async function applyBacklogCurationDraftFromTask(
  cwd: string,
  task: PlanningAgentTaskRecordLike,
  input: ApplyPlanningAgentTaskResultInput,
  entry: PlanningTaskWorkflowEntry | undefined,
): Promise<BacklogCurationApplyDetails> {
  if (input.applyBacklogCurationDraft?.previewAcknowledged !== true || input.applyBacklogCurationDraft.confirmApply !== true) {
    throw validationError('applyBacklogCurationDraft', 'Applying a backlog curation draft requires previewAcknowledged: true and confirmApply: true.');
  }
  assertCompletedPlanningDraftTask(task);
  if (entry === undefined || !isBacklogCurationWorkflowEntry(entry) || entry.sourceFingerprint === undefined) {
    throw validationError('workflowEntry.purpose', 'Applying a backlog curation draft requires a backlog-curation workflow entry.');
  }
  const rawResult = task.result as Record<string, unknown> | undefined;
  const draft = parseDraft(rawResult?.backlogCurationDraft);
  if (draft.sourceFingerprint !== entry.sourceFingerprint) throw validationError('backlogCurationDraft.sourceFingerprint', 'Curation draft source fingerprint does not match the workflow entry.');
  const currentSource = await buildBacklogCurationSource(cwd);
  if (currentSource.sourceFingerprint !== draft.sourceFingerprint) throw validationError('backlogCurationDraft.sourceFingerprint', 'Curation draft is stale for the current backlog source fingerprint.');

  const [itemSnapshots, epicSnapshots] = await Promise.all([listBacklogItemSnapshots(cwd), listBacklogEpicSnapshots(cwd)]);
  const openItemSnapshots = itemSnapshots.filter((snapshot) => isOpenStatus(snapshot.record.status));
  const openEpicSnapshots = epicSnapshots.filter((snapshot) => isOpenStatus(snapshot.record.status));
  const items = new Map(openItemSnapshots.map((snapshot) => [snapshot.id, snapshot]));
  const epics = new Map(openEpicSnapshots.map((snapshot) => [snapshot.id, snapshot]));
  const prospectiveItems = new Map<string, ProspectiveItem>(openItemSnapshots.map((snapshot) => [snapshot.id, { snapshot, frontmatter: { ...snapshot.frontmatter }, body: snapshot.body, changed: false }]));
  const prospectiveEpics = new Map<string, ProspectiveEpic>(openEpicSnapshots.map((snapshot) => [snapshot.id, { snapshot, frontmatter: { ...snapshot.frontmatter }, body: snapshot.body, changed: false }]));

  validateTargetsAndPreconditions(draft, items, epics, draft.sourceFingerprint);
  draft.itemChanges.forEach((patch, index) => applyItemPatch(patch, requireProspective(prospectiveItems, patch.id, `backlogCurationDraft.itemChanges[${index}]`), `backlogCurationDraft.itemChanges[${index}]`));
  draft.epicChanges.forEach((patch, index) => applyEpicPatch(patch, requireProspective(prospectiveEpics, patch.id, `backlogCurationDraft.epicChanges[${index}]`), `backlogCurationDraft.epicChanges[${index}]`));
  draft.noOpRechecks.forEach((recheck, index) => applyRecheck(recheck, recheck.kind === 'item' ? requireProspective(prospectiveItems, recheck.id, `backlogCurationDraft.noOpRechecks[${index}]`) : requireProspective(prospectiveEpics, recheck.id, `backlogCurationDraft.noOpRechecks[${index}]`)));

  const prospectiveItemIds = new Set(prospectiveItems.keys());
  const prospectiveEpicIds = new Set(prospectiveEpics.keys());
  validateProspectiveReferences(prospectiveItems, prospectiveEpics, prospectiveItemIds, prospectiveEpicIds);

  const generatedRecommendations = rawResult?.recommendations === undefined ? undefined : parseGeneratedRecommendations(rawResult.recommendations);
  if (generatedRecommendations !== undefined) validateRecommendationReferencesAgainstIds(generatedRecommendations, prospectiveItemIds, prospectiveEpicIds);

  const changedItems = [...prospectiveItems.values()].filter((entry) => entry.changed);
  const changedEpics = [...prospectiveEpics.values()].filter((entry) => entry.changed);
  const preRecommendationFingerprint = generatedRecommendations === undefined ? await computeRecommendationSourceFingerprint(cwd) : undefined;
  for (const entry of changedItems) await replaceBacklogItemRecord(cwd, entry.snapshot.id, entry.frontmatter, entry.body);
  for (const entry of changedEpics) await replaceBacklogEpicRecord(cwd, entry.snapshot.id, entry.frontmatter, entry.body);

  const changedIds = [...changedItems.map((entry) => entry.snapshot.id), ...changedEpics.map((entry) => entry.snapshot.id)];
  let recommendationBlock: BacklogCurationApplyDetails['recommendations'];
  let recommendationStatus: BacklogCurationApplyDetails['recommendationStatus'];
  if (generatedRecommendations !== undefined) {
    const postApplyFingerprint = await computeRecommendationSourceFingerprint(cwd);
    const recommendations = await writeRecommendations(cwd, generatedRecommendations);
    const status = await recordPlannerRecommendationAppliedForSourceFingerprint(cwd, postApplyFingerprint, 'apply-backlog-curation-draft');
    recommendationBlock = { recommendations, recommendationSummary: summarizeRecommendations(recommendations)!, path: resolveRecommendationsPathForCwd(cwd), status };
    recommendationStatus = status;
  } else if (preRecommendationFingerprint !== undefined) {
    const postRecommendationFingerprint = await computeRecommendationSourceFingerprint(cwd);
    if (preRecommendationFingerprint !== postRecommendationFingerprint) {
      recommendationStatus = await markRecommendationsStaleForBacklogMutation(cwd, 'backlog-curation', changedIds) ?? undefined;
    }
  }
  await markPlanningTaskWorkflowEntryApplied(cwd, task.taskId, new Date().toISOString());
  return {
    itemChanges: draft.itemChanges.length,
    epicChanges: draft.epicChanges.length,
    noOpRechecks: draft.noOpRechecks.length,
    changedItemIds: changedItems.map((entry) => entry.snapshot.id),
    changedEpicIds: changedEpics.map((entry) => entry.snapshot.id),
    recheckedItemIds: draft.noOpRechecks.filter((entry) => entry.kind === 'item').map((entry) => entry.id),
    recheckedEpicIds: draft.noOpRechecks.filter((entry) => entry.kind === 'epic').map((entry) => entry.id),
    skipped: draft.skipped,
    needsInput: draft.needsInput,
    ...(recommendationBlock !== undefined && { recommendations: recommendationBlock }),
    ...(recommendationStatus !== undefined && { recommendationStatus }),
  };
}

export function applySectionOperations(body: string, operations: readonly { heading: string; action: 'replace' | 'append'; content: string }[]): string {
  let next = body;
  for (const operation of operations) next = applySectionOperation(next, operation);
  return next;
}

function parseDraft(value: unknown) {
  const result = safeParseWithSchema(EforgePlanPlanningBacklogCurationDraftSchema, value);
  if (result.success) return result.data;
  throw new ExtensionActionInputValidationError('Invalid backlog curation draft.', result.error.errors.map((error) => ({ path: fieldPath('backlogCurationDraft', error.path), message: error.message })));
}

function parseGeneratedRecommendations(value: unknown): BacklogRecommendationModel {
  try {
    return parseRecommendationModel(value) as BacklogRecommendationModel;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid generated recommendations.';
    throw validationError('result.recommendations', message);
  }
}

function assertCompletedPlanningDraftTask(task: PlanningAgentTaskRecordLike): void {
  if (task.kind !== 'eforge-plan.planning-draft') throw new Error(`Task ${task.taskId} is not an eforge-plan planning-draft task.`);
  if (task.status !== 'completed') throw new Error(`Planning task ${task.taskId} is ${task.status}; only completed tasks can be applied.`);
  if (!('result' in task)) throw new Error(`Planning task ${task.taskId} completed without a result.`);
}

function validateTargetsAndPreconditions(draft: Draft, items: Map<string, BacklogRecordSnapshot<BacklogItem>>, epics: Map<string, BacklogRecordSnapshot<BacklogEpic>>, sourceFingerprint: string): void {
  const seen = new Set<string>();
  for (const [kind, patches, snapshots, field] of [
    ['item', draft.itemChanges, items, 'backlogCurationDraft.itemChanges'],
    ['epic', draft.epicChanges, epics, 'backlogCurationDraft.epicChanges'],
  ] as const) {
    patches.forEach((patch, index) => {
      validatePatchBasics(patch, `${field}[${index}]`);
      validateTarget(kind, patch.id, seen, `${field}[${index}]`);
      validatePrecondition(patch.precondition, snapshots.get(patch.id), `${field}[${index}].precondition`, sourceFingerprint);
    });
  }
  draft.noOpRechecks.forEach((recheck, index) => {
    validateTarget(recheck.kind, recheck.id, seen, `backlogCurationDraft.noOpRechecks[${index}]`);
    validatePrecondition(recheck.precondition, recheck.kind === 'item' ? items.get(recheck.id) : epics.get(recheck.id), `backlogCurationDraft.noOpRechecks[${index}].precondition`, sourceFingerprint);
  });
}

function validatePatchBasics(patch: Patch, path: string): void {
  if ((patch.rationale ?? '').trim().length === 0) throw validationError(`${path}.rationale`, 'Material curation patches require non-empty rationale.');
  for (const [index, operation] of (patch.sectionOperations ?? []).entries()) {
    if (!isValidSectionHeading(operation.heading)) throw validationError(`${path}.sectionOperations[${index}].heading`, 'Section headings must be non-empty single-line headings.');
    if (operation.heading.trim() === 'Evidence' && operation.action === 'replace') throw validationError(`${path}.sectionOperations[${index}].action`, 'Evidence section operations must be append-only to preserve durable historical evidence.');
  }
  const changesEvidence = (patch.sectionOperations ?? []).some((operation) => operation.heading.trim() === 'Evidence');
  const status = patch.metadata?.status;
  if (status !== undefined && !isBacklogStatus(status)) throw validationError(`${path}.metadata.status`, `Unknown backlog status "${status}".`);
  if ((status !== undefined && isBacklogStatus(status) && isClosedStatus(status)) || changesEvidence) {
    if ((patch.evidence ?? []).every((entry) => entry.trim().length === 0)) throw validationError(`${path}.evidence`, 'Closed-status transitions and Evidence section changes require durable evidence entries.');
  }
}

function validateTarget(kind: string, id: string, seen: Set<string>, path: string): void {
  try {
    assertSafeBacklogId(id);
  } catch (error) {
    const message = error instanceof Error ? error.message : `Unsafe backlog id "${id}".`;
    throw validationError(`${path}.id`, message);
  }
  const key = `${kind}:${id}`;
  if (seen.has(key)) throw validationError(`${path}.id`, `Duplicate curation target ${key}.`);
  seen.add(key);
}

function validatePrecondition(precondition: { kind: string; id: string; bodySha256: string; recordSha256?: string; updated?: string; sourceFingerprint?: string }, snapshot: BacklogRecordSnapshot<BacklogItem | BacklogEpic> | undefined, path: string, sourceFingerprint: string): void {
  if (snapshot === undefined) throw validationError(`${path}.id`, `Curation target ${precondition.id} does not exist.`);
  if (precondition.kind !== snapshot.kind || precondition.id !== snapshot.id) throw validationError(path, 'Curation precondition target does not match the current snapshot.');
  if (precondition.bodySha256 !== snapshot.bodySha256) throw validationError(`${path}.bodySha256`, 'Curation draft body precondition is stale.');
  if (precondition.recordSha256 !== undefined && precondition.recordSha256 !== snapshot.recordSha256) throw validationError(`${path}.recordSha256`, 'Curation draft record precondition is stale.');
  if (precondition.updated !== undefined && precondition.updated !== snapshot.updated) throw validationError(`${path}.updated`, 'Curation draft updated precondition is stale.');
  if (precondition.sourceFingerprint !== undefined && precondition.sourceFingerprint !== sourceFingerprint) throw validationError(`${path}.sourceFingerprint`, 'Curation draft source precondition is stale.');
}

function applyItemPatch(patch: ItemPatch, target: ProspectiveItem, path: string): void {
  const before = canonicalRecord(target, 'item');
  applyMetadataPatch(patch, target.frontmatter, 'item');
  target.body = applySectionOperations(target.body, patch.sectionOperations ?? []);
  target.body = appendEvidence(target.body, patch.evidence ?? []);
  normalizeBacklogItem(target.frontmatter, target.body);
  if (before === canonicalRecord(target, 'item')) throw validationError(path, 'Material item curation patch produced no effective backlog record change; use noOpRechecks instead.');
  target.changed = true;
  target.patchPath = path;
}

function applyEpicPatch(patch: EpicPatch, target: ProspectiveEpic, path: string): void {
  if (patch.metadata?.epic !== undefined) throw validationError(`${path}.metadata.epic`, 'Epic patches cannot include item epic metadata.');
  if (patch.metadata?.depends_on !== undefined) throw validationError(`${path}.metadata.depends_on`, 'Epic patches cannot include item dependency metadata.');
  const before = canonicalRecord(target, 'epic');
  applyMetadataPatch(patch, target.frontmatter, 'epic');
  target.body = applySectionOperations(target.body, patch.sectionOperations ?? []);
  target.body = appendEvidence(target.body, patch.evidence ?? []);
  normalizeBacklogEpic(target.frontmatter, target.body);
  if (before === canonicalRecord(target, 'epic')) throw validationError(path, 'Material epic curation patch produced no effective backlog record change; use noOpRechecks instead.');
  target.changed = true;
  target.patchPath = path;
}

function canonicalRecord(target: ProspectiveItem | ProspectiveEpic, kind: 'item' | 'epic'): string {
  return canonicalJson(kind === 'item' ? normalizeBacklogItem({ ...target.frontmatter }, target.body) : normalizeBacklogEpic({ ...target.frontmatter }, target.body));
}

function applyMetadataPatch(patch: Patch, frontmatter: Record<string, unknown>, kind: 'item' | 'epic'): void {
  const metadata = patch.metadata ?? {};
  for (const key of ['status', 'priority', 'tags', 'depends_on', 'last_checked', 'stale_after'] as const) {
    if (metadata[key] !== undefined) frontmatter[key] = metadata[key];
  }
  if (kind === 'item' && 'epic' in metadata) {
    if (metadata.epic === null) delete frontmatter.epic;
    else if (metadata.epic !== undefined) frontmatter.epic = metadata.epic;
  }
}

function applyRecheck(recheck: Recheck, target: ProspectiveItem | ProspectiveEpic): void {
  target.frontmatter.last_checked = recheck.last_checked;
  target.frontmatter.stale_after = recheck.stale_after;
  if (recheck.kind === 'item') normalizeBacklogItem(target.frontmatter, target.body);
  else normalizeBacklogEpic(target.frontmatter, target.body);
  target.changed = true;
}

function validateProspectiveReferences(items: Map<string, ProspectiveItem>, epics: Map<string, ProspectiveEpic>, itemIds: Set<string>, epicIds: Set<string>): void {
  for (const [id, entry] of items) {
    const normalized = normalizeBacklogItem(entry.frontmatter, entry.body);
    const path = entry.patchPath ?? `backlogCurationDraft.itemChanges.${id}`;
    normalized.depends_on.forEach((dependencyId, index) => {
      if (!itemIds.has(dependencyId)) throw validationError(`${path}.metadata.depends_on[${index}]`, `Unknown dependency item id "${dependencyId}".`);
    });
    if (normalized.epic !== undefined && !epicIds.has(normalized.epic)) throw validationError(`${path}.metadata.epic`, `Unknown epic id "${normalized.epic}".`);
  }
  for (const [, entry] of epics) normalizeBacklogEpic(entry.frontmatter, entry.body);
}

function requireProspective<T>(map: Map<string, T>, id: string, path: string): T {
  const value = map.get(id);
  if (value === undefined) throw validationError(`${path}.id`, `Unknown curation target "${id}".`);
  return value;
}

function isValidSectionHeading(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && !/[\r\n]/.test(trimmed) && !trimmed.startsWith('#');
}

function applySectionOperation(body: string, operation: { heading: string; action: 'replace' | 'append'; content: string }): string {
  const heading = operation.heading.trim();
  const lines = splitLinesPreservingEndings(body);
  const start = lines.findIndex((line) => new RegExp(`^#{2,6}\\s+${escapeRegExp(heading)}\\s*$`).test(line.replace(/\r?\n$/u, '')));
  if (start === -1) return appendNewSection(body, heading, operation.content);
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^#{2,6}\s+/.test(lines[index])) { end = index; break; }
  }
  const prefix = lines.slice(0, start + 1).join('');
  const existing = lines.slice(start + 1, end).join('').trim();
  const suffix = lines.slice(end).join('');
  const content = operation.action === 'replace' || existing.length === 0 ? operation.content.trim() : `${existing}\n\n${operation.content.trim()}`;
  return `${prefix}\n${content}\n${suffix.startsWith('\n') || suffix.length === 0 ? '' : '\n'}${suffix}`;
}

function splitLinesPreservingEndings(value: string): string[] {
  const matches = value.match(/.*(?:\r?\n|$)/gu) ?? [];
  return matches.filter((line, index) => line.length > 0 || index < matches.length - 1);
}

function appendNewSection(body: string, heading: string, content: string): string {
  return `${body.trimEnd()}\n\n## ${heading}\n\n${content.trim()}\n`;
}

function appendEvidence(body: string, evidence: readonly string[]): string {
  const bullets = evidence.map((entry) => entry.trim()).filter(Boolean).map((entry) => `- ${entry}`).join('\n');
  return bullets.length === 0 ? body : applySectionOperation(body, { heading: 'Evidence', action: 'append', content: bullets });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function fieldPath(root: string, pointer: string): string {
  if (pointer.length === 0) return root;
  return pointer.split('/').filter(Boolean).reduce((path, part) => (/^\d+$/.test(part) ? `${path}[${part}]` : `${path}.${part}`), root);
}

function validationError(path: string, message: string): ExtensionActionInputValidationError {
  return new ExtensionActionInputValidationError(message, [{ path, message }]);
}
