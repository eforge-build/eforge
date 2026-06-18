import { blockerRiskProjection, dependencyStateProjection, extractMarkdownSections, isOpenStatus } from './backlog-domain.js';
import { listBacklogEpicSnapshots, listBacklogItemSnapshots, type BacklogRecordSnapshot } from './markdown-store.js';
import { canonicalJson, sha256 } from './markdown-store-support.js';
import { buildRecommendationSourceProjection, projectRecommendationSourceForFingerprint, projectRoadmapContextForFingerprint } from './recommendation-status.js';
import { buildRoadmapContext } from './roadmap-context.js';
import { readRecommendations, summarizeRecommendations } from './recommendations-store.js';
// --- eforge:region shipped-evidence-context ---
import { collectShippedEvidence } from './shipped-evidence.js';
import { normalizeShippedEvidenceCaps } from './shipped-evidence-limits.js';
import { shouldOmitWeakCandidate } from './shipped-evidence-matching.js';
import type { ShippedEvidenceCandidate, ShippedEvidenceCaps, ShippedEvidenceDiagnostic, ShippedEvidenceResult } from './shipped-evidence-types.js';
import { listTraceSidecars } from './trace-store.js';
import { summarizeProjectTraces } from './trace-activity.js';
// --- eforge:endregion shipped-evidence-context ---
import type { BacklogEpic, BacklogItem, TraceSummary } from './backlog-domain.js';

export interface BacklogCurationSourceBuild {
  sourceFingerprint: string;
  sourceText: string;
  source: Record<string, unknown>;
}

const SOURCE_TEXT_TARGET = 180_000;
const SECTION_LIMIT = 4000;
const TRACE_LIMIT = 2000;
// --- eforge:region shipped-evidence-context ---
export const BACKLOG_CURATION_SHIPPED_EVIDENCE_CONTEXT_CAPS = {
  candidateCount: 12,
  citationCount: 1,
  changedPathCount: 6,
  excerptCount: 2,
  excerptBytes: 240,
  diagnosticCount: 8,
} as const;

interface BacklogCurationSourceBuildOptions {
  signal?: AbortSignal;
  shippedEvidenceCaps?: Partial<ShippedEvidenceCaps>;
  enrichPullRequests?: boolean;
}
// --- eforge:endregion shipped-evidence-context ---

