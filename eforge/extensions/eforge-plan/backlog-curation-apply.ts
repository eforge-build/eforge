import { EforgePlanPlanningBacklogCurationDraftSchema, safeParseWithSchema } from '@eforge-build/client';
import { ExtensionActionInputValidationError, Type } from '@eforge-build/extension-sdk';
import { isBacklogStatus, isClosedStatus, isOpenStatus, normalizeBacklogEpic, normalizeBacklogItem, type BacklogEpic, type BacklogItem, type TraceSummary } from './backlog-domain.js';
import { buildProspectiveCurationProjection, type ProspectiveCurationProjection, type RecommendationReferenceRecord as ProjectionReferenceRecord } from './backlog-curation-recommendation-overlay.js';
import { recordAcceptedAnalysisBaselineForApply } from './backlog-curation-accepted-baseline.js';
import { SHIPPED_CURRENT_SOURCE_EVIDENCE_PREFIX, SUPERSEDED_CURRENT_SOURCE_EVIDENCE_PREFIX, validateClosedStatusEvidencePrefix } from './backlog-curation-evidence-prefixes.js';
import { appendEvidence, applySectionOperations, fieldPath } from './backlog-curation-apply-utils.js';
export { applySectionOperations } from './backlog-curation-apply-utils.js';
import { summarizeProjectTraces } from './trace-activity.js';
import { assertSafeBacklogId, listBacklogEpicSnapshots, listBacklogItemSnapshots, type BacklogRecordSnapshot } from './markdown-store.js';
import { canonicalJson } from './markdown-store-support.js';
import { captureCanonicalBacklogItem, upsertCanonicalEpic } from './canonical/backlog-records.js';
import { deriveItemSectionRows } from './canonical/item-body-sections.js';
import { computeRecommendationSourceFingerprint, computeRecommendationSourceFingerprintForRecords, markRecommendationsStaleForBacklogMutation, readRecommendationFreshnessView, recordPlannerRecommendationAppliedForSourceFingerprint, throwRecommendationReferenceValidationError } from './recommendation-status.js';
import { resolveRecommendationsPathForCwd, summarizeRecommendations, writeRecommendations } from './recommendations-store.js';
import { markPlanningTaskWorkflowEntryApplied, isBacklogCurationWorkflowEntry } from './planning-task-workflow-store.js';
import type { ApplyPlanningAgentTaskResultInput, PlanningTaskWorkflowEntry } from './planning-agent-task-schemas.js';
import { type BacklogCurationApplyDetails, type BacklogCurationFullImplementationAuditPreview, type BacklogCurationPreviewDetails, type BacklogCurationRecommendationProjection, type RecommendationReferenceValidationResult } from './backlog-curation-schemas.js';
import { readBacklogCurationSourcePreviewMetadata } from './backlog-curation-source.js';
import { RecommendationBlockedChainSchema, RecommendationItemRefSchema, RecommendationProfileSchema } from './schema.js';
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
type CanonicalItemInput = Parameters<typeof captureCanonicalBacklogItem>[1];
type CanonicalEpicInput = Parameters<typeof upsertCanonicalEpic>[1];
function canonicalItemInput(entry: ProspectiveItem): CanonicalItemInput {
  const normalized = normalizeBacklogItem(entry.frontmatter, entry.body);
  const epic = normalized.epic;
  const frontmatter = { ...entry.frontmatter };
  if (epic === undefined) delete frontmatter.epic;
  return {
    id: entry.snapshot.id,
    title: stringValue(entry.frontmatter.title) ?? entry.snapshot.record.title,
    body: entry.body,
    status: canonicalStatus(stringValue(entry.frontmatter.status) ?? entry.snapshot.record.status),
    priority: stringValue(entry.frontmatter.priority) ?? entry.snapshot.record.priority,
    source: stringValue(entry.frontmatter.source),
    tags: stringArray(entry.frontmatter.tags),
    dependsOn: stringArray(entry.frontmatter.depends_on),
    epic,
    created: stringValue(entry.frontmatter.created) ?? entry.snapshot.record.created,
    updated: stringValue(entry.frontmatter.updated) ?? new Date().toISOString(),
    lastCheckedAt: stringValue(entry.frontmatter.last_checked), staleAfter: stringValue(entry.frontmatter.stale_after),
    frontmatter, sections: deriveItemSectionRows(entry.body),
  };
}
function canonicalEpicInput(entry: ProspectiveEpic): CanonicalEpicInput {
  return {
    id: entry.snapshot.id,
    title: stringValue(entry.frontmatter.title) ?? entry.snapshot.record.title,
    body: entry.body,
    status: canonicalStatus(stringValue(entry.frontmatter.status) ?? entry.snapshot.record.status),
    priority: stringValue(entry.frontmatter.priority) ?? entry.snapshot.record.priority,
    tags: stringArray(entry.frontmatter.tags),
    created: stringValue(entry.frontmatter.created) ?? entry.snapshot.record.created,
    updated: stringValue(entry.frontmatter.updated) ?? new Date().toISOString(),
    frontmatter: entry.frontmatter,
  };
}
function precomputeCanonicalItemInputs(entries: readonly ProspectiveItem[]): CanonicalItemInput[] {
  return entries.map((entry) => {
    try { return canonicalItemInput(entry); }
    catch (error) { throw validationError(entry.patchPath ?? `backlogCurationDraft.itemChanges.${entry.snapshot.id}`, error instanceof Error ? error.message : String(error)); }
  });
}
function stringValue(value: unknown): string | undefined { return typeof value === 'string' && value.length > 0 ? value : undefined; }
function stringArray(value: unknown): string[] { return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []; }
function canonicalStatus(value: string | undefined): BacklogItem['status'] { return isBacklogStatus(value) ? value : 'candidate'; }
// --- eforge:region apply-entrypoint ---
export async function applyBacklogCurationDraftFromTask(
  cwd: string,
  task: PlanningAgentTaskRecordLike,
  input: ApplyPlanningAgentTaskResultInput,
  entry: PlanningTaskWorkflowEntry | undefined,
): Promise<BacklogCurationApplyDetails> {
  if (input.applyBacklogCurationDraft?.previewAcknowledged !== true || input.applyBacklogCurationDraft.confirmApply !== true) {
    throw validationError('applyBacklogCurationDraft', 'Applying a backlog curation draft requires previewAcknowledged: true and confirmApply: true.');
  }
  const applyCurationOnly = input.applyBacklogCurationDraft.applyCurationOnly === true;
  const prepared = await prepareBacklogCurationDraftApply(cwd, task, entry, { skipGeneratedRecommendationErrors: applyCurationOnly });
  if (prepared.generatedRecommendations !== undefined && !prepared.recommendationProjection.validation.valid && !applyCurationOnly) {
    throwRecommendationReferenceValidationError(prepared.recommendationProjection.validation.issues);
  }
  const skipGeneratedRecommendations = prepared.generatedRecommendationsPresent && applyCurationOnly;
  const preRecommendationFingerprint = prepared.generatedRecommendations === undefined || skipGeneratedRecommendations
    ? await computeRecommendationSourceFingerprint(cwd)
    : undefined;
  const changedItemInputs = precomputeCanonicalItemInputs(prepared.changedItems);
  const changedEpicInputs = prepared.changedEpics.map(canonicalEpicInput);
  for (const input of changedItemInputs) captureCanonicalBacklogItem(cwd, input);
  for (const input of changedEpicInputs) upsertCanonicalEpic(cwd, input);
  const changedIds = [...prepared.changedItems.map((entry) => entry.snapshot.id), ...prepared.changedEpics.map((entry) => entry.snapshot.id)];
  let recommendationBlock: BacklogCurationApplyDetails['recommendations'];
  let recommendationStatus: BacklogCurationApplyDetails['recommendationStatus'];
  if (prepared.recommendationProjection.effectiveRecommendations !== undefined && !skipGeneratedRecommendations) {
    const postApplyFingerprint = await computeRecommendationSourceFingerprint(cwd);
    const recommendations = await writeRecommendations(cwd, prepared.recommendationProjection.effectiveRecommendations);
    const status = await recordPlannerRecommendationAppliedForSourceFingerprint(cwd, postApplyFingerprint, 'apply-backlog-curation-draft');
    recommendationBlock = { recommendations, recommendationSummary: summarizeRecommendations(recommendations)!, path: resolveRecommendationsPathForCwd(cwd), status };
    recommendationStatus = status;
  } else if (preRecommendationFingerprint !== undefined) {
    const postRecommendationFingerprint = await computeRecommendationSourceFingerprint(cwd);
    if (preRecommendationFingerprint !== postRecommendationFingerprint) {
      recommendationStatus = await markRecommendationsStaleForBacklogMutation(cwd, 'backlog-curation', changedIds) ?? undefined;
    }
  }
  await recordAcceptedAnalysisBaselineForApply(cwd, { taskId: task.taskId, passKind: 'backlog-curation', sourceFingerprint: prepared.draft.sourceFingerprint });
  await markPlanningTaskWorkflowEntryApplied(cwd, task.taskId, new Date().toISOString());
  return {
    itemChanges: prepared.draft.itemChanges.length,
    epicChanges: prepared.draft.epicChanges.length,
    noOpRechecks: prepared.effectiveRechecks.length,
    skippedFreshRechecks: prepared.draft.noOpRechecks.length - prepared.effectiveRechecks.length,
    changedItemIds: prepared.changedItems.map((entry) => entry.snapshot.id),
    changedEpicIds: prepared.changedEpics.map((entry) => entry.snapshot.id),
    recheckedItemIds: prepared.effectiveRechecks.filter(({ recheck }) => recheck.kind === 'item').map(({ recheck }) => recheck.id),
    recheckedEpicIds: prepared.effectiveRechecks.filter(({ recheck }) => recheck.kind === 'epic').map(({ recheck }) => recheck.id),
    skipped: prepared.draft.skipped,
    needsInput: prepared.draft.needsInput,
    ...(recommendationBlock !== undefined && { recommendations: recommendationBlock }),
    ...(recommendationStatus !== undefined && { recommendationStatus }),
    ...(prepared.generatedRecommendationsPresent && { generatedRecommendationValidation: prepared.generatedRecommendationValidation }),
    ...(prepared.generatedRecommendationsPresent && { recommendationProjection: prepared.recommendationProjection }),
    ...(skipGeneratedRecommendations && { recommendationsSkipped: { reason: 'apply-curation-only', generatedRecommendationValidation: prepared.generatedRecommendationValidation } }),
  };
}
export async function previewBacklogCurationDraftFromTask(cwd: string, task: PlanningAgentTaskRecordLike, entry: PlanningTaskWorkflowEntry | undefined): Promise<BacklogCurationPreviewDetails> {
  try {
    const prepared = await prepareBacklogCurationDraftApply(cwd, task, entry, { skipGeneratedRecommendationErrors: true });
    const [recommendationFreshness, sourceMetadata] = await Promise.all([
      readRecommendationFreshnessView(cwd, prepared.prospectiveRecommendationSourceFingerprint),
      readBacklogCurationSourcePreviewMetadata(cwd, prepared.draft.sourceFingerprint),
    ]);
    return {
      valid: prepared.generatedRecommendationValidation.valid,
      itemChanges: prepared.draft.itemChanges.length,
      epicChanges: prepared.draft.epicChanges.length,
      noOpRechecks: prepared.effectiveRechecks.length,
      recommendationFreshness,
      ...(sourceMetadata?.gitDelta !== undefined && { gitDelta: sourceMetadata.gitDelta }),
      ...(sourceMetadata?.fullImplementationAudit !== undefined && { fullImplementationAudit: sourceMetadata.fullImplementationAudit }),
      ...(prepared.generatedRecommendationsPresent && { generatedRecommendationValidation: prepared.generatedRecommendationValidation }),
      ...(prepared.generatedRecommendationsPresent && { recommendationProjection: prepared.recommendationProjection }),
    };
  } catch (err) {
    return { valid: false, errors: previewErrorsFromError(err) };
  }
}
export async function validateBacklogCurationPlanningDraftResult(cwd: string, result: unknown, context?: { sourceFingerprint?: string }): Promise<string[]> {
  try {
    const expectedSourceFingerprint = context?.sourceFingerprint;
    const rawResult = result as Record<string, unknown> | undefined;
    const rawDraft = rawResult?.backlogCurationDraft as { sourceFingerprint?: unknown } | undefined;
    if (expectedSourceFingerprint !== undefined && rawDraft?.sourceFingerprint !== undefined && rawDraft.sourceFingerprint !== expectedSourceFingerprint) {
      return [`backlogCurationDraft.sourceFingerprint: Curation draft source fingerprint must match ${expectedSourceFingerprint}.`];
    }
    await prepareBacklogCurationDraftApply(cwd, {
      taskId: 'backlog-curation-reducer-validation',
      kind: 'eforge-plan.planning-draft',
      status: 'completed',
      result,
    }, {
      taskId: 'backlog-curation-reducer-validation',
      originalRequest: '',
      derivedRequest: 'Analyze and curate all open eforge-plan backlog records.',
      selection: {},
      requestedOutputSections: ['backlogCurationDraft', 'recommendations'],
      includeRoadmap: true,
      purpose: 'backlog-curation',
      ...(expectedSourceFingerprint !== undefined && { sourceFingerprint: expectedSourceFingerprint }),
      createdAt: new Date().toISOString(),
    }, { skipGeneratedRecommendationErrors: false });
    return [];
  } catch (err) {
    if (!(err instanceof ExtensionActionInputValidationError)) throw err;
    return previewErrorsFromError(err).map((error) => `${error.path}: ${error.message}`);
  }
}
// --- eforge:endregion apply-entrypoint ---
// --- eforge:region validation-helpers ---
function parseDraft(value: unknown) {
  const result = safeParseWithSchema(EforgePlanPlanningBacklogCurationDraftSchema, value);
  if (result.success) return result.data;
  throw new ExtensionActionInputValidationError('Invalid backlog curation draft.', result.error.errors.map((error) => ({ path: fieldPath('backlogCurationDraft', error.path), message: error.message })));
}
const BacklogCurationGeneratedRecommendationGroupSchema = Type.Object({
  ref: Type.String(),
  title: Type.Optional(Type.String()),
  itemIds: Type.Array(Type.String()),
  epicIds: Type.Optional(Type.Array(Type.String())),
  safeToPlanTogether: Type.Optional(Type.Boolean()),
  rationale: Type.Optional(Type.String()),
  recommendedProfile: Type.Optional(RecommendationProfileSchema),
}, { additionalProperties: false });
const BacklogCurationGeneratedRecommendationModelSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  updatedAt: Type.Optional(Type.String()),
  activeWork: Type.Array(RecommendationItemRefSchema),
  readyCandidates: Type.Array(RecommendationItemRefSchema),
  recommendedNextSequence: Type.Array(RecommendationItemRefSchema),
  safeParallelizableGroups: Type.Array(BacklogCurationGeneratedRecommendationGroupSchema),
  blockedChains: Type.Array(RecommendationBlockedChainSchema),
  rationaleAndAssumptions: Type.Array(Type.String()),
}, { additionalProperties: false });
function parseGeneratedRecommendations(value: unknown): BacklogRecommendationModel {
  const result = safeParseWithSchema(BacklogCurationGeneratedRecommendationModelSchema, value);
  if (result.success) return result.data as BacklogRecommendationModel;
  throw validationError('result.recommendations', result.error.errors.map((error) => `${fieldPath('result.recommendations', error.path)}: ${error.message}`).join('; '));
}
// --- eforge:region recommendation-validation ---
interface PreparedBacklogCurationApply {
  draft: Draft;
  effectiveRechecks: Array<{ recheck: Recheck; target: ProspectiveItem | ProspectiveEpic }>;
  changedItems: ProspectiveItem[];
  changedEpics: ProspectiveEpic[];
  generatedRecommendations?: BacklogRecommendationModel;
  generatedRecommendationsPresent: boolean;
  generatedRecommendationValidation: RecommendationReferenceValidationResult;
  recommendationProjection: BacklogCurationRecommendationProjection;
  prospectiveRecommendationSourceFingerprint: string;
}
async function prepareBacklogCurationDraftApply(cwd: string, task: PlanningAgentTaskRecordLike, entry: PlanningTaskWorkflowEntry | undefined, options: { skipGeneratedRecommendationErrors?: boolean } = {}): Promise<PreparedBacklogCurationApply> {
  assertCompletedPlanningDraftTask(task);
  if (entry === undefined || !isBacklogCurationWorkflowEntry(entry)) {
    throw validationError('workflowEntry.purpose', 'Applying a backlog curation draft requires a backlog-curation workflow entry.');
  }
  const rawResult = task.result as Record<string, unknown> | undefined;
  const draft = parseDraft(rawResult?.backlogCurationDraft);
  if (entry.sourceFingerprint !== undefined && draft.sourceFingerprint !== entry.sourceFingerprint) throw validationError('backlogCurationDraft.sourceFingerprint', 'Curation draft source fingerprint does not match the workflow entry.');
  const [itemSnapshots, epicSnapshots, sourceMetadata] = await Promise.all([listBacklogItemSnapshots(cwd), listBacklogEpicSnapshots(cwd), readBacklogCurationSourcePreviewMetadata(cwd, draft.sourceFingerprint)]);
  const openItemSnapshots = itemSnapshots.filter((snapshot) => isOpenStatus(snapshot.record.status));
  const openEpicSnapshots = epicSnapshots.filter((snapshot) => isOpenStatus(snapshot.record.status));
  const items = new Map(openItemSnapshots.map((snapshot) => [snapshot.id, snapshot]));
  const epics = new Map(openEpicSnapshots.map((snapshot) => [snapshot.id, snapshot]));
  const prospectiveItems = new Map<string, ProspectiveItem>(openItemSnapshots.map((snapshot) => [snapshot.id, { snapshot, frontmatter: { ...snapshot.frontmatter }, body: snapshot.body, changed: false }]));
  const prospectiveEpics = new Map<string, ProspectiveEpic>(openEpicSnapshots.map((snapshot) => [snapshot.id, { snapshot, frontmatter: { ...snapshot.frontmatter }, body: snapshot.body, changed: false }]));
  validateTargetsAndPreconditions(draft, items, epics, draft.sourceFingerprint);
  validateFullImplementationAuditPatchMetadata(draft, sourceMetadata?.fullImplementationAudit);
  const effectiveRechecks = draft.noOpRechecks
    .map((recheck, index) => ({ recheck, target: prospectiveForRecheck(recheck, index, prospectiveItems, prospectiveEpics) }))
    .filter(({ target }) => shouldApplyRecheck(target));
  draft.itemChanges.forEach((patch, index) => applyItemPatch(patch, requireProspective(prospectiveItems, patch.id, `backlogCurationDraft.itemChanges[${index}]`), `backlogCurationDraft.itemChanges[${index}]`));
  draft.epicChanges.forEach((patch, index) => applyEpicPatch(patch, requireProspective(prospectiveEpics, patch.id, `backlogCurationDraft.epicChanges[${index}]`), `backlogCurationDraft.epicChanges[${index}]`));
  effectiveRechecks.forEach(({ recheck, target }) => applyRecheck(recheck, target));

  const visibleItemIds = new Set(itemSnapshots.map((snapshot) => snapshot.id));
  const visibleEpicIds = new Set(epicSnapshots.map((snapshot) => snapshot.id));
  validateProspectiveReferences(prospectiveItems, prospectiveEpics, visibleItemIds, visibleEpicIds);

  const traceSummaries = await summarizeProjectTraces(cwd);
  const currentItems = buildCurrentItemRecords(itemSnapshots, traceSummaries);
  const currentEpics = buildCurrentEpicRecords(epicSnapshots);
  const generatedRecommendationsPresent = rawResult?.recommendations !== undefined;
  const parsedGeneratedRecommendations = generatedRecommendationsPresent && !options.skipGeneratedRecommendationErrors
    ? parseGeneratedRecommendations(rawResult.recommendations)
    : undefined;
  const generatedRecommendations = parsedGeneratedRecommendations;
  const recommendationProjection = parsedGeneratedRecommendations === undefined
    ? recommendationProjectionForSkipped(rawResult?.recommendations, generatedRecommendationsPresent, currentItems, currentEpics, draft)
    : serializeProjection(buildProspectiveCurationProjection({ currentItems, currentEpics, draft, generatedRecommendations: parsedGeneratedRecommendations }));
  const generatedRecommendationValidation = recommendationProjection.validation;
  const prospectiveRecommendationSourceFingerprint = await computeRecommendationSourceFingerprintForRecords(
    cwd,
    [...prospectiveItems.values()].map((entry) => normalizeBacklogItem({ ...entry.frontmatter }, entry.body)),
    [...prospectiveEpics.values()].map((entry) => normalizeBacklogEpic({ ...entry.frontmatter }, entry.body)),
  );

  return {
    draft,
    effectiveRechecks,
    changedItems: [...prospectiveItems.values()].filter((prospective) => prospective.changed),
    changedEpics: [...prospectiveEpics.values()].filter((prospective) => prospective.changed),
    ...(generatedRecommendations !== undefined && { generatedRecommendations }),
    generatedRecommendationsPresent,
    generatedRecommendationValidation,
    recommendationProjection,
    prospectiveRecommendationSourceFingerprint,
  };
}

