import type { BacklogItem, TraceSummary } from './backlog-domain.js';
import { collectGitFileExcerpts } from './shipped-evidence-git.js';
import { boundChangedPaths, boundString, normalizeShippedEvidenceCaps } from './shipped-evidence-limits.js';
import { analyzeEvidenceMatch, candidateMostRecentTime, classifyEvidenceIntent, detectClosureIntent, formatCitation, rankCandidates, signalScore } from './shipped-evidence-matching.js';
import type { GitDeltaAffectedItemCandidate, GitHistoryCollection, GitHistoryRecord, ShippedEvidenceCandidate, ShippedEvidenceCaps, ShippedEvidenceDiagnostic, ShippedEvidencePrMetadata } from './shipped-evidence-types.js';
import { AMBIGUOUS_SHIPPED_EVIDENCE_PREFIX, AMBIGUOUS_SUPERSEDED_EVIDENCE_PREFIX, SHIPPED_GIT_PR_EVIDENCE_PREFIX, SHIPPED_LIFECYCLE_EVIDENCE_PREFIX, SUPERSEDED_GIT_PR_EVIDENCE_PREFIX, SUPERSEDED_LIFECYCLE_EVIDENCE_PREFIX } from './backlog-curation-evidence-prefixes.js';

export interface EvidenceClassificationInput {
  cwd: string;
  items: readonly BacklogItem[];
  traceSummaries?: readonly TraceSummary[];
  gitHistory: GitHistoryCollection;
  pullRequests?: readonly ShippedEvidencePrMetadata[];
  caps?: Partial<ShippedEvidenceCaps>;
  diagnostics?: ShippedEvidenceDiagnostic[];
  signal?: AbortSignal;
}

export interface EvidenceClassificationResult {
  affectedItemCandidates: GitDeltaAffectedItemCandidate[];
  shippedEvidenceCandidates: ShippedEvidenceCandidate[];
}

export async function classifyBacklogCurationEvidence(input: EvidenceClassificationInput): Promise<EvidenceClassificationResult> {
  const caps = normalizeShippedEvidenceCaps(input.caps);
  const diagnostics = input.diagnostics ?? [];
  const prByNumber = new Map((input.pullRequests ?? []).map((pr) => [pr.number, pr]));
  const candidates: ShippedEvidenceCandidate[] = [];
  for (const record of input.gitHistory.records) {
    throwIfAborted(input.signal);
    const pr = record.prNumbers.map((number) => prByNumber.get(number)).find((value): value is ShippedEvidencePrMetadata => value !== undefined);
    const preliminary = input.items.map((item) => ({ item, signals: analyzeEvidenceMatch({ item, record, pr }) }))
      .filter(({ signals }) => signals.itemId || signals.slug || signals.branchName || signals.prMetadata || signals.pathOrExcerpt || signals.titleScore >= 0.35);
    if (preliminary.length === 0) continue;
    for (const { item } of preliminary) {
      throwIfAborted(input.signal);
      const excerpts = await collectGitFileExcerpts({ cwd: input.cwd, record, queryText: `${item.id} ${item.title}`, caps, diagnostics, signal: input.signal });
      const excerptText = excerpts.map((excerpt) => excerpt.text).join('\n');
      const signals = analyzeEvidenceMatch({ item, record, pr, excerptText });
      const closureIntent = reachablePullRequestMerge(record, pr) ? 'shipped' : detectClosureIntent([record.subject, record.body, pr?.title, pr?.body].filter(Boolean).join('\n'));
      const deterministic = signals.itemId || signals.slug || signals.prExplicitItem || (signals.branchName && signals.pathOrExcerpt) || (signals.pathOrExcerpt && signals.nearTitle);
      const unrelatedClosureOnly = signals.changedPathsPresent && signals.unrelatedChangedPaths && !signals.pathOrExcerpt && !signals.branchName && !signals.prExplicitItem;
      const broadAmbiguous = signals.broadOnly || (!deterministic && (signals.nearTitle || signals.unrelatedChangedPaths)) || unrelatedClosureOnly;
      const confidence = closureIntent === undefined ? 'weak' : deterministic && !broadAmbiguous ? 'strong' : 'ambiguous';
      const intent = classifyEvidenceIntent({ closureIntent, confidence, signals });
      const evidenceSource = pr === undefined ? 'git-history' : 'combined';
      const commit = { hash: record.hash, shortHash: record.shortHash, subject: record.subject, isMerge: record.isMerge, ...(record.committedAt && { committedAt: record.committedAt }) };
      const candidatePr = pr !== undefined ? { ...pr, changedPaths: boundChangedPaths(pr.changedPaths, caps) } : record.prNumbers[0] !== undefined ? { source: 'pr-history' as const, number: record.prNumbers[0], changedPaths: [] } : undefined;
      candidates.push({
        itemId: item.id,
        itemTitle: item.title,
        confidence,
        evidenceSource,
        score: signalScore(signals) + (record.isMerge ? 20 : 0) + (closureIntent !== undefined ? 15 : 0),
        citation: formatCitation({ evidenceSource, commit, ...(candidatePr !== undefined && { pr: candidatePr }), lifecycleRows: [] }),
        reasons: signals.reasons,
        commit,
        ...(candidatePr !== undefined ? { pr: candidatePr } : {}),
        lifecycleRows: [],
        changedPaths: boundChangedPaths([...(record.changedPaths ?? []), ...(pr?.changedPaths ?? [])], caps),
        branchHints: [...new Set([...record.branchHints, pr?.headRefName ?? ''].filter(Boolean))].slice(0, caps.branchHintCount),
        excerpts,
        intent,
        matchedBy: signals.matchedBy,
      });
    }
  }
  markAmbiguousClosureTies(candidates);
  const rankedCandidates = rankEvidenceCandidates(candidates).slice(0, caps.candidateCount);
  const affectedItemCandidates = rankedCandidates.map((candidate) => projectAffectedCandidate(candidate, caps));
  const shippedEvidenceCandidates = rankedCandidates.filter((candidate) => candidate.intent !== 'affected').map(projectPreclassifiedCandidate);
  return { affectedItemCandidates, shippedEvidenceCandidates };
}

