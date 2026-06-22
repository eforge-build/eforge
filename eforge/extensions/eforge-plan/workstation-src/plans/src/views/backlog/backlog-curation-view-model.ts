import type { BacklogCurationDraft, BacklogCurationFullAuditEvidenceSummary, BacklogCurationFullAuditPreview, BacklogCurationRecommendationProjection, RecommendationModel, RecommendationReferenceValidationIssue } from '@/types';

export interface CurationCounts {
  itemChanges: number;
  epicChanges: number;
  noOpRechecks: number;
  skipped: number;
  needsInput: number;
  generatedRecommendations: number;
}

export interface DisplayRow { label: string; value: string; }

export interface FullAuditEvidenceMatch { source: string; confidence: string; path?: string; excerpt?: string; matchedBy: string[]; citations?: Array<{ path?: string; excerpt?: string; kind?: string }>; }

// --- eforge:region curation-preview-metadata ---
export interface CurationEvidencePreview {
  labels: string[];
  prIds: string[];
  commitIds: string[];
}

export interface ProjectionMetadataDisplay {
  removedItemIds: string[];
  removedEpicIds: string[];
  repositioned: string[];
}
// --- eforge:endregion curation-preview-metadata ---

const METADATA_LABELS: Record<string, string> = {
  status: 'Status',
  priority: 'Priority',
  tags: 'Tags',
  depends_on: 'Depends on',
  epic: 'Epic',
  last_checked: 'Last checked',
  stale_after: 'Stale after',
};

export function curationCounts(draft: BacklogCurationDraft, projection?: BacklogCurationRecommendationProjection): CurationCounts {
  return {
    itemChanges: draft.itemChanges.length,
    epicChanges: draft.epicChanges.length,
    noOpRechecks: draft.noOpRechecks.length,
    skipped: draft.skipped.length,
    needsInput: draft.needsInput.length,
    generatedRecommendations: recommendationSummaryCounts(projection?.effectiveRecommendations).total,
  };
}

export function idLabel(kind: string | undefined, id: string | undefined): string {
  const prefix = kind === 'epic' ? 'Epic' : kind === 'item' ? 'Item' : 'Record';
  return id ? `${prefix} ${id}` : prefix;
}

export function metadataRows(metadata: Record<string, unknown> | undefined): DisplayRow[] {
  if (!metadata) return [];
  return Object.entries(metadata).map(([key, value]) => ({ label: METADATA_LABELS[key] ?? key, value: formatValue(value) }));
}

export function sectionOperationLabel(action: string): string {
  if (action === 'append') return 'Append section content';
  if (action === 'replace') return 'Replace section content';
  return action;
}

export function abbreviateFingerprint(value: string | undefined): string {
  if (!value) return 'unknown';
  return value.length <= 16 ? value : `${value.slice(0, 8)}…${value.slice(-8)}`;
}

export function validationIssueLabel(issue: RecommendationReferenceValidationIssue): string {
  const target = issue.kind === 'epic' ? 'Epic' : 'Item';
  const status = issue.status ? ` · status ${issue.status}` : '';
  return `${issue.path}: ${target} ${issue.id} (${issue.reason}${status})`;
}

export function recommendationSummaryCounts(recommendations?: RecommendationModel): { activeWork: number; readyCandidates: number; nextSequence: number; safeParallelGroups: number; blockedChains: number; total: number } {
  const activeWork = recommendations?.activeWork?.length ?? 0;
  const readyCandidates = recommendations?.readyCandidates?.length ?? 0;
  const nextSequence = recommendations?.recommendedNextSequence.length ?? 0;
  const safeParallelGroups = recommendations?.safeParallelizableGroups.length ?? 0;
  const blockedChains = recommendations?.blockedChains?.length ?? 0;
  return { activeWork, readyCandidates, nextSequence, safeParallelGroups, blockedChains, total: activeWork + readyCandidates + nextSequence + safeParallelGroups + blockedChains };
}

export const BACKLOG_ANALYSIS_HELP = 'Checks open backlog items against current source, then prepares a reviewable curation draft and refreshed recommendations. Current source is the authority for shipped/superseded status; git, PR, lifecycle, and session history are navigation hints.';

export function formatFullAuditCoverage(audit: BacklogCurationFullAuditPreview | undefined): DisplayRow[] {
  const coverage = audit?.coverage;
  if (!coverage) return [];
  return [
    { label: 'Audited items', value: String(coverage.auditedItemCount) },
    numberRow('Current-state files', coverage.currentStateFileCount),
    numberRow('Git commits', coverage.gitHistoryCommitCount),
    numberRow('Pull requests', coverage.pullRequestCount),
  ].filter((row): row is DisplayRow => Boolean(row));
}

