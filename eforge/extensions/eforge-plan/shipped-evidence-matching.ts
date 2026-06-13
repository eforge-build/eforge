import type { BacklogItem } from './backlog-domain.js';
import type { GitHistoryRecord, ShippedEvidenceCandidate, ShippedEvidenceConfidence, ShippedEvidencePrMetadata, ShippedEvidenceSource } from './shipped-evidence-types.js';

const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'from', 'into', 'that', 'this', 'when', 'then', 'than', 'have', 'has', 'had', 'are', 'was', 'were', 'been', 'will', 'would', 'should', 'could', 'feature', 'task', 'item', 'plan']);
const BROAD_WORDS = new Set(['api', 'ui', 'web', 'app', 'fix', 'bug', 'new', 'old', 'test', 'docs', 'plan', 'build', 'data']);

export interface MatchSignals {
  itemId: boolean;
  slug: boolean;
  nearTitle: boolean;
  branchName: boolean;
  prMetadata: boolean;
  pathOrExcerpt: boolean;
  changedPathsPresent: boolean;
  unrelatedChangedPaths: boolean;
  broadOnly: boolean;
  titleScore: number;
  reasons: string[];
}

export function normalizeSlug(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

export function tokenizeTitle(value: string): string[] {
  return uniqueStrings(normalizeSlug(value).split('-').filter((token) => token.length >= 3 && !STOP_WORDS.has(token)));
}

export function titleTokenScore(title: string, text: string): number {
  const titleTokens = tokenizeTitle(title);
  if (titleTokens.length === 0) return 0;
  const textTokens = new Set(tokenizeTitle(text));
  const hits = titleTokens.filter((token) => textTokens.has(token)).length;
  return hits / titleTokens.length;
}

export function containsSlug(text: string, slug: string): boolean {
  if (slug.length < 3) return false;
  const normalized = normalizeSlug(text);
  return normalized === slug || normalized.includes(`-${slug}-`) || normalized.startsWith(`${slug}-`) || normalized.endsWith(`-${slug}`);
}

export function exactItemIdMatch(text: string, itemId: string): boolean {
  if (itemId.length < 3) return false;
  const escaped = escapeRegExp(itemId);
  return new RegExp(`(^|[^A-Za-z0-9])${escaped}([^A-Za-z0-9]|$)`, 'i').test(text);
}

export function branchNameMatches(item: BacklogItem, branchHints: readonly string[]): boolean {
  const itemSlug = normalizeSlug(item.id);
  const titleSlug = normalizeSlug(item.title);
  return branchHints.some((hint) => {
    const branch = normalizeSlug(hint.split('/').pop() ?? hint);
    return containsSlug(branch, itemSlug) || (titleSlug.length >= 6 && containsSlug(branch, titleSlug)) || titleTokenScore(item.title, branch) >= 0.8;
  });
}

export function analyzeEvidenceMatch(input: {
  item: BacklogItem;
  record?: GitHistoryRecord;
  pr?: ShippedEvidencePrMetadata;
  lifecycleText?: string;
  excerptText?: string;
}): MatchSignals {
  const text = [input.record?.subject, input.record?.body, input.pr?.title, input.pr?.body, input.pr?.headRefName, input.lifecycleText, input.excerptText, ...(input.record?.changedPaths ?? []), ...(input.pr?.changedPaths ?? [])]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join('\n');
  const itemId = exactItemIdMatch(text, input.item.id);
  const itemSlug = normalizeSlug(input.item.id);
  const titleSlug = normalizeSlug(input.item.title);
  const slug = containsSlug(text, itemSlug) || (titleSlug.length >= 8 && containsSlug(text, titleSlug));
  const titleScore = titleTokenScore(input.item.title, text);
  const nearTitle = titleScore >= 0.72;
  const branchName = branchNameMatches(input.item, [...(input.record?.branchHints ?? []), input.pr?.headRefName ?? '']);
  const prText = [input.pr?.title, input.pr?.body, input.pr?.headRefName, ...(input.pr?.changedPaths ?? [])]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join('\n');
  const prItemId = exactItemIdMatch(prText, input.item.id);
  const prSlug = containsSlug(prText, itemSlug) || (titleSlug.length >= 8 && containsSlug(prText, titleSlug));
  const prNearTitle = titleTokenScore(input.item.title, prText) >= 0.72;
  const prBranchName = input.pr?.headRefName !== undefined && branchNameMatches(input.item, [input.pr.headRefName]);
  const prPath = hasPathOrExcerptSignal(input.item, input.pr?.changedPaths ?? [], '');
  const prMetadata = input.pr !== undefined && (prItemId || prSlug || prNearTitle || prBranchName || prPath);
  const changedPaths = [...(input.record?.changedPaths ?? []), ...(input.pr?.changedPaths ?? [])];
  const pathOrExcerpt = hasPathOrExcerptSignal(input.item, changedPaths, input.excerptText ?? '');
  const changedPathsPresent = changedPaths.length > 0;
  const unrelatedChangedPaths = changedPathsPresent && !pathOrExcerpt;
  const broadOnly = !itemId && !branchName && titleScore > 0 && tokenizeTitle(input.item.title).every((token) => BROAD_WORDS.has(token));
  const reasons = [
    ...(itemId ? [`exact item id ${input.item.id}`] : []),
    ...(slug ? ['item slug/title slug match'] : []),
    ...(nearTitle ? [`near-title token score ${titleScore.toFixed(2)}`] : []),
    ...(branchName ? ['branch-name hint match'] : []),
    ...(prMetadata ? ['PR metadata references item'] : []),
    ...(pathOrExcerpt ? ['changed paths or excerpts align'] : []),
    ...(unrelatedChangedPaths ? ['changed paths present but not aligned'] : []),
    ...(broadOnly ? ['broad wording only'] : []),
  ];
  return { itemId, slug, nearTitle, branchName, prMetadata, pathOrExcerpt, changedPathsPresent, unrelatedChangedPaths, broadOnly, titleScore, reasons };
}

export function classifyConfidence(input: {
  source: ShippedEvidenceSource;
  reachableLanding: boolean;
  staleOrUnreachablePr?: boolean;
  signals: MatchSignals;
}): ShippedEvidenceConfidence {
  if (input.staleOrUnreachablePr) return 'weak';
  const directIdOrSlug = input.signals.itemId || input.signals.slug;
  const direct = directIdOrSlug || input.signals.branchName || input.signals.prMetadata;
  if (input.signals.broadOnly && input.reachableLanding) return 'ambiguous';
  if (input.signals.broadOnly) return 'weak';
  if (input.reachableLanding && directIdOrSlug && input.signals.unrelatedChangedPaths && !input.signals.branchName && !input.signals.prMetadata && !input.signals.pathOrExcerpt) return 'weak';
  if (input.source === 'lifecycle' && input.reachableLanding && direct) return 'strong';
  if (input.reachableLanding && direct && (input.signals.pathOrExcerpt || input.signals.prMetadata || input.signals.branchName)) return 'strong';
  if (input.reachableLanding && (direct || input.signals.nearTitle)) return 'ambiguous';
  if (input.source === 'lifecycle' && direct) return 'ambiguous';
  return 'weak';
}

export function rankCandidates(candidates: readonly ShippedEvidenceCandidate[]): ShippedEvidenceCandidate[] {
  const confidenceRank: Record<ShippedEvidenceConfidence, number> = { strong: 3, ambiguous: 2, weak: 1 };
  return [...candidates].sort((left, right) => {
    const byConfidence = confidenceRank[right.confidence] - confidenceRank[left.confidence];
    if (byConfidence !== 0) return byConfidence;
    const byScore = right.score - left.score;
    if (byScore !== 0) return byScore;
    return left.itemId.localeCompare(right.itemId) || left.citation.localeCompare(right.citation);
  });
}

export function formatCitation(candidate: Pick<ShippedEvidenceCandidate, 'evidenceSource' | 'commit' | 'pr' | 'lifecycleRows'>): string {
  if (candidate.commit) {
    const pr = candidate.pr ? ` / PR #${candidate.pr.number}` : '';
    return `git ${candidate.commit.shortHash}${pr}: ${candidate.commit.subject}`;
  }
  if (candidate.pr) return `PR #${candidate.pr.number}: ${candidate.pr.title ?? candidate.pr.url ?? 'metadata'}`;
  const row = candidate.lifecycleRows[0];
  if (row) return `trace ${row.kind}/${row.status}: ${row.label}`;
  return candidate.evidenceSource;
}

export function signalScore(signals: MatchSignals): number {
  return (signals.itemId ? 35 : 0) + (signals.slug ? 25 : 0) + (signals.branchName ? 20 : 0) + (signals.prMetadata ? 20 : 0) + (signals.pathOrExcerpt ? 15 : 0) + Math.round(signals.titleScore * 20) - (signals.broadOnly ? 30 : 0);
}

export function shouldOmitWeakCandidate(candidate: ShippedEvidenceCandidate): boolean {
  return candidate.confidence === 'weak';
}

function hasPathOrExcerptSignal(item: BacklogItem, paths: readonly string[], excerptText: string): boolean {
  const tokens = tokenizeTitle(`${item.id} ${item.title}`).filter((token) => !BROAD_WORDS.has(token));
  if (tokens.length === 0) return false;
  const pathText = paths.map(normalizeSlug).join('-');
  const excerptScore = titleTokenScore(item.title, excerptText);
  return tokens.some((token) => pathText.includes(token)) || excerptScore >= 0.5 || exactItemIdMatch(excerptText, item.id);
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