function recommendationProjectionForSkipped(value: unknown, present: boolean, items: ProjectionReferenceRecord[], epics: ProjectionReferenceRecord[], draft: Draft): BacklogCurationRecommendationProjection {
  if (!present) return { removed: { itemIds: [], epicIds: [] }, repositioned: [], validation: { valid: true, issues: [] } };
  try {
    return serializeProjection(buildProspectiveCurationProjection({ currentItems: items, currentEpics: epics, draft, generatedRecommendations: parseGeneratedRecommendations(value) }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid generated recommendations.';
    return { removed: { itemIds: [], epicIds: [] }, repositioned: [], validation: { valid: false, issues: [{ path: 'result.recommendations', id: '', kind: 'item', reason: 'unknown', message }] } };
  }
}

function serializeProjection(projection: ProspectiveCurationProjection): BacklogCurationRecommendationProjection {
  return {
    ...(projection.effectiveRecommendations !== undefined && { effectiveRecommendations: projection.effectiveRecommendations }),
    ...(projection.summary !== undefined && { recommendationSummary: projection.summary }),
    removed: projection.removed,
    repositioned: projection.repositioned,
    validation: projection.validation,
  };
}

function buildCurrentItemRecords(itemSnapshots: readonly BacklogRecordSnapshot<BacklogItem>[], traceSummaries: readonly TraceSummary[]): ProjectionReferenceRecord[] {
  const lifecycleByItemId = new Map(traceSummaries.map((summary) => [summary.itemId, summary.lifecycleState]));
  return itemSnapshots.map((snapshot) => ({
    id: snapshot.record.id,
    kind: 'item',
    title: snapshot.record.title,
    status: snapshot.record.status,
    ...(lifecycleByItemId.get(snapshot.record.id) !== undefined && { lifecycleState: lifecycleByItemId.get(snapshot.record.id) }),
  }));
}

function buildCurrentEpicRecords(epicSnapshots: readonly BacklogRecordSnapshot<BacklogEpic>[]): ProjectionReferenceRecord[] {
  return epicSnapshots.map((snapshot) => ({ id: snapshot.record.id, kind: 'epic', title: snapshot.record.title, status: snapshot.record.status }));
}

function previewErrorsFromError(err: unknown): Array<{ path: string; message: string }> {
  if (err instanceof ExtensionActionInputValidationError) return err.details.map((detail) => ({ path: detail.path, message: detail.message }));
  return [{ path: '', message: err instanceof Error ? err.message : String(err) }];
}
// --- eforge:endregion recommendation-validation ---

// --- eforge:region validation-helpers ---
function validateFullImplementationAuditPatchMetadata(draft: Draft, audit: BacklogCurationFullImplementationAuditPreview | undefined): void {
  draft.itemChanges.forEach((patch, index) => {
    const targetClosedStatus = patch.metadata?.status === 'shipped' || patch.metadata?.status === 'superseded' ? patch.metadata.status : undefined;
    if (targetClosedStatus !== undefined) validateSourceFirstClosedPatch(audit, patch, targetClosedStatus, `backlogCurationDraft.itemChanges[${index}]`);
  });
}

type FullAuditEvidenceSummary = NonNullable<NonNullable<BacklogCurationFullImplementationAuditPreview['itemSummaries']>[number]['evidence']>[number];

function validateSourceFirstClosedPatch(audit: BacklogCurationFullImplementationAuditPreview | undefined, patch: { kind?: string; id?: string; evidence?: string[]; metadata?: { status?: string } }, status: 'shipped' | 'superseded', path: string): void {
  const requiredPrefix = status === 'shipped' ? SHIPPED_CURRENT_SOURCE_EVIDENCE_PREFIX : SUPERSEDED_CURRENT_SOURCE_EVIDENCE_PREFIX;
  if ((patch.evidence ?? []).every((entry) => !entry.trim().startsWith(requiredPrefix))) throw validationError(`${path}.evidence`, `${status} status changes in source-first audit mode require evidence starting with ${requiredPrefix}`);
  const candidates = sourceFirstClosureCandidatesForPatch(audit, patch, status);
  const draftEvidence = (patch.evidence ?? []).join('\n').toLowerCase();
  const matching = candidates.filter(hasDisplayableSourceConfidence).filter((entry) => sourceFirstEvidenceMatchesDraft(entry, draftEvidence));
  if (matching.length === 0) {
    if (draftEvidenceHasRequiredClosureRoles(patch.evidence ?? [], status)) return;
    throw validationError(`${path}.evidence`, `Source-first ${status} patch for ${patch.id} requires matching strong current-source closure preview metadata or agent-verified current-source evidence with both required role labels.`);
  }
  if (!matching.some((entry) => sourceFirstCandidateHasRequiredEvidenceRoles(entry, status))) {
    if (draftEvidenceHasRequiredClosureRoles(patch.evidence ?? [], status)) return;
    throw validationError(`${path}.evidence`, `Source-first ${status} patch for ${patch.id} requires closure preview metadata or agent-verified current-source evidence with both core ${status === 'superseded' ? 'replacement' : 'implementation'} and product-surface wiring evidence.`);
  }
}

function draftEvidenceHasRequiredClosureRoles(evidence: readonly string[], status: 'shipped' | 'superseded'): boolean {
  const requiredPrefix = status === 'shipped' ? SHIPPED_CURRENT_SOURCE_EVIDENCE_PREFIX : SUPERSEDED_CURRENT_SOURCE_EVIDENCE_PREFIX;
  const currentSourceEvidence = evidence.map((entry) => entry.trim().toLowerCase()).filter((entry) => entry.startsWith(requiredPrefix.toLowerCase()));
  const implementationRole = status === 'superseded' ? 'replacement' : 'implementation';
  const hasImplementation = currentSourceEvidence.some((entry) => entry.includes(`${implementationRole}:`) || entry.includes('implementation:'));
  const hasProductSurface = currentSourceEvidence.some((entry) => entry.includes('product-surface:'));
  return hasImplementation && hasProductSurface;
}

function sourceFirstClosureCandidatesForPatch(audit: BacklogCurationFullImplementationAuditPreview | undefined, patch: { kind?: string; id?: string }, status: 'shipped' | 'superseded'): FullAuditEvidenceSummary[] {
  if (patch.kind !== 'item' || !patch.id) return [];
  const summary = audit?.itemSummaries?.find((item) => item.itemId === patch.id);
  const summaryCandidates = (summary?.closureCandidates ?? []).filter((entry) => isStrongClosureCandidateForStatus(entry, status));
  const topLevelCandidates = ((audit as BacklogCurationFullImplementationAuditPreview & { closureCandidates?: FullAuditEvidenceSummary[] } | undefined)?.closureCandidates ?? []).filter((entry) => ((entry as FullAuditEvidenceSummary & { itemId?: string }).itemId === patch.id) && isStrongClosureCandidateForStatus(entry, status));
  return [...summaryCandidates, ...topLevelCandidates];
}

function isStrongClosureCandidateForStatus(entry: FullAuditEvidenceSummary, status: 'shipped' | 'superseded'): boolean {
  const record = entry as FullAuditEvidenceSummary & { intent?: string; evidenceSource?: string };
  return record.intent === status && record.evidenceSource === 'current-source' && entry.confidence.trim().toLowerCase() === 'strong';
}

function sourceFirstCandidateHasRequiredEvidenceRoles(entry: FullAuditEvidenceSummary, status: 'shipped' | 'superseded'): boolean {
  const record = entry as FullAuditEvidenceSummary & { evidenceRoles?: unknown; citations?: unknown };
  const roles = new Set(Array.isArray(record.evidenceRoles) ? record.evidenceRoles.filter((role): role is string => typeof role === 'string') : []);
  const citations = Array.isArray(record.citations) ? record.citations as Array<Record<string, unknown>> : [];
  const citationKinds = new Set(citations.map((citation) => trimmedString(citation.kind)).filter((kind): kind is string => kind !== undefined));
  const implementationRole = status === 'superseded' ? 'replacement' : 'implementation';
  const hasImplementation = roles.has(implementationRole) || roles.has('implementation') || citationKinds.has('implementation');
  const hasProductSurface = roles.has('product-surface') || citationKinds.has('product-surface');
  return hasImplementation && hasProductSurface;
}

function hasDisplayableSourceConfidence(entry: { source?: string; confidence?: string }): boolean {
  return typeof entry.source === 'string' && entry.source.trim().length > 0 && typeof entry.confidence === 'string' && entry.confidence.trim().length > 0;
}

function sourceFirstEvidenceMatchesDraft(entry: FullAuditEvidenceSummary, draftEvidence: string): boolean {
  const record = entry as FullAuditEvidenceSummary & { citation?: string };
  const citations = Array.isArray(record.citations) ? record.citations as Array<Record<string, unknown>> : [];
  const path = trimmedString(entry.path);
  const excerpt = trimmedString(entry.excerpt);
  const citationText = trimmedString(record.citation);
  if (path !== undefined && draftEvidence.includes(path.toLowerCase())) return true;
  if (excerpt !== undefined && draftEvidence.includes(excerpt.toLowerCase().slice(0, Math.min(excerpt.length, 80)))) return true;
  if (citationText !== undefined && draftEvidence.includes(citationText.toLowerCase())) return true;
  return citations.some((citation) => {
    const citationPath = trimmedString(citation.path);
    return citationPath !== undefined && draftEvidence.includes(citationPath.toLowerCase());
  }) || citations.some((citation) => {
    const citationExcerpt = trimmedString(citation.excerpt);
    return citationExcerpt !== undefined && draftEvidence.includes(citationExcerpt.toLowerCase().slice(0, Math.min(citationExcerpt.length, 80)));
  });
}

function trimmedString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

// --- eforge:endregion validation-helpers ---

function assertCompletedPlanningDraftTask(task: PlanningAgentTaskRecordLike): void {
  if (task.kind !== 'eforge-plan.planning-draft') throw validationError('task.kind', `Task ${task.taskId} is not an eforge-plan planning-draft task.`);
  if (task.status !== 'completed') throw validationError('task.status', `Planning task ${task.taskId} is ${task.status}; only completed tasks can be applied.`);
  if (!('result' in task)) throw validationError('task.result', `Planning task ${task.taskId} completed without a result.`);
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
    if (isEvidenceHeading(operation.heading) && operation.action === 'replace') throw validationError(`${path}.sectionOperations[${index}].action`, 'Evidence section operations must be append-only to preserve durable historical evidence.');
  }
  const changesEvidence = (patch.sectionOperations ?? []).some((operation) => isEvidenceHeading(operation.heading));
  const status = patch.metadata?.status;
  if (status !== undefined && !isBacklogStatus(status)) throw validationError(`${path}.metadata.status`, `Unknown backlog status "${status}".`);
  if ((status !== undefined && isBacklogStatus(status) && isClosedStatus(status)) || changesEvidence) {
    if ((patch.evidence ?? []).every((entry) => entry.trim().length === 0)) throw validationError(`${path}.evidence`, 'Closed-status transitions and Evidence section changes require durable evidence entries.');
  }
  if ((status === 'shipped' || status === 'superseded') && !validateClosedStatusEvidencePrefix(status, patch.evidence, { allowCurrentSource: true })) {
    throw validationError(`${path}.evidence`, `${status} status changes require durable evidence with a matching ${status} evidence prefix.`);
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

// --- eforge:endregion validation-helpers ---

// --- eforge:region patch-application-helpers ---
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

function shouldApplyRecheck(target: ProspectiveItem | ProspectiveEpic): boolean {
  const record = target.snapshot.record;
  if (record.last_checked === undefined || record.stale_after === undefined) return true;
  const staleAfter = dateKey(record.stale_after);
  return staleAfter === undefined || staleAfter < utcTodayKey();
}

// Freshness dates are UTC date keys throughout (the curation source's
// generatedAt and store timestamps come from toISOString()), so "today"
// must be the UTC date, not the local one.
function utcTodayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function applyRecheck(recheck: Recheck, target: ProspectiveItem | ProspectiveEpic): void {
  target.frontmatter.last_checked = recheck.last_checked;
  target.frontmatter.stale_after = recheck.stale_after;
  if (recheck.kind === 'item') normalizeBacklogItem(target.frontmatter, target.body);
  else normalizeBacklogEpic(target.frontmatter, target.body);
  target.changed = true;
}

function dateKey(value: string): string | undefined {
  const match = /^\d{4}-\d{2}-\d{2}/.exec(value);
  return match?.[0];
}

// --- eforge:endregion patch-application-helpers ---

// --- eforge:region validation-helpers ---
function validateProspectiveReferences(items: Map<string, ProspectiveItem>, epics: Map<string, ProspectiveEpic>, itemIds: Set<string>, epicIds: Set<string>): void {
  for (const [id, entry] of items) {
    if (!entry.changed) continue;
    const normalized = normalizeBacklogItem(entry.frontmatter, entry.body);
    const path = entry.patchPath ?? `backlogCurationDraft.itemChanges.${id}`;
    normalized.depends_on.forEach((dependencyId, index) => {
      if (!itemIds.has(dependencyId)) throw validationError(`${path}.metadata.depends_on[${index}]`, `Unknown dependency item id "${dependencyId}".`);
    });
    if (normalized.epic !== undefined && !epicIds.has(normalized.epic)) throw validationError(`${path}.metadata.epic`, `Unknown epic id "${normalized.epic}".`);
  }
  for (const [, entry] of epics) {
    if (entry.changed) normalizeBacklogEpic(entry.frontmatter, entry.body);
  }
}

function derivePostApplyOpenItemIds(items: Map<string, ProspectiveItem>): Set<string> {
  return new Set([...items].filter(([, entry]) => isOpenStatus(normalizeBacklogItem({ ...entry.frontmatter }, entry.body).status)).map(([id]) => id));
}

function derivePostApplyOpenEpicIds(epics: Map<string, ProspectiveEpic>): Set<string> {
  return new Set([...epics].filter(([, entry]) => isOpenStatus(normalizeBacklogEpic({ ...entry.frontmatter }, entry.body).status)).map(([id]) => id));
}

function prospectiveForRecheck(recheck: Recheck, index: number, items: Map<string, ProspectiveItem>, epics: Map<string, ProspectiveEpic>): ProspectiveItem | ProspectiveEpic {
  const path = `backlogCurationDraft.noOpRechecks[${index}]`;
  return recheck.kind === 'item' ? requireProspective(items, recheck.id, path) : requireProspective(epics, recheck.id, path);
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

function isEvidenceHeading(value: string): boolean {
  return value.trim().toLowerCase() === 'evidence';
}
// --- eforge:endregion validation-helpers ---

function validationError(path: string, message: string): ExtensionActionInputValidationError {
  return new ExtensionActionInputValidationError(message, [{ path, message }]);
}