export function formatFullAuditCaps(audit: BacklogCurationFullAuditPreview | undefined): DisplayRow[] {
  const caps = audit?.caps;
  if (!caps) return [];
  return [
    numberRow('File scan cap', caps.fileScanCount),
    bytesRow('File byte cap', caps.fileBytes),
    numberRow('Evidence per item cap', caps.evidencePerItem),
    numberRow('Paths per category cap', caps.pathsPerCategory),
    bytesRow('Excerpt byte cap', caps.excerptBytes),
    numberRow('Diagnostic cap', caps.diagnosticCount),
    numberRow('Git commit scan cap', caps.gitCommitScanCount),
    numberRow('PR enrichment cap', caps.prEnrichmentCount),
  ].filter((row): row is DisplayRow => Boolean(row));
}

export function formatFullAuditSettings(audit: BacklogCurationFullAuditPreview | undefined): DisplayRow[] {
  const settings = audit?.settings;
  if (!settings) return [];
  return [
    numberRow('Item audit concurrency', settings.itemAuditConcurrency),
    numberRow('Maximum item audit concurrency', settings.maxItemAuditConcurrency),
    settings.closureAuthority ? { label: 'Closure authority', value: settings.closureAuthority === 'current-source-only' ? 'current source only' : settings.closureAuthority } : undefined,
  ].filter((row): row is DisplayRow => Boolean(row));
}

export function matchFullAuditEvidenceForPatch(audit: BacklogCurationFullAuditPreview | undefined, patch: { kind?: string; id?: string; evidence?: string[]; metadata?: { status?: string } }): FullAuditEvidenceMatch[] {
  if (patch.kind !== 'item' || !patch.id) return [];
  const summary = audit?.itemSummaries?.find((item) => item.itemId === patch.id);
  const targetClosedStatus = patch.metadata?.status === 'shipped' || patch.metadata?.status === 'superseded' ? patch.metadata.status : undefined;
  const candidateEvidence = targetClosedStatus === undefined ? summary?.evidence ?? [] : (summary?.closureCandidates ?? []).filter((entry) => isStrongCurrentSourceClosureCandidateForStatus(entry, targetClosedStatus));
  if (candidateEvidence.length === 0) return [];
  const draftEvidence = (patch.evidence ?? []).join('\n').toLowerCase();
  return candidateEvidence.filter(hasDisplayableSourceConfidence).filter((entry) => evidenceMatchesDraft(entry, draftEvidence)).map((entry) => ({
    source: entry.source.trim(),
    confidence: entry.confidence.trim(),
    path: entry.path ?? entry.citations?.find((citation) => citation.path)?.path,
    excerpt: entry.excerpt ?? entry.citations?.find((citation) => citation.excerpt)?.excerpt,
    matchedBy: entry.matchedBy ?? [],
    citations: entry.citations,
  }));
}

function isStrongCurrentSourceClosureCandidateForStatus(entry: BacklogCurationFullAuditEvidenceSummary, status: 'shipped' | 'superseded'): boolean {
  return entry.intent === status && entry.confidence.trim().toLowerCase() === 'strong' && (entry.evidenceSource === 'current-source' || entry.source === 'current-source');
}

export function evidenceSourceLabel(source: string): string {
  return source.split('-').filter(Boolean).map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(' ');
}

function hasDisplayableSourceConfidence(entry: BacklogCurationFullAuditEvidenceSummary): boolean {
  return entry.source.trim().length > 0 && entry.confidence.trim().length > 0;
}

function evidenceMatchesDraft(entry: BacklogCurationFullAuditEvidenceSummary, draftEvidence: string): boolean {
  if (draftEvidence.length === 0) return true;
  const excerpt = entry.excerpt?.toLowerCase();
  if (excerpt && draftEvidence.includes(excerpt.slice(0, Math.min(excerpt.length, 80)))) return true;
  if (entry.path && draftEvidence.includes(entry.path.toLowerCase())) return true;
  if (entry.evidence && draftEvidence.includes(entry.evidence.toLowerCase().slice(0, Math.min(entry.evidence.length, 80)))) return true;
  if (entry.citation && draftEvidence.includes(entry.citation.toLowerCase())) return true;
  for (const citation of entry.citations ?? []) {
    if (citation.path && draftEvidence.includes(citation.path.toLowerCase())) return true;
    if (citation.excerpt && draftEvidence.includes(citation.excerpt.toLowerCase().slice(0, Math.min(citation.excerpt.length, 80)))) return true;
  }
  return draftEvidence.includes(entry.source.toLowerCase());
}

function numberRow(label: string, value: number | undefined): DisplayRow | undefined {
  return value === undefined ? undefined : { label, value: value.toLocaleString() };
}

