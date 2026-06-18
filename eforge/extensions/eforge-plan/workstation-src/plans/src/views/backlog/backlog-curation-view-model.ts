import type { BacklogCurationDraft, BacklogCurationRecommendationProjection, RecommendationModel, RecommendationReferenceValidationIssue } from '@/types';

export interface CurationCounts {
  itemChanges: number;
  epicChanges: number;
  noOpRechecks: number;
  skipped: number;
  needsInput: number;
  generatedRecommendations: number;
}

export interface DisplayRow { label: string; value: string; }

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

// --- eforge:region curation-preview-metadata ---
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
  const labels = [LIFECYCLE_LABEL, INFERRED_LABEL, SUPERSEDED_LIFECYCLE_LABEL, SUPERSEDED_INFERRED_LABEL, AMBIGUOUS_LABEL, AMBIGUOUS_SUPERSEDED_LABEL].filter((label) => labelSet.has(label));
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
