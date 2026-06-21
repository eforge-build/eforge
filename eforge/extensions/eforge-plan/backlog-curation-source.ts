import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { safeParseWithSchema } from '@eforge-build/client';
import { createEforgeProjectPaths } from '@eforge-build/extension-sdk';
import { blockerRiskProjection, dependencyStateProjection, extractMarkdownSections, isOpenStatus } from './backlog-domain.js';
import { listBacklogEpicSnapshots, listBacklogItemSnapshots, type BacklogRecordSnapshot } from './markdown-store.js';
import { canonicalJson, sha256 } from './markdown-store-support.js';
import { buildRecommendationSourceProjection, projectRecommendationSourceForFingerprint, projectRoadmapContextForFingerprint } from './recommendation-status.js';
import { buildRoadmapContext } from './roadmap-context.js';
import { readRecommendations, summarizeRecommendations } from './recommendations-store.js';
import { collectBacklogCurationGitDeltaWithHistory, projectGitDeltaForFingerprint, type BacklogCurationGitDeltaCaps } from './backlog-curation-git-delta.js';
import { classifyBacklogCurationEvidence, type EvidenceClassificationResult } from './backlog-curation-evidence-classification.js';
import { collectBacklogCurationFullImplementationAudit, projectFullImplementationAuditForFingerprint, type FullImplementationAuditResult } from './backlog-curation-full-audit.js';
// --- eforge:region shipped-evidence-context ---
import { collectShippedEvidence } from './shipped-evidence.js';
import { normalizeShippedEvidenceCaps } from './shipped-evidence-limits.js';
import { shouldOmitWeakCandidate } from './shipped-evidence-matching.js';
import type { ShippedEvidenceCandidate, ShippedEvidenceCaps, ShippedEvidenceDiagnostic, ShippedEvidenceResult } from './shipped-evidence-types.js';
import { listTraceSidecars } from './trace-store.js';
import { summarizeProjectTraces } from './trace-activity.js';
// --- eforge:endregion shipped-evidence-context ---
import type { BacklogEpic, BacklogItem, TraceSummary } from './backlog-domain.js';
import { BacklogCurationFullImplementationAuditPreviewSchema, BacklogCurationGitDeltaPreviewSchema, BacklogCurationScanModeSchema, normalizeBacklogCurationScanMode, type BacklogCurationFullImplementationAuditPreview, type BacklogCurationGitDeltaPreview, type BacklogCurationScanMode } from './backlog-curation-schemas.js';
import { normalizeItemAuditConcurrency } from './backlog-curation-source-first-audit.js';

export interface BacklogCurationSourceBuild {
  sourceFingerprint: string;
  sourceText: string;
  source: Record<string, unknown>;
  fullImplementationAuditPreview?: BacklogCurationFullImplementationAuditPreview;
}

export interface BacklogCurationSourcePreviewMetadata {
  sourceFingerprint: string;
  generatedAt?: string;
  scanMode?: BacklogCurationScanMode;
  itemAuditConcurrency?: number;
  gitDelta?: BacklogCurationGitDeltaPreview;
  fullImplementationAudit?: BacklogCurationFullImplementationAuditPreview;
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
  scanMode?: BacklogCurationScanMode;
  itemAuditConcurrency?: number;
  shippedEvidenceCaps?: Partial<ShippedEvidenceCaps>;
  enrichPullRequests?: boolean;
  gitDeltaCaps?: Partial<BacklogCurationGitDeltaCaps>;
  fullImplementationAuditCaps?: Record<string, number>;
}
// --- eforge:endregion shipped-evidence-context ---