function bytesRow(label: string, value: number | undefined): DisplayRow | undefined {
  if (value === undefined) return undefined;
  if (value < 1024) return { label, value: `${value} B` };
  if (value < 1024 * 1024) return { label, value: `${(value / 1024).toFixed(1)} KiB` };
  return { label, value: `${(value / (1024 * 1024)).toFixed(1)} MiB` };
}

// --- eforge:region curation-preview-metadata ---
const CURRENT_SOURCE_LABEL = 'Shipped evidence: current source';
const SUPERSEDED_CURRENT_SOURCE_LABEL = 'Superseded evidence: current source';
const LIFECYCLE_LABEL = 'Shipped evidence: lifecycle trace';
const INFERRED_LABEL = 'Shipped evidence: inferred from git/PR history';
const SUPERSEDED_LIFECYCLE_LABEL = 'Superseded evidence: lifecycle trace';
const SUPERSEDED_INFERRED_LABEL = 'Superseded evidence: inferred from git/PR history';
const AMBIGUOUS_LABEL = 'Ambiguous shipped candidate: needs input';
const AMBIGUOUS_SUPERSEDED_LABEL = 'Ambiguous superseded candidate: needs input';
const PR_PATTERNS = [/\bPR\s+#(\d{1,10})\b/gi, /(?:^|[^\w/])#(\d{1,10})\b/g, /\/pull\/(\d{1,10})\b/gi];
const COMMIT_PATTERN = /\b(?:merge\s+commit|commit|git)\s+([a-f0-9]{7,40})\b/gi;

export function curationEvidencePreview(values: Array<string | undefined>): CurationEvidencePreview {
  const labelSet = new Set<string>();
  const prIds = new Set<string>();
  const commitIds = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    if (value.includes(CURRENT_SOURCE_LABEL)) labelSet.add(CURRENT_SOURCE_LABEL);
    if (value.includes(SUPERSEDED_CURRENT_SOURCE_LABEL)) labelSet.add(SUPERSEDED_CURRENT_SOURCE_LABEL);
    if (value.includes(LIFECYCLE_LABEL)) labelSet.add(LIFECYCLE_LABEL);
    if (value.includes(INFERRED_LABEL)) labelSet.add(INFERRED_LABEL);
    if (value.includes(SUPERSEDED_LIFECYCLE_LABEL)) labelSet.add(SUPERSEDED_LIFECYCLE_LABEL);
    if (value.includes(SUPERSEDED_INFERRED_LABEL)) labelSet.add(SUPERSEDED_INFERRED_LABEL);
    if (value.includes(AMBIGUOUS_LABEL)) labelSet.add(AMBIGUOUS_LABEL);
    if (value.includes(AMBIGUOUS_SUPERSEDED_LABEL)) labelSet.add(AMBIGUOUS_SUPERSEDED_LABEL);
    for (const pattern of PR_PATTERNS) {
      pattern.lastIndex = 0;
      for (const match of value.matchAll(pattern)) if (match[1]) prIds.add(`#${match[1]}`);
    }
    COMMIT_PATTERN.lastIndex = 0;
    for (const match of value.matchAll(COMMIT_PATTERN)) if (match[1]) commitIds.add(match[1]);
  }
  const labels = [CURRENT_SOURCE_LABEL, SUPERSEDED_CURRENT_SOURCE_LABEL, LIFECYCLE_LABEL, INFERRED_LABEL, SUPERSEDED_LIFECYCLE_LABEL, SUPERSEDED_INFERRED_LABEL, AMBIGUOUS_LABEL, AMBIGUOUS_SUPERSEDED_LABEL].filter((label) => labelSet.has(label));
  return { labels, prIds: [...prIds], commitIds: [...commitIds] };
}

export function effectiveRecommendationsFromProjection(projection?: BacklogCurationRecommendationProjection): RecommendationModel | undefined {
  return projection?.effectiveRecommendations;
}

export function projectionMetadataDisplay(projection?: BacklogCurationRecommendationProjection): ProjectionMetadataDisplay {
  return {
    removedItemIds: [...(projection?.removed.itemIds ?? [])].sort(),
    removedEpicIds: [...(projection?.removed.epicIds ?? [])].sort(),
    repositioned: [...(projection?.repositioned ?? [])]
      .sort((left, right) => left.itemId.localeCompare(right.itemId) || left.from.localeCompare(right.from) || left.to.localeCompare(right.to))
      .map((entry) => `${entry.itemId}: ${entry.from} → ${entry.to}`),
  };
}
// --- eforge:endregion curation-preview-metadata ---

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ');
  if (value === null) return 'none';
  if (value === undefined) return '';
  return String(value);
}
