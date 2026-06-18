import type { BacklogItem, LifecycleLinkRow, TraceSummary } from './backlog-domain.js';
import { collectGitFileExcerpts, collectGitHistoryRecords } from './shipped-evidence-git.js';
import { analyzeEvidenceMatch, classifyConfidence, detectClosureIntent, formatCitation, rankCandidates, signalScore, classifyEvidenceIntent } from './shipped-evidence-matching.js';
import { formatCandidateEvidence, markAmbiguousClosureTies, projectPreclassifiedCandidate } from './backlog-curation-evidence-classification.js';
import { enrichPullRequests } from './shipped-evidence-pr.js';
import type { CollectShippedEvidenceInput, GitHistoryCollection, GitHistoryRecord, PreCollectedPullRequestEnrichment, ShippedEvidenceCandidate, ShippedEvidenceCaps, ShippedEvidenceDiagnostic, ShippedEvidencePrMetadata, ShippedEvidenceProvider, ShippedEvidenceResult } from './shipped-evidence-types.js';
import { boundChangedPaths, boundString, normalizeShippedEvidenceCaps } from './shipped-evidence-limits.js';

export async function collectShippedEvidence(input: CollectShippedEvidenceInput): Promise<ShippedEvidenceResult> {
  return shippedEvidenceProvider.collect(input);
}

export const shippedEvidenceProvider: ShippedEvidenceProvider = {
  async collect(input) {
    const caps = normalizeShippedEvidenceCaps(input.caps);
    const diagnostics: ShippedEvidenceDiagnostic[] = [];
    const traceRowsByItemId = lifecycleRowsByItemId(input.traceSummaries ?? []);
    throwIfAborted(input.signal);
    const git = input.gitHistory === undefined ? await collectGitHistoryRecords(input.cwd, caps, input.signal) : capPreCollectedGitHistory(input.gitHistory, caps);
    diagnostics.push(...git.diagnostics);

    const candidates: ShippedEvidenceCandidate[] = [];
    for (const item of input.items) {
      throwIfAborted(input.signal);
      for (const record of git.records) {
        throwIfAborted(input.signal);
        const candidate = await candidateFromGitRecord(input.cwd, item, record, traceRowsByItemId.get(item.id) ?? [], caps, diagnostics, input.signal);
        if (candidate) candidates.push(candidate);
      }
      candidates.push(...candidatesFromLifecycle(item, traceRowsByItemId.get(item.id) ?? [], caps));
    }

    if (input.enrichPullRequests !== false) {
      throwIfAborted(input.signal);
      const prNumbers = git.records.flatMap((record) => record.prNumbers);
      const enrichment = input.pullRequestEnrichment === undefined ? await enrichPullRequests({ cwd: input.cwd, numbers: prNumbers, caps, signal: input.signal }) : capPreCollectedPullRequests(input.pullRequestEnrichment, caps);
      throwIfAborted(input.signal);
      diagnostics.push(...enrichment.diagnostics);
      mergePullRequestMetadata(candidates, enrichment.pullRequests, git.records, input.items, caps);
    }

    markAmbiguousClosureTies(candidates);
    const ranked = rankCandidates(dedupeCandidates(candidates.map(projectPreclassifiedCandidate))).slice(0, caps.candidateCount);
    if (candidates.length > ranked.length) diagnostics.push({ code: 'capExceeded', message: `Shipped evidence candidates capped at ${caps.candidateCount}.` });
    return { candidates: ranked, diagnostics: diagnostics.slice(0, caps.diagnosticCount), caps };
  },
};

function capPreCollectedGitHistory(gitHistory: GitHistoryCollection, caps: ShippedEvidenceCaps): GitHistoryCollection {
  const records = gitHistory.records.slice(0, caps.gitCommitScanCount);
  const diagnostics = [...gitHistory.diagnostics];
  if (gitHistory.records.length > records.length) diagnostics.push({ code: 'capExceeded', message: `Pre-collected git history capped at ${caps.gitCommitScanCount} commits.` });
  return { records, diagnostics: diagnostics.slice(0, caps.diagnosticCount) };
}

function capPreCollectedPullRequests(enrichment: PreCollectedPullRequestEnrichment, caps: ShippedEvidenceCaps): PreCollectedPullRequestEnrichment {
  const pullRequests = enrichment.pullRequests.slice(0, caps.prEnrichmentCount);
  const diagnostics = [...enrichment.diagnostics];
  if (enrichment.pullRequests.length > pullRequests.length) diagnostics.push({ code: 'capExceeded', message: `Pre-collected pull request metadata capped at ${caps.prEnrichmentCount} pull requests.` });
  return { pullRequests, diagnostics: diagnostics.slice(0, caps.diagnosticCount) };
}