export async function buildBacklogCurationSource(cwd: string, redraft?: Record<string, unknown>, options: BacklogCurationSourceBuildOptions = {}): Promise<BacklogCurationSourceBuild> {
  throwIfAborted(options.signal);
  const [itemSnapshots, epicSnapshots, recommendationProjection, recommendations] = await Promise.all([
    listBacklogItemSnapshots(cwd),
    listBacklogEpicSnapshots(cwd),
    buildRecommendationSourceProjection(cwd),
    readRecommendations(cwd),
  ]);
  const openItemSnapshots = itemSnapshots.filter((snapshot) => isOpenStatus(snapshot.record.status)).sort(bySnapshotId);
  const openEpicSnapshots = epicSnapshots.filter((snapshot) => isOpenStatus(snapshot.record.status)).sort(bySnapshotId);
  const itemIds = openItemSnapshots.map((snapshot) => snapshot.id);
  const recommendationHash = recommendations === null ? null : sha256(canonicalJson(recommendations));
  const truncation = { sectionStrings: 0, roadmapExcerpts: 0, traceDetails: 0, shippedEvidenceCandidates: 0, shippedEvidencePaths: 0, shippedEvidenceExcerpts: 0, shippedEvidenceDiagnostics: 0 };
  const [roadmapContext, rawTraceSummaries] = await Promise.all([
    buildRoadmapContext(cwd),
    readRawTraceSummaries(cwd, itemIds),
  ]);
  throwIfAborted(options.signal);
  const traceSummaries = boundTraceSummaries(rawTraceSummaries as unknown as Array<Record<string, unknown>>, truncation);
  const shippedEvidence = await buildShippedEvidenceContext(cwd, openItemSnapshots.map((snapshot) => snapshot.record), rawTraceSummaries, truncation, options);
  throwIfAborted(options.signal);
  const dependencyDetails = buildDependencyDetails(openItemSnapshots.map((snapshot) => snapshot.record), itemSnapshots.map((snapshot) => snapshot.record));
  const fingerprintProjection = {
    schemaVersion: 1,
    recommendationSourceProjection: projectRecommendationSourceForFingerprint(recommendationProjection),
    roadmapContext: projectRoadmapContextForFingerprint(roadmapContext),
    preconditions: {
      items: openItemSnapshots.map(projectPrecondition),
      epics: openEpicSnapshots.map(projectPrecondition),
    },
    dependencyDetails: dependencyDetails.map(projectDependencyFingerprintDetail),
    shippedEvidenceCandidates: shippedEvidence.fingerprintCandidates,
    recommendationModelHash: recommendationHash,
  };
  const sourceFingerprint = sha256(canonicalJson(fingerprintProjection));
  const openItems = openItemSnapshots.map((snapshot) => projectItem(snapshot, sourceFingerprint, truncation));
  const openEpics = openEpicSnapshots.map((snapshot) => projectEpic(snapshot, sourceFingerprint, truncation));
  const source = {
    schemaVersion: 1,
    purpose: 'backlog-curation',
    sourceFingerprint,
    generatedAt: new Date().toISOString(),
    openItems,
    openEpics,
    preconditions: { items: openItemSnapshots.map(projectPrecondition), epics: openEpicSnapshots.map(projectPrecondition) },
    dependencyDetails,
    blockers: blockerRiskProjection(openItemSnapshots.map((snapshot) => snapshot.record)),
    traceSummaries,
    shippedEvidenceCandidates: shippedEvidence.candidates,
    shippedEvidenceCandidateCounts: shippedEvidence.counts,
    shippedEvidenceDiagnostics: shippedEvidence.diagnostics,
    roadmapContext,
    recommendations: { exists: recommendations !== null, modelSummary: summarizeRecommendations(recommendations), modelHash: recommendationHash },
    truncation,
    ...(redraft !== undefined && { redraft }),
  };
  return { sourceFingerprint, sourceText: buildSourceText(source), source };
}

export function buildBacklogCurationRedraftContext(parentTaskId: string, result: Record<string, unknown> | undefined, input: { answers?: string[]; steering?: string }): Record<string, unknown> {
  return {
    parentTaskId,
    ...(typeof result?.summary === 'string' && { previousSummary: result.summary }),
    ...(result?.backlogCurationDraft !== undefined && { previousBacklogCurationDraft: result.backlogCurationDraft }),
    ...(Array.isArray(result?.assumptionsOpenQuestions) && { previousAssumptionsOpenQuestions: result.assumptionsOpenQuestions }),
    ...(Array.isArray(result?.clarificationQuestions) && { previousClarificationQuestions: result.clarificationQuestions }),
    ...(input.answers !== undefined && { userAnswers: input.answers }),
    ...(input.steering !== undefined && { steering: input.steering }),
  };
}

// --- eforge:region shipped-evidence-context ---
async function readRawTraceSummaries(cwd: string, itemIds: readonly string[]): Promise<TraceSummary[]> {
  const relevantItemIds = new Set(itemIds);
  const traces = await listTraceSidecars(cwd);
  return (await summarizeProjectTraces(cwd, traces)).filter((summary) => relevantItemIds.has(summary.itemId));
}

async function buildShippedEvidenceContext(
  cwd: string,
  items: readonly BacklogItem[],
  traceSummaries: readonly TraceSummary[],
  truncation: { shippedEvidenceCandidates: number; shippedEvidencePaths: number; shippedEvidenceExcerpts: number; shippedEvidenceDiagnostics: number },
  options: BacklogCurationSourceBuildOptions,
): Promise<{ candidates: Array<Record<string, unknown>>; fingerprintCandidates: Array<Record<string, unknown>>; counts: Record<string, unknown>; diagnostics: Array<Record<string, unknown>> }> {
  const result = await collectShippedEvidence({
    cwd,
    items,
    traceSummaries,
    caps: collectCaps(options.shippedEvidenceCaps),
    enrichPullRequests: options.enrichPullRequests,
    signal: options.signal,
  });
  const eligible = result.candidates.filter((candidate) => !shouldOmitWeakCandidate(candidate)).sort(byEvidenceRank);
  const selected = eligible.slice(0, BACKLOG_CURATION_SHIPPED_EVIDENCE_CONTEXT_CAPS.candidateCount);
  truncation.shippedEvidenceCandidates += Math.max(0, eligible.length - selected.length) + result.candidates.filter(shouldOmitWeakCandidate).length;
  const diagnostics = boundEvidenceDiagnostics(result.diagnostics, truncation);
  return {
    candidates: selected.map((candidate) => projectEvidenceCandidateForContext(candidate, truncation)),
    fingerprintCandidates: selected.map(projectEvidenceCandidateForFingerprint),
    counts: buildEvidenceCounts(result, selected),
    diagnostics,
  };
}

