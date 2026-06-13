import type { BacklogItem, LifecycleLinkRow, TraceSummary } from './backlog-domain.js';
import { collectGitFileExcerpts, collectGitHistoryRecords } from './shipped-evidence-git.js';
import { analyzeEvidenceMatch, classifyConfidence, formatCitation, rankCandidates, signalScore } from './shipped-evidence-matching.js';
import { enrichPullRequests } from './shipped-evidence-pr.js';
import type { CollectShippedEvidenceInput, GitHistoryRecord, ShippedEvidenceCandidate, ShippedEvidenceCaps, ShippedEvidenceDiagnostic, ShippedEvidencePrMetadata, ShippedEvidenceProvider, ShippedEvidenceResult } from './shipped-evidence-types.js';
import { boundChangedPaths, boundString, normalizeShippedEvidenceCaps } from './shipped-evidence-limits.js';

export async function collectShippedEvidence(input: CollectShippedEvidenceInput): Promise<ShippedEvidenceResult> {
  return shippedEvidenceProvider.collect(input);
}

export const shippedEvidenceProvider: ShippedEvidenceProvider = {
  async collect(input) {
    const caps = normalizeShippedEvidenceCaps(input.caps);
    const diagnostics: ShippedEvidenceDiagnostic[] = [];
    const traceRowsByItemId = lifecycleRowsByItemId(input.traceSummaries ?? []);
    const git = await collectGitHistoryRecords(input.cwd, caps);
    diagnostics.push(...git.diagnostics);

    const candidates: ShippedEvidenceCandidate[] = [];
    for (const item of input.items) {
      for (const record of git.records) {
        const candidate = await candidateFromGitRecord(input.cwd, item, record, traceRowsByItemId.get(item.id) ?? [], caps, diagnostics);
        if (candidate) candidates.push(candidate);
      }
      candidates.push(...candidatesFromLifecycle(item, traceRowsByItemId.get(item.id) ?? [], caps));
    }

    if (input.enrichPullRequests !== false) {
      const prNumbers = candidates.flatMap((candidate) => candidate.commit ? git.records.find((record) => record.hash === candidate.commit?.hash)?.prNumbers ?? [] : []);
      const enrichment = await enrichPullRequests({ cwd: input.cwd, numbers: prNumbers, caps });
      diagnostics.push(...enrichment.diagnostics);
      mergePullRequestMetadata(candidates, enrichment.pullRequests, git.records, caps);
    }

    const ranked = rankCandidates(dedupeCandidates(candidates)).slice(0, caps.candidateCount);
    if (candidates.length > ranked.length) diagnostics.push({ code: 'capExceeded', message: `Shipped evidence candidates capped at ${caps.candidateCount}.` });
    return { candidates: ranked, diagnostics: diagnostics.slice(0, caps.diagnosticCount), caps };
  },
};

async function candidateFromGitRecord(cwd: string, item: BacklogItem, record: GitHistoryRecord, lifecycleRows: LifecycleLinkRow[], caps: ShippedEvidenceCaps, diagnostics: ShippedEvidenceDiagnostic[]): Promise<ShippedEvidenceCandidate | undefined> {
  const preliminary = analyzeEvidenceMatch({ item, record });
  if (!preliminary.itemId && !preliminary.slug && !preliminary.branchName && preliminary.titleScore < 0.35) return undefined;
  const excerpts = await collectGitFileExcerpts({ cwd, record, queryText: `${item.id} ${item.title}`, caps, diagnostics });
  const excerptText = excerpts.map((excerpt) => excerpt.text).join('\n');
  const signals = analyzeEvidenceMatch({ item, record, excerptText });
  const confidence = classifyConfidence({ source: 'git-history', reachableLanding: hasLocalLandingSignal(record), signals });
  const candidate: ShippedEvidenceCandidate = {
    itemId: item.id,
    itemTitle: item.title,
    confidence,
    source: 'git-history',
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
    lifecycleRows,
    changedPaths: boundChangedPaths(record.changedPaths, caps),
    branchHints: record.branchHints.slice(0, caps.branchHintCount),
    excerpts: excerpts.slice(0, caps.excerptCount),
  };
  candidate.citation = formatCitation(candidate);
  return candidate;
}

function mergePullRequestMetadata(candidates: ShippedEvidenceCandidate[], pullRequests: readonly ShippedEvidencePrMetadata[], records: readonly GitHistoryRecord[], caps: ShippedEvidenceCaps): void {
  const prByNumber = new Map(pullRequests.map((pr) => [pr.number, pr]));
  const recordByHash = new Map(records.map((record) => [record.hash, record]));
  for (const candidate of candidates) {
    const record = candidate.commit ? recordByHash.get(candidate.commit.hash) : undefined;
    const pr = record?.prNumbers.map((number) => prByNumber.get(number)).find((value): value is ShippedEvidencePrMetadata => value !== undefined);
    if (!record || !pr) continue;
    const signals = analyzeEvidenceMatch({
      item: { id: candidate.itemId, title: candidate.itemTitle, status: 'candidate', tags: [], depends_on: [], body: '' },
      record,
      pr,
      excerptText: candidate.excerpts.map((excerpt) => excerpt.text).join('\n'),
    });
    candidate.pr = { ...pr, changedPaths: boundChangedPaths(pr.changedPaths, caps) };
    candidate.changedPaths = boundChangedPaths(uniqueStrings([...candidate.changedPaths, ...pr.changedPaths]), caps);
    candidate.branchHints = uniqueStrings([...candidate.branchHints, pr.headRefName ?? '']).filter(Boolean).slice(0, caps.branchHintCount);
    candidate.reasons = uniqueStrings([...candidate.reasons, ...signals.reasons]);
    const localLanding = hasLocalLandingSignal(record);
    candidate.confidence = classifyConfidence({ source: 'git-history', reachableLanding: localLanding || hasMergedPullRequestEvidence(record, pr), staleOrUnreachablePr: !localLanding && isStaleOrUnreachablePullRequest(record, pr), signals });
    candidate.score += signalScore(signals);
    candidate.citation = formatCitation(candidate);
  }
}