export function evidencePrefixForCandidate(candidate: Pick<ShippedEvidenceCandidate, 'intent' | 'evidenceSource' | 'confidence'>): string {
  if (candidate.intent === 'superseded') return candidate.evidenceSource === 'lifecycle' ? SUPERSEDED_LIFECYCLE_EVIDENCE_PREFIX : SUPERSEDED_GIT_PR_EVIDENCE_PREFIX;
  if (candidate.intent === 'ambiguous-superseded') return AMBIGUOUS_SUPERSEDED_EVIDENCE_PREFIX;
  if (candidate.intent === 'ambiguous-shipped') return AMBIGUOUS_SHIPPED_EVIDENCE_PREFIX;
  if (candidate.intent === 'shipped') return candidate.evidenceSource === 'lifecycle' ? SHIPPED_LIFECYCLE_EVIDENCE_PREFIX : SHIPPED_GIT_PR_EVIDENCE_PREFIX;
  return '';
}

export function formatCandidateEvidence(candidate: ShippedEvidenceCandidate): string | undefined {
  const prefix = evidencePrefixForCandidate(candidate);
  if (prefix.length === 0) return undefined;
  return `${prefix}${boundString(formatCitation(candidate), 280)}`;
}

export function projectPreclassifiedCandidate(candidate: ShippedEvidenceCandidate): ShippedEvidenceCandidate {
  const evidence = formatCandidateEvidence(candidate);
  return { ...candidate, ...(evidence !== undefined && { evidence, sourceLabel: evidence.split(' — ')[0] }) };
}

function projectAffectedCandidate(candidate: ShippedEvidenceCandidate, caps: ShippedEvidenceCaps): GitDeltaAffectedItemCandidate {
  const intent = candidate.intent ?? 'affected';
  const evidence = formatCandidateEvidence(candidate) ?? `Affected candidate: ${boundString(formatCitation(candidate), 280)}`;
  return {
    itemId: candidate.itemId,
    itemTitle: candidate.itemTitle,
    intent,
    confidence: intent === 'affected' ? 'medium' : candidate.confidence === 'strong' ? 'strong' : 'ambiguous',
    score: candidate.score,
    matchedBy: candidate.matchedBy ?? [],
    evidence,
    sourceLabel: evidence.split(' — ')[0],
    ...(candidate.commit && { commit: candidate.commit }),
    ...(candidate.pr && { pr: { number: candidate.pr.number, ...(candidate.pr.title && { title: candidate.pr.title }), ...(candidate.pr.url && { url: candidate.pr.url }), ...(candidate.pr.state && { state: candidate.pr.state }), ...(candidate.pr.mergedAt && { mergedAt: candidate.pr.mergedAt }), ...(candidate.pr.headRefName && { branch: candidate.pr.headRefName }) } }),
    changedPaths: candidate.changedPaths.slice(0, caps.changedPathCount),
    branchHints: candidate.branchHints.slice(0, caps.branchHintCount),
    excerpts: candidate.excerpts.slice(0, caps.excerptCount),
  };
}

export function markAmbiguousClosureTies(candidates: ShippedEvidenceCandidate[]): void {
  const byCommit = new Map<string, ShippedEvidenceCandidate[]>();
  for (const candidate of candidates) {
    if (candidate.commit === undefined || candidate.intent === 'affected') continue;
    const key = `${candidate.commit.hash}:${candidate.score}`;
    byCommit.set(key, [...(byCommit.get(key) ?? []), candidate]);
  }
  for (const tied of byCommit.values()) {
    if (new Set(tied.map((candidate) => candidate.itemId)).size < 2) continue;
    for (const candidate of tied) {
      if (candidate.intent === 'shipped') candidate.intent = 'ambiguous-shipped';
      if (candidate.intent === 'superseded') candidate.intent = 'ambiguous-superseded';
      candidate.confidence = 'ambiguous';
    }
  }
}

function rankEvidenceCandidates(candidates: readonly ShippedEvidenceCandidate[]): ShippedEvidenceCandidate[] {
  const intentRank: Record<string, number> = { shipped: 50, superseded: 50, 'ambiguous-shipped': 40, 'ambiguous-superseded': 40, affected: 30 };
  const confidenceRank: Record<string, number> = { strong: 30, ambiguous: 20, weak: 10 };
  return [...candidates].sort((left, right) => (confidenceRank[right.confidence] - confidenceRank[left.confidence])
    || ((intentRank[right.intent ?? 'affected'] ?? 0) - (intentRank[left.intent ?? 'affected'] ?? 0))
    || right.score - left.score
    || candidateMostRecentTime(right).localeCompare(candidateMostRecentTime(left))
    || left.itemId.localeCompare(right.itemId)
    || left.citation.localeCompare(right.citation));
}

function reachablePullRequestMerge(record: GitHistoryRecord, pr: ShippedEvidencePrMetadata | undefined): boolean {
  return pr !== undefined && (pr.mergeCommitOid === record.hash || (record.isMerge && record.prNumbers.includes(pr.number)));
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error('Backlog curation evidence classification was aborted.');
}