function collectCaps(overrides: Partial<ShippedEvidenceCaps> | undefined): Partial<ShippedEvidenceCaps> {
  return normalizeShippedEvidenceCaps({
    candidateCount: Math.max(BACKLOG_CURATION_SHIPPED_EVIDENCE_CONTEXT_CAPS.candidateCount * 3, 30),
    changedPathCount: BACKLOG_CURATION_SHIPPED_EVIDENCE_CONTEXT_CAPS.changedPathCount + 6,
    excerptCount: BACKLOG_CURATION_SHIPPED_EVIDENCE_CONTEXT_CAPS.excerptCount + 2,
    excerptBytes: BACKLOG_CURATION_SHIPPED_EVIDENCE_CONTEXT_CAPS.excerptBytes,
    diagnosticCount: BACKLOG_CURATION_SHIPPED_EVIDENCE_CONTEXT_CAPS.diagnosticCount + 12,
    ...overrides,
  });
}

function projectEvidenceCandidateForContext(candidate: ShippedEvidenceCandidate, truncation: { shippedEvidencePaths: number; shippedEvidenceExcerpts: number }): Record<string, unknown> {
  const changedPaths = candidate.changedPaths.slice(0, BACKLOG_CURATION_SHIPPED_EVIDENCE_CONTEXT_CAPS.changedPathCount);
  const excerpts = candidate.excerpts.slice(0, BACKLOG_CURATION_SHIPPED_EVIDENCE_CONTEXT_CAPS.excerptCount).map((excerpt) => ({
    evidenceSource: excerpt.evidenceSource,
    text: boundString(excerpt.text, BACKLOG_CURATION_SHIPPED_EVIDENCE_CONTEXT_CAPS.excerptBytes, () => { truncation.shippedEvidenceExcerpts += 1; }),
    ...(excerpt.path !== undefined && { path: excerpt.path }),
    ...(excerpt.commit !== undefined && { commit: excerpt.commit }),
  }));
  truncation.shippedEvidencePaths += Math.max(0, candidate.changedPaths.length - changedPaths.length);
  truncation.shippedEvidenceExcerpts += Math.max(0, candidate.excerpts.length - excerpts.length);
  return {
    itemId: candidate.itemId,
    itemTitle: candidate.itemTitle,
    evidenceSource: candidate.evidenceSource,
    confidence: candidate.confidence,
    evidenceLabel: evidenceLabel(candidate),
    reasons: candidate.reasons,
    citations: [candidate.citation].filter(Boolean).slice(0, BACKLOG_CURATION_SHIPPED_EVIDENCE_CONTEXT_CAPS.citationCount),
    ...(candidate.pr !== undefined && { pr: projectEvidencePr(candidate) }),
    ...(candidate.commit !== undefined && { commit: projectEvidenceCommit(candidate) }),
    changedPaths,
    branchHints: candidate.branchHints,
    excerpts,
  };
}

function projectEvidenceCandidateForFingerprint(candidate: ShippedEvidenceCandidate): Record<string, unknown> {
  return {
    itemId: candidate.itemId,
    itemTitle: candidate.itemTitle,
    evidenceSource: candidate.evidenceSource,
    confidence: candidate.confidence,
    ...(candidate.pr !== undefined && { pr: projectEvidencePr(candidate) }),
    ...(candidate.commit !== undefined && { commit: projectEvidenceCommit(candidate) }),
    changedPaths: candidate.changedPaths.slice(0, BACKLOG_CURATION_SHIPPED_EVIDENCE_CONTEXT_CAPS.changedPathCount),
    citations: [candidate.citation].filter(Boolean).slice(0, BACKLOG_CURATION_SHIPPED_EVIDENCE_CONTEXT_CAPS.citationCount),
  };
}