export async function writeBacklogCurationSourcePreviewMetadata(cwd: string, source: BacklogCurationSourceBuild): Promise<void> {
  const metadata = previewMetadataFromSource(source);
  const path = resolveBacklogCurationSourcePreviewMetadataPath(cwd, metadata.sourceFingerprint);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(metadata, null, 2)}\n`, 'utf-8');
}

export async function readBacklogCurationSourcePreviewMetadata(cwd: string, sourceFingerprint: string): Promise<BacklogCurationSourcePreviewMetadata | null> {
  let raw: string;
  try {
    raw = await readFile(resolveBacklogCurationSourcePreviewMetadataPath(cwd, sourceFingerprint), 'utf-8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  const gitDelta = parsed.gitDelta === undefined ? undefined : safeParseWithSchema(BacklogCurationGitDeltaPreviewSchema, parsed.gitDelta);
  const scanMode = parsed.scanMode === undefined ? undefined : safeParseWithSchema(BacklogCurationScanModeSchema, parsed.scanMode);
  const fullImplementationAudit = parsed.fullImplementationAudit === undefined ? undefined : safeParseWithSchema(BacklogCurationFullImplementationAuditPreviewSchema, parsed.fullImplementationAudit);
  return {
    sourceFingerprint,
    ...(typeof parsed.generatedAt === 'string' && { generatedAt: parsed.generatedAt }),
    ...(scanMode?.success && { scanMode: scanMode.data }),
    ...(parsed.itemAuditConcurrency !== undefined && { itemAuditConcurrency: normalizeItemAuditConcurrency(parsed.itemAuditConcurrency) }),
    ...(gitDelta?.success && { gitDelta: gitDelta.data }),
    ...(fullImplementationAudit?.success && { fullImplementationAudit: fullImplementationAudit.data }),
  };
}

export async function buildBacklogCurationSource(cwd: string, redraft?: Record<string, unknown>, options: BacklogCurationSourceBuildOptions = {}): Promise<BacklogCurationSourceBuild> {
  throwIfAborted(options.signal);
  const scanMode = normalizeBacklogCurationScanMode(options.scanMode);
  const itemAuditConcurrency = scanMode === 'full-implementation-audit' ? normalizeItemAuditConcurrency(options.itemAuditConcurrency) : undefined;
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
  const gitDelta = await collectBacklogCurationGitDeltaWithHistory({ cwd, caps: collectGitDeltaCaps(options), enrichPullRequests: options.enrichPullRequests, signal: options.signal });
  const classification = await classifyBacklogCurationEvidence({ cwd, items: openItemSnapshots.map((snapshot) => snapshot.record), traceSummaries: rawTraceSummaries, gitHistory: gitDelta.gitHistory, pullRequests: gitDelta.pullRequestEnrichment?.pullRequests, caps: collectCaps(options.shippedEvidenceCaps), diagnostics: gitDelta.gitHistory.diagnostics, signal: options.signal });
  gitDelta.gitDelta.affectedItemCandidates = classification.affectedItemCandidates;
  const fullImplementationAudit = scanMode === 'full-implementation-audit'
    ? await collectBacklogCurationFullImplementationAudit({ cwd, items: openItemSnapshots.map((snapshot) => snapshot.record), traceSummaries: rawTraceSummaries, caps: { ...options.shippedEvidenceCaps, ...options.fullImplementationAuditCaps }, itemAuditConcurrency, enrichPullRequests: options.enrichPullRequests, signal: options.signal })
    : undefined;
  const shippedEvidence = await buildShippedEvidenceContext(cwd, openItemSnapshots.map((snapshot) => snapshot.record), rawTraceSummaries, truncation, options, classification, fullImplementationAudit?.shippedEvidenceCandidates, scanMode !== 'full-implementation-audit');
  throwIfAborted(options.signal);
  const dependencyDetails = buildDependencyDetails(openItemSnapshots.map((snapshot) => snapshot.record), itemSnapshots.map((snapshot) => snapshot.record));
  const fingerprintProjection = {
    schemaVersion: 1,
    scanMode,
    ...(itemAuditConcurrency !== undefined && { itemAuditConcurrency }),
    recommendationSourceProjection: projectRecommendationSourceForFingerprint(recommendationProjection),
    roadmapContext: projectRoadmapContextForFingerprint(roadmapContext),
    preconditions: {
      items: openItemSnapshots.map(projectPrecondition),
      epics: openEpicSnapshots.map(projectPrecondition),
    },
    dependencyDetails: dependencyDetails.map(projectDependencyFingerprintDetail),
    shippedEvidenceCandidates: shippedEvidence.fingerprintCandidates,
    gitDelta: projectGitDeltaForFingerprint(gitDelta.gitDelta),
    ...(fullImplementationAudit !== undefined && { fullImplementationAudit: projectFullImplementationAuditForFingerprint(fullImplementationAudit.context) }),
    recommendationModelHash: recommendationHash,
  };
  const sourceFingerprint = sha256(canonicalJson(fingerprintProjection));
  const openItems = openItemSnapshots.map((snapshot) => projectItem(snapshot, sourceFingerprint, truncation));
  const openEpics = openEpicSnapshots.map((snapshot) => projectEpic(snapshot, sourceFingerprint, truncation));
  const source = {
    schemaVersion: 1,
    purpose: 'backlog-curation',
    scanMode,
    ...(itemAuditConcurrency !== undefined && { itemAuditConcurrency }),
    scanModeGuidance: buildScanModeGuidance(scanMode),
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
    gitDelta: gitDelta.gitDelta,
    ...(fullImplementationAudit !== undefined && { fullImplementationAudit: fullImplementationAudit.context }),
    roadmapContext,
    recommendations: { exists: recommendations !== null, modelSummary: summarizeRecommendations(recommendations), modelHash: recommendationHash },
    truncation,
    ...(redraft !== undefined && { redraft }),
  };
  return { sourceFingerprint, sourceText: buildSourceText(source), source, ...(fullImplementationAudit !== undefined && { fullImplementationAuditPreview: fullImplementationAudit.preview as BacklogCurationFullImplementationAuditPreview }) };
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
  classification?: EvidenceClassificationResult,
  fullAuditCandidates: readonly ShippedEvidenceCandidate[] = [],
  includeHistoricalClosure = true,
): Promise<{ candidates: Array<Record<string, unknown>>; fingerprintCandidates: Array<Record<string, unknown>>; counts: Record<string, unknown>; diagnostics: Array<Record<string, unknown>> }> {
  if (!includeHistoricalClosure) return { candidates: [], fingerprintCandidates: [], counts: { collected: 0, included: 0, sourceFirst: true }, diagnostics: [] };
  const lifecycleResult = await collectShippedEvidence({
    cwd,
    items,
    traceSummaries,
    caps: collectCaps(options.shippedEvidenceCaps),
    enrichPullRequests: false,
    gitHistory: { records: [], diagnostics: [] },
    signal: options.signal,
  });
  const result: ShippedEvidenceResult = { ...lifecycleResult, candidates: dedupeEvidenceCandidates([...(classification?.shippedEvidenceCandidates ?? []), ...fullAuditCandidates, ...lifecycleResult.candidates]) };
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

function collectGitDeltaCaps(options: BacklogCurationSourceBuildOptions): Partial<BacklogCurationGitDeltaCaps> {
  const shippedCaps = collectCaps(options.shippedEvidenceCaps) as ShippedEvidenceCaps;
  return {
    commitScanCount: shippedCaps.gitCommitScanCount,
    changedPathCount: shippedCaps.changedPathCount,
    excerptCount: shippedCaps.excerptCount,
    excerptBytes: shippedCaps.excerptBytes,
    prEnrichmentCount: shippedCaps.prEnrichmentCount,
    subprocessTimeoutMs: shippedCaps.subprocessTimeoutMs,
    ...options.gitDeltaCaps,
  };
}

function dedupeEvidenceCandidates(candidates: readonly ShippedEvidenceCandidate[]): ShippedEvidenceCandidate[] {
  const byKey = new Map<string, ShippedEvidenceCandidate>();
  for (const candidate of candidates) if (!byKey.has(evidenceCandidateKey(candidate))) byKey.set(evidenceCandidateKey(candidate), candidate);
  return [...byKey.values()];
}

function evidenceCandidateKey(candidate: ShippedEvidenceCandidate): string {
  return `${candidate.itemId}:${candidate.intent ?? 'shipped'}:${candidate.commit?.hash ?? ''}:${candidate.pr?.number ?? ''}:${candidate.citation}`;
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
    intent: candidate.intent ?? 'shipped',
    matchedBy: candidate.matchedBy ?? [],
    evidence: candidate.evidence ?? evidenceLabel(candidate),
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
    intent: candidate.intent ?? 'shipped',
    matchedBy: candidate.matchedBy ?? [],
    evidence: candidate.evidence,
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
    affected: result.candidates.filter((candidate) => candidate.intent === 'affected').length,
    superseded: result.candidates.filter((candidate) => candidate.intent === 'superseded').length,
    ambiguousClosure: result.candidates.filter((candidate) => candidate.intent === 'ambiguous-shipped' || candidate.intent === 'ambiguous-superseded').length,
    lifecycle: result.candidates.filter((candidate) => candidate.evidenceSource === 'lifecycle').length,
    gitHistory: result.candidates.filter((candidate) => candidate.evidenceSource === 'git-history').length,
    prHistory: result.candidates.filter((candidate) => candidate.evidenceSource === 'pr-history').length,
    combined: result.candidates.filter((candidate) => candidate.evidenceSource === 'combined').length,
  };
}

function evidenceLabel(candidate: ShippedEvidenceCandidate): string {
  if (candidate.evidence !== undefined) return candidate.evidence.split(' — ')[0] ?? candidate.evidence;
  if (candidate.intent === 'superseded') return 'Superseded evidence: lifecycle trace';
  if (candidate.intent === 'ambiguous-superseded') return 'Ambiguous superseded candidate: needs input';
  if (candidate.intent === 'ambiguous-shipped' || candidate.confidence === 'ambiguous') return 'Ambiguous shipped candidate: needs input';
  if (candidate.evidenceSource === 'lifecycle') return 'Shipped evidence: lifecycle trace';
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

function resolveBacklogCurationSourcePreviewMetadataPath(cwd: string, sourceFingerprint: string): string {
  return createEforgeProjectPaths({ cwd, extensionName: 'eforge-plan' }).extensionStoragePath('project-local', ['backlog-curation-sources', `${sourceFingerprint}.json`]);
}

function previewMetadataFromSource(source: BacklogCurationSourceBuild): BacklogCurationSourcePreviewMetadata {
  const gitDelta = safeParseWithSchema(BacklogCurationGitDeltaPreviewSchema, source.source.gitDelta);
  const scanMode = normalizeBacklogCurationScanMode(source.source.scanMode);
  const fullImplementationAudit = source.fullImplementationAuditPreview === undefined ? undefined : safeParseWithSchema(BacklogCurationFullImplementationAuditPreviewSchema, source.fullImplementationAuditPreview);
  return {
    sourceFingerprint: source.sourceFingerprint,
    ...(typeof source.source.generatedAt === 'string' && { generatedAt: source.source.generatedAt }),
    scanMode,
    ...(source.source.itemAuditConcurrency !== undefined && { itemAuditConcurrency: normalizeItemAuditConcurrency(source.source.itemAuditConcurrency) }),
    ...(gitDelta.success && { gitDelta: gitDelta.data }),
    ...(fullImplementationAudit?.success && { fullImplementationAudit: fullImplementationAudit.data }),
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

function buildScanModeGuidance(scanMode: BacklogCurationScanMode): Record<string, unknown> {
  if (scanMode === 'full-implementation-audit') {
    return {
      mode: scanMode,
      instruction: 'Audit every open backlog item against bounded source-first current-source evidence. Current source is the only closure authority; historical git/PR/lifecycle/session signals are navigation hints only. Route unsupported or ambiguous closure claims to skipped, no-change, or recheck-note guidance instead of top-level questions.',
    };
  }
  return {
    mode: scanMode,
    instruction: 'Use the accepted-analysis git delta, backlog records, recommendations, roadmap context, traces, and bounded shipped evidence to curate changed or stale backlog records conservatively.',
  };
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
    scanMode: source.scanMode,
    scanModeGuidance: source.scanModeGuidance,
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
    gitDelta: source.gitDelta,
    ...(source.fullImplementationAudit !== undefined && { fullImplementationAudit: source.fullImplementationAudit }),
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