async function candidateFromGitRecord(cwd: string, item: BacklogItem, record: GitHistoryRecord, lifecycleRows: LifecycleLinkRow[], caps: ShippedEvidenceCaps, diagnostics: ShippedEvidenceDiagnostic[], signal: AbortSignal | undefined): Promise<ShippedEvidenceCandidate | undefined> {
  const preliminary = analyzeEvidenceMatch({ item, record });
  if (!preliminary.itemId && !preliminary.slug && !preliminary.branchName && preliminary.titleScore < 0.35) return undefined;
  throwIfAborted(signal);
  const excerpts = await collectGitFileExcerpts({ cwd, record, queryText: `${item.id} ${item.title}`, caps, diagnostics, signal });
  const excerptText = excerpts.map((excerpt) => excerpt.text).join('\n');
  const signals = analyzeEvidenceMatch({ item, record, excerptText });
  const closureIntent = detectClosureIntent(`${record.subject}\n${record.body ?? ''}`);
  const confidence = closureIntent === undefined ? 'weak' : classifyConfidence({ source: 'git-history', reachableLanding: hasLocalLandingSignal(record) || closureIntent === 'superseded', signals });
  const intent = classifyEvidenceIntent({ closureIntent, confidence, signals });
  const candidate: ShippedEvidenceCandidate = {
    itemId: item.id,
    itemTitle: item.title,
    confidence,
    evidenceSource: lifecycleRows.length > 0 ? 'combined' : 'git-history',
    score: signalScore(signals) + (record.isMerge ? 20 : 0),
    citation: '',
    reasons: signals.reasons,
    commit: {
      hash: record.hash,
      shortHash: record.shortHash,
      subject: record.subject,
      isMerge: record.isMerge,
      ...(record.committedAt && { committedAt: record.committedAt }),
    },
    ...(record.prNumbers[0] !== undefined && { pr: { source: 'pr-history' as const, number: record.prNumbers[0], ...(record.branchHints[0] !== undefined && { headRefName: record.branchHints[0] }), changedPaths: [] } }),
    lifecycleRows,
    changedPaths: boundChangedPaths(record.changedPaths, caps),
    branchHints: record.branchHints.slice(0, caps.branchHintCount),
    excerpts: excerpts.slice(0, caps.excerptCount),
    intent,
    matchedBy: signals.matchedBy,
  };
  candidate.citation = formatCitation(candidate);
  return projectPreclassifiedCandidate(candidate);
}

function mergePullRequestMetadata(candidates: ShippedEvidenceCandidate[], pullRequests: readonly ShippedEvidencePrMetadata[], records: readonly GitHistoryRecord[], items: readonly BacklogItem[], caps: ShippedEvidenceCaps): void {
  const prByNumber = new Map(pullRequests.map((pr) => [pr.number, pr]));
  const recordByHash = new Map(records.map((record) => [record.hash, record]));
  const candidatesByItem = new Map(items.map((item) => [item.id, item]));
  for (const candidate of candidates) {
    const record = candidate.commit ? recordByHash.get(candidate.commit.hash) : undefined;
    const pr = record?.prNumbers.map((number) => prByNumber.get(number)).find((value): value is ShippedEvidencePrMetadata => value !== undefined);
    const item = candidatesByItem.get(candidate.itemId);
    if (!record || !pr || !item) continue;
    mergePullRequestIntoCandidate(candidate, item, record, pr, caps);
  }
  for (const record of records) {
    const pr = record.prNumbers.map((number) => prByNumber.get(number)).find((value): value is ShippedEvidencePrMetadata => value !== undefined);
    if (!pr) continue;
    for (const item of items) {
      if (hasCandidateForRecordOrPr(candidates, item.id, record, pr)) continue;
      const signals = analyzeEvidenceMatch({ item, record, pr });
      if (!signals.prMetadata) continue;
      const localLanding = hasLocalLandingSignal(record);
      const reachablePrMerge = hasReachablePullRequestMergeCommit(record, pr);
      const confidence = classifyConfidence({ source: 'git-history', reachableLanding: localLanding || reachablePrMerge, staleOrUnreachablePr: !localLanding && isStaleOrUnreachablePullRequest(record, pr), signals });
      const closureIntent = reachablePrMerge && pullRequestIsMerged(pr) ? 'shipped' : detectClosureIntent(`${record.subject}\n${record.body ?? ''}\n${pr.title ?? ''}\n${pr.body ?? ''}`);
      const candidate: ShippedEvidenceCandidate = {
        itemId: item.id,
        itemTitle: item.title,
        confidence,
        evidenceSource: 'combined',
        score: signalScore(signals) + (record.isMerge ? 20 : 0),
        citation: '',
        reasons: signals.reasons,
        commit: {
          hash: record.hash,
          shortHash: record.shortHash,
          subject: record.subject,
          isMerge: record.isMerge,
          ...(record.committedAt && { committedAt: record.committedAt }),
        },
        pr: { ...pr, changedPaths: boundChangedPaths(pr.changedPaths, caps) },
        lifecycleRows: [],
        changedPaths: boundChangedPaths(uniqueStrings([...record.changedPaths, ...pr.changedPaths]), caps),
        branchHints: uniqueStrings([...record.branchHints, pr.headRefName ?? '']).filter(Boolean).slice(0, caps.branchHintCount),
        excerpts: [],
        intent: classifyEvidenceIntent({ closureIntent, confidence, signals }),
        matchedBy: signals.matchedBy,
      };
      candidate.citation = formatCitation(candidate);
      candidates.push(projectPreclassifiedCandidate(candidate));
    }
  }
}

