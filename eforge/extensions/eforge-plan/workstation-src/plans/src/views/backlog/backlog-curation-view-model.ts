import type { BacklogCurationDraft, RecommendationReferenceValidationIssue, RecommendationModel } from '@/types';

export interface CurationCounts {
  itemChanges: number;
  epicChanges: number;
  noOpRechecks: number;
  skipped: number;
  needsInput: number;
  generatedRecommendations: number;
}

export interface DisplayRow { label: string; value: string; }

const METADATA_LABELS: Record<string, string> = {
  status: 'Status',
  priority: 'Priority',
  tags: 'Tags',
  depends_on: 'Depends on',
  epic: 'Epic',
  last_checked: 'Last checked',
  stale_after: 'Stale after',
};

export function curationCounts(draft: BacklogCurationDraft, recommendations?: RecommendationModel): CurationCounts {
  return {
    itemChanges: draft.itemChanges.length,
    epicChanges: draft.epicChanges.length,
    noOpRechecks: draft.noOpRechecks.length,
    skipped: draft.skipped.length,
    needsInput: draft.needsInput.length,
    generatedRecommendations: recommendationSummaryCounts(recommendations).total,
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

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ');
  if (value === null) return 'none';
  if (value === undefined) return '';
  return String(value);
}