function projectEvidencePr(candidate: ShippedEvidenceCandidate): Record<string, unknown> | undefined {
  if (candidate.pr === undefined) return undefined;
  return {
    number: candidate.pr.number,
    ...(candidate.pr.title !== undefined && { title: candidate.pr.title }),
    ...(candidate.pr.headRefName !== undefined && { branch: candidate.pr.headRefName }),
  };
}

function projectEvidenceCommit(candidate: ShippedEvidenceCandidate): Record<string, unknown> | undefined {
  if (candidate.commit === undefined) return undefined;
  return { shortHash: candidate.commit.shortHash, subject: candidate.commit.subject };
}

function boundEvidenceDiagnostics(diagnostics: readonly ShippedEvidenceDiagnostic[], truncation: { shippedEvidenceDiagnostics: number }): Array<Record<string, unknown>> {
  const bounded = diagnostics.slice(0, BACKLOG_CURATION_SHIPPED_EVIDENCE_CONTEXT_CAPS.diagnosticCount).map((diagnostic) => ({
    code: diagnostic.code,
    message: boundString(diagnostic.message, 400, () => {}),
  }));
  truncation.shippedEvidenceDiagnostics += Math.max(0, diagnostics.length - bounded.length);
  return bounded;
}

function buildEvidenceCounts(result: ShippedEvidenceResult, selected: readonly ShippedEvidenceCandidate[]): Record<string, unknown> {
  return {
    collected: result.candidates.length,
    included: selected.length,
    strong: result.candidates.filter((candidate) => candidate.confidence === 'strong').length,
    ambiguous: result.candidates.filter((candidate) => candidate.confidence === 'ambiguous').length,
    weakOmitted: result.candidates.filter(shouldOmitWeakCandidate).length,
    lifecycle: result.candidates.filter((candidate) => candidate.evidenceSource === 'lifecycle').length,
    gitHistory: result.candidates.filter((candidate) => candidate.evidenceSource === 'git-history').length,
    prHistory: result.candidates.filter((candidate) => candidate.evidenceSource === 'pr-history').length,
    combined: result.candidates.filter((candidate) => candidate.evidenceSource === 'combined').length,
  };
}

function evidenceLabel(candidate: ShippedEvidenceCandidate): string {
  if (candidate.evidenceSource === 'lifecycle') return 'Shipped evidence: lifecycle trace';
  if (candidate.confidence === 'ambiguous') return 'Ambiguous shipped candidate: needs input';
  return 'Shipped evidence: inferred from git/PR history';
}

function byEvidenceRank(left: ShippedEvidenceCandidate, right: ShippedEvidenceCandidate): number {
  return evidenceRank(right) - evidenceRank(left) || right.score - left.score || left.itemId.localeCompare(right.itemId) || left.citation.localeCompare(right.citation);
}

function evidenceRank(candidate: ShippedEvidenceCandidate): number {
  const confidence = candidate.confidence === 'strong' ? 30 : candidate.confidence === 'ambiguous' ? 20 : 10;
  const source = candidate.evidenceSource === 'lifecycle' ? 100 : 0;
  return source + confidence;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error('Backlog curation source assembly was aborted.');
}
// --- eforge:endregion shipped-evidence-context ---

function projectItem(snapshot: BacklogRecordSnapshot<BacklogItem>, sourceFingerprint: string, truncation: { sectionStrings: number }) {
  const record = snapshot.record;
  return {
    id: record.id,
    title: record.title,
    status: record.status,
    priority: record.priority,
    tags: record.tags,
    depends_on: record.depends_on,
    epic: record.epic,
    updated: record.updated,
    last_checked: record.last_checked,
    stale_after: record.stale_after,
    evidence_notes: optionalString(record.evidence_notes),
    recheck_notes: optionalString(record.recheck_notes),
    precondition: { ...projectPrecondition(snapshot), sourceFingerprint },
    sections: boundSections(record.body, truncation),
  };
}