function candidatesFromLifecycle(item: BacklogItem, rows: readonly LifecycleLinkRow[], caps: ShippedEvidenceCaps): ShippedEvidenceCandidate[] {
  return rows.filter(isLandingLikeRow).slice(0, caps.candidateCount).map((row) => {
    const signals = analyzeEvidenceMatch({ item, lifecycleText: rowToText(row) });
    const staleOrUnreachablePr = row.stage === 'pr-open' || row.status === 'pr-open';
    const confidence = classifyConfidence({ source: 'lifecycle-trace', reachableLanding: false, staleOrUnreachablePr, signals });
    const prNumber = row.prUrl ? extractPrNumberFromUrl(row.prUrl) : undefined;
    const candidate: ShippedEvidenceCandidate = {
      itemId: item.id,
      itemTitle: item.title,
      confidence,
      source: 'lifecycle-trace',
      score: signalScore(signals) + (row.status === 'shipped' || row.status === 'merged' ? 10 : 0),
      citation: '',
      reasons: signals.reasons.length > 0 ? signals.reasons : ['lifecycle trace references item'],
      ...(row.commitSha && { commit: { hash: row.commitSha, shortHash: row.commitSha.slice(0, 12), subject: row.label, isMerge: false, ...(row.timestamp && { committedAt: row.timestamp }) } }),
      ...(prNumber && { pr: { source: 'github-pr', number: prNumber, url: row.prUrl, changedPaths: [] } }),
      lifecycleRows: [row],
      changedPaths: row.path ? boundChangedPaths([row.path], caps) : [],
      branchHints: row.featureBranch ? [row.featureBranch] : [],
      excerpts: [{ source: 'lifecycle-trace', text: boundString(rowToText(row), caps.excerptBytes), ...(row.path && { path: boundString(row.path, caps.changedPathBytes) }) }],
    };
    candidate.citation = formatCitation(candidate);
    return candidate;
  });
}

function lifecycleRowsByItemId(summaries: readonly TraceSummary[]): Map<string, LifecycleLinkRow[]> {
  const rows = new Map<string, LifecycleLinkRow[]>();
  for (const summary of summaries) {
    rows.set(summary.itemId, [...summary.landingRefs, ...summary.prRefs, ...summary.linkRows.filter(isLandingLikeRow)]);
  }
  return rows;
}

function isLandingLikeRow(row: LifecycleLinkRow): boolean {
  return row.kind === 'landing' || row.kind === 'pr' || row.stage === 'landing' || row.stage === 'pr-open' || row.prUrl !== undefined || row.commitSha !== undefined;
}

function dedupeCandidates(candidates: readonly ShippedEvidenceCandidate[]): ShippedEvidenceCandidate[] {
  const byKey = new Map<string, ShippedEvidenceCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.itemId}:${candidate.commit?.hash ?? candidate.pr?.number ?? candidate.citation}`;
    const existing = byKey.get(key);
    if (!existing || rankCandidates([candidate, existing])[0] === candidate) byKey.set(key, candidate);
  }
  return [...byKey.values()];
}

function rowToText(row: LifecycleLinkRow): string {
  return [row.kind, row.stage, row.status, row.label, row.featureBranch, row.commitSha, row.prUrl, row.path].filter(Boolean).join('\n');
}

function extractPrNumberFromUrl(value: string): number | undefined {
  const match = /\/pull\/(\d+)/.exec(value);
  return match ? Number(match[1]) : undefined;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))].sort();
}

function hasLocalLandingSignal(record: GitHistoryRecord): boolean {
  return record.isMerge || /\b(merge(?:d)?|land(?:ed|ing)?|ship(?:ped)?|release(?:d)?)\b/i.test(record.subject);
}

function hasMergedPullRequestEvidence(record: GitHistoryRecord, pr: ShippedEvidencePrMetadata): boolean {
  return pr.state?.toUpperCase() === 'MERGED' || pr.mergedAt !== undefined || (pr.mergeCommitOid !== undefined && pr.mergeCommitOid === record.hash);
}

function isStaleOrUnreachablePullRequest(record: GitHistoryRecord, pr: ShippedEvidencePrMetadata): boolean {
  return !hasMergedPullRequestEvidence(record, pr);
}