function mergePullRequestIntoCandidate(candidate: ShippedEvidenceCandidate, item: BacklogItem, record: GitHistoryRecord, pr: ShippedEvidencePrMetadata, caps: ShippedEvidenceCaps): void {
  const signals = analyzeEvidenceMatch({
    item,
    record,
    pr,
    excerptText: candidate.excerpts.map((excerpt) => excerpt.text).join('\n'),
  });
  const hasLifecycleEvidence = candidate.evidenceSource === 'lifecycle' || candidate.lifecycleRows.length > 0;
  candidate.pr = { ...pr, changedPaths: boundChangedPaths(pr.changedPaths, caps) };
  if (!hasLifecycleEvidence) candidate.evidenceSource = 'combined';
  candidate.changedPaths = boundChangedPaths(uniqueStrings([...candidate.changedPaths, ...pr.changedPaths]), caps);
  candidate.branchHints = uniqueStrings([...candidate.branchHints, pr.headRefName ?? '']).filter(Boolean).slice(0, caps.branchHintCount);
  candidate.reasons = uniqueStrings([...candidate.reasons, ...signals.reasons]);
  const localLanding = hasLocalLandingSignal(record);
  const reachablePrMerge = hasReachablePullRequestMergeCommit(record, pr);
  const enrichedConfidence = classifyConfidence({ source: 'git-history', reachableLanding: localLanding || reachablePrMerge, staleOrUnreachablePr: !localLanding && isStaleOrUnreachablePullRequest(record, pr), signals });
  candidate.confidence = hasLifecycleEvidence ? strongerConfidence(candidate.confidence, enrichedConfidence) : enrichedConfidence;
  candidate.score += signalScore(signals);
  candidate.citation = formatCitation(candidate);
  const closureIntent = reachablePrMerge && pullRequestIsMerged(pr) ? 'shipped' : detectClosureIntent(`${record.subject}\n${record.body ?? ''}\n${pr.title ?? ''}\n${pr.body ?? ''}`, candidate.lifecycleRows[0]?.status);
  candidate.intent = classifyEvidenceIntent({ closureIntent, confidence: candidate.confidence, signals });
  candidate.matchedBy = signals.matchedBy;
  const evidence = formatCandidateEvidence(candidate);
  if (evidence !== undefined) candidate.evidence = evidence;
}

function hasCandidateForRecordOrPr(candidates: readonly ShippedEvidenceCandidate[], itemId: string, record: GitHistoryRecord, pr: ShippedEvidencePrMetadata): boolean {
  return candidates.some((candidate) => candidate.itemId === itemId && (candidate.commit?.hash === record.hash || candidate.pr?.number === pr.number));
}