function projectEpic(snapshot: BacklogRecordSnapshot<BacklogEpic>, sourceFingerprint: string, truncation: { sectionStrings: number }) {
  const record = snapshot.record;
  return {
    id: record.id,
    title: record.title,
    status: record.status,
    priority: record.priority,
    tags: record.tags,
    updated: record.updated,
    last_checked: record.last_checked,
    stale_after: record.stale_after,
    evidence_notes: optionalString(record.evidence_notes),
    recheck_notes: optionalString(record.recheck_notes),
    precondition: { ...projectPrecondition(snapshot), sourceFingerprint },
    sections: boundSections(record.body, truncation),
  };
}

// --- eforge:region recommendation-validation ---
function buildDependencyDetails(openItems: readonly BacklogItem[], allItems: readonly BacklogItem[]): Array<Record<string, unknown>> {
  return dependencyStateProjection(openItems, allItems).map((projection) => ({
    itemId: projection.itemId,
    openDependsOn: projection.openDependsOn,
    closedDependsOn: projection.closedDependsOn,
    missingDependsOn: projection.missingDependsOn,
    cleanupCandidates: buildDependencyCleanupCandidates(projection),
  }));
}

function buildDependencyCleanupCandidates(projection: ReturnType<typeof dependencyStateProjection>[number]): Record<string, unknown> {
  const satisfiedDependencyIds = projection.closedDependsOn.map((entry) => entry.id);
  const missingDependencyIds = projection.missingDependsOn.map((entry) => entry.id);
  return {
    satisfiedDependencyIds,
    missingDependencyIds,
    conservativeGuidance: 'Closed dependencies are satisfied historical context and missing dependency ids may be stale metadata; only remove depends_on entries when an explicit curation patch has evidence that the edge is obsolete.',
  };
}

function projectDependencyFingerprintDetail(detail: Record<string, unknown>): Record<string, unknown> {
  return {
    itemId: detail.itemId,
    openDependsOn: detail.openDependsOn,
    closedDependsOn: detail.closedDependsOn,
    missingDependsOn: detail.missingDependsOn,
    cleanupCandidates: {
      satisfiedDependencyIds: (detail.cleanupCandidates as Record<string, unknown>).satisfiedDependencyIds,
      missingDependencyIds: (detail.cleanupCandidates as Record<string, unknown>).missingDependencyIds,
    },
  };
}
// --- eforge:endregion recommendation-validation ---

function projectPrecondition(snapshot: BacklogRecordSnapshot<BacklogItem | BacklogEpic>) {
  return {
    kind: snapshot.kind,
    id: snapshot.id,
    origin: snapshot.origin,
    relativePath: snapshot.relativePath,
    updated: snapshot.updated,
    bodySha256: snapshot.bodySha256,
    recordSha256: snapshot.recordSha256,
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function boundSections(body: string, truncation: { sectionStrings: number }): Record<string, string> {
  return Object.fromEntries([...extractMarkdownSections(body)].map(([heading, value]) => [heading, boundString(value, SECTION_LIMIT, () => { truncation.sectionStrings += 1; })]));
}

function boundTraceSummaries(values: Array<Record<string, unknown>>, truncation: { traceDetails: number }): Array<Record<string, unknown>> {
  return values.map((value) => {
    const text = JSON.stringify(value);
    if (text.length <= TRACE_LIMIT) return value;
    truncation.traceDetails += 1;
    return { itemId: value.itemId, truncated: true, excerpt: text.slice(0, TRACE_LIMIT) };
  });
}

function boundString(value: string, limit: number, onTruncate: () => void): string {
  if (value.length <= limit) return value;
  onTruncate();
  return `${value.slice(0, Math.max(0, limit - 16))}\n…[truncated]`;
}

function buildSourceText(source: Record<string, unknown>): string {
  let text = JSON.stringify(source, null, 2);
  if (text.length <= SOURCE_TEXT_TARGET) return text;
  const redraft = boundRedraftContext(source.redraft);
  const compact = { ...source, ...(redraft !== undefined && { redraft }), openItems: (source.openItems as Array<Record<string, unknown>>).map(stripSections), openEpics: (source.openEpics as Array<Record<string, unknown>>).map(stripSections), traceSummaries: [] };
  text = JSON.stringify(compact, null, 2);
  if (text.length <= SOURCE_TEXT_TARGET) return text;
  const minimal = {
    schemaVersion: source.schemaVersion,
    purpose: source.purpose,
    sourceFingerprint: source.sourceFingerprint,
    generatedAt: source.generatedAt,
    openItems: (source.openItems as Array<Record<string, unknown>>).map(minimalRecord),
    openEpics: (source.openEpics as Array<Record<string, unknown>>).map(minimalRecord),
    preconditions: source.preconditions,
    dependencyDetails: source.dependencyDetails,
    blockers: source.blockers,
    shippedEvidenceCandidates: source.shippedEvidenceCandidates,
    shippedEvidenceCandidateCounts: source.shippedEvidenceCandidateCounts,
    shippedEvidenceDiagnostics: source.shippedEvidenceDiagnostics,
    roadmapContext: source.roadmapContext,
    recommendations: stripRecommendationSummary(source.recommendations),
    ...(redraft !== undefined && { redraft }),
    truncation: { ...(source.truncation as Record<string, unknown>), fallback: 'minimal' },
  };
  return JSON.stringify(minimal, null, 2);
}

function boundRedraftContext(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object') return { value };
  const redraft = value as Record<string, unknown>;
  const previousDraft = redraft.previousBacklogCurationDraft && typeof redraft.previousBacklogCurationDraft === 'object'
    ? redraft.previousBacklogCurationDraft as Record<string, unknown>
    : undefined;
  return {
    ...(redraft.parentTaskId !== undefined && { parentTaskId: redraft.parentTaskId }),
    ...(redraft.steering !== undefined && { steering: boundString(String(redraft.steering), 4000, () => {}) }),
    ...(Array.isArray(redraft.userAnswers) && { userAnswers: redraft.userAnswers.map((answer) => boundString(String(answer), 2000, () => {})) }),
    ...(typeof redraft.previousSummary === 'string' && { previousSummary: boundString(redraft.previousSummary, 2000, () => {}) }),
    ...(Array.isArray(redraft.previousAssumptionsOpenQuestions) && { previousAssumptionsOpenQuestions: redraft.previousAssumptionsOpenQuestions.slice(0, 20) }),
    ...(Array.isArray(redraft.previousClarificationQuestions) && { previousClarificationQuestions: redraft.previousClarificationQuestions.slice(0, 20) }),
    ...(previousDraft !== undefined && { previousBacklogCurationDraft: summarizePreviousDraft(previousDraft) }),
  };
}

function summarizePreviousDraft(draft: Record<string, unknown>): Record<string, unknown> {
  return {
    schemaVersion: draft.schemaVersion,
    sourceFingerprint: draft.sourceFingerprint,
    generatedAt: draft.generatedAt,
    summary: Array.isArray(draft.summary) ? draft.summary.slice(0, 20) : undefined,
    itemChangeCount: Array.isArray(draft.itemChanges) ? draft.itemChanges.length : undefined,
    epicChangeCount: Array.isArray(draft.epicChanges) ? draft.epicChanges.length : undefined,
    noOpRecheckCount: Array.isArray(draft.noOpRechecks) ? draft.noOpRechecks.length : undefined,
    skippedCount: Array.isArray(draft.skipped) ? draft.skipped.length : undefined,
    needsInputCount: Array.isArray(draft.needsInput) ? draft.needsInput.length : undefined,
  };
}

function stripSections(record: Record<string, unknown>): Record<string, unknown> {
  const { sections: _sections, ...rest } = record;
  return rest;
}

function minimalRecord(record: Record<string, unknown>): Record<string, unknown> {
  return {
    id: record.id,
    status: record.status,
    last_checked: record.last_checked,
    stale_after: record.stale_after,
    precondition: record.precondition,
  };
}

function stripRecommendationSummary(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  const recommendations = value as Record<string, unknown>;
  return { exists: recommendations.exists, modelHash: recommendations.modelHash };
}

function bySnapshotId(left: { id: string }, right: { id: string }): number {
  return left.id.localeCompare(right.id);
}