function candidatesFromLifecycle(item: BacklogItem, rows: readonly LifecycleLinkRow[], caps: ShippedEvidenceCaps): ShippedEvidenceCandidate[] {
  return rows.filter(isLandingLikeRow).slice(0, caps.candidateCount).map((row) => {
    const signals = analyzeEvidenceMatch({ item, lifecycleText: rowToText(row) });
    const staleOrUnreachablePr = row.stage === 'pr-open' || row.status === 'pr-open';
    const reachableLanding = row.stage === 'landing' || row.status === 'shipped' || row.status === 'merged';
    const closureIntent = detectClosureIntent(rowToText(row), row.status);
    const confidence = classifyConfidence({ source: 'lifecycle', reachableLanding: reachableLanding || closureIntent === 'superseded', staleOrUnreachablePr, signals });
    const prNumber = row.prUrl ? extractPrNumberFromUrl(row.prUrl) : undefined;
    const candidate: ShippedEvidenceCandidate = {
      itemId: item.id,
      itemTitle: item.title,
      confidence,
      evidenceSource: 'lifecycle',
      score: signalScore(signals) + (row.status === 'shipped' || row.status === 'merged' ? 10 : 0),
      citation: '',
      reasons: signals.reasons.length > 0 ? signals.reasons : ['lifecycle trace references item'],
      ...(row.commitSha && { commit: { hash: row.commitSha, shortHash: row.commitSha.slice(0, 12), subject: row.label, isMerge: false, ...(row.timestamp && { committedAt: row.timestamp }) } }),
      ...(prNumber && { pr: { source: 'pr-history', number: prNumber, url: row.prUrl, changedPaths: [] } }),
      lifecycleRows: [row],
      changedPaths: row.path ? boundChangedPaths([row.path], caps) : [],
      branchHints: row.featureBranch ? [row.featureBranch] : [],
      excerpts: [{ evidenceSource: 'lifecycle', text: boundString(rowToText(row), caps.excerptBytes), ...(row.path && { path: boundString(row.path, caps.changedPathBytes) }) }],
      intent: classifyEvidenceIntent({ closureIntent, confidence, signals }),
      matchedBy: signals.matchedBy,
    };
    candidate.citation = formatCitation(candidate);
    return projectPreclassifiedCandidate(candidate);
  });
}

function lifecycleRowsByItemId(summaries: readonly TraceSummary[]): Map<string, LifecycleLinkRow[]> {
  const rows = new Map<string, LifecycleLinkRow[]>();
  for (const summary of summaries) {
    rows.set(summary.itemId, dedupeLifecycleRows([...summary.landingRefs, ...summary.prRefs, ...summary.linkRows.filter(isLandingLikeRow)]));
  }
  return rows;
}

function dedupeLifecycleRows(rows: readonly LifecycleLinkRow[]): LifecycleLinkRow[] {
  const byKey = new Map<string, LifecycleLinkRow>();
  for (const row of rows) {
    const key = [row.kind, row.stage, row.status, row.label, row.session, row.prdId, row.runId, row.sessionId, row.featureBranch, row.commitSha, row.prUrl, row.path, row.timestamp, row.completedAt, ...(row.affectedItemIds ?? [])].join('\u0000');
    if (!byKey.has(key)) byKey.set(key, row);
  }
  return [...byKey.values()];
}

function isLandingLikeRow(row: LifecycleLinkRow): boolean {
  return row.kind === 'landing' || row.kind === 'pr' || row.stage === 'landing' || row.stage === 'pr-open' || row.status === 'superseded' || row.prUrl !== undefined || row.commitSha !== undefined;
}

function dedupeCandidates(candidates: readonly ShippedEvidenceCandidate[]): ShippedEvidenceCandidate[] {
  const byKey = new Map<string, ShippedEvidenceCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.itemId}:${candidate.commit?.hash ?? ''}:${candidate.pr?.number ?? candidate.citation}`;
    const existing = byKey.get(key);
    if (!existing || rankCandidates([candidate, existing])[0] === candidate) byKey.set(key, candidate);
  }
  return [...byKey.values()];
}

function rowToText(row: LifecycleLinkRow): string {
  return [row.kind, row.stage, row.status, row.label, row.featureBranch, row.commitSha, row.prUrl, row.path, ...(row.affectedItemIds ?? [])].filter(Boolean).join('\n');
}

function extractPrNumberFromUrl(value: string): number | undefined {
  const match = /\/pull\/(\d+)/.exec(value);
  return match ? Number(match[1]) : undefined;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))].sort();
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error('Shipped evidence collection was aborted.');
}

function hasLocalLandingSignal(record: GitHistoryRecord): boolean {
  return record.isMerge || /\b(merge(?:d)?|land(?:ed|ing)?|ship(?:ped)?|release(?:d)?)\b/i.test(record.subject);
}

function hasReachablePullRequestMergeCommit(record: GitHistoryRecord, pr: ShippedEvidencePrMetadata): boolean {
  return pr.mergeCommitOid !== undefined && pr.mergeCommitOid === record.hash;
}

function pullRequestIsMerged(pr: ShippedEvidencePrMetadata): boolean {
  return pr.mergedAt !== undefined || pr.state?.toUpperCase() === 'MERGED';
}

function isStaleOrUnreachablePullRequest(record: GitHistoryRecord, pr: ShippedEvidencePrMetadata): boolean {
  return !hasReachablePullRequestMergeCommit(record, pr);
}

function strongerConfidence(left: ShippedEvidenceCandidate['confidence'], right: ShippedEvidenceCandidate['confidence']): ShippedEvidenceCandidate['confidence'] {
  const rank: Record<ShippedEvidenceCandidate['confidence'], number> = { strong: 3, ambiguous: 2, weak: 1 };
  return rank[left] >= rank[right] ? left : right;
}
