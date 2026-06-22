import { open, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import type { BacklogItem, TraceSummary } from './backlog-domain.js';
import { classifyBacklogCurationEvidence } from './backlog-curation-evidence-classification.js';
import { collectGitHistoryRecordsForRange } from './shipped-evidence-git.js';
import { enrichPullRequests } from './shipped-evidence-pr.js';
import { collectShippedEvidence } from './shipped-evidence.js';
import { boundString, normalizeShippedEvidenceCaps } from './shipped-evidence-limits.js';
import { exactItemIdMatch, normalizeSlug, titleTokenScore, tokenizeTitle } from './shipped-evidence-matching.js';
import type { ShippedEvidenceCandidate, ShippedEvidenceCaps, ShippedEvidenceDiagnostic, GitDeltaAffectedItemCandidate } from './shipped-evidence-types.js';
import { collectSourceFirstAuditResults, projectSourceFirstClosureCandidates, projectSourceFirstResultsForFingerprint, sourceFirstAuditSettings, type SourceFirstAuditResult, type SourceFirstCurrentEvidenceInput, type SourceFirstHistoricalHint } from './backlog-curation-source-first-audit.js';

// --- eforge:region public-collection-types ---
export interface FullImplementationAuditCaps {
  fileScanCount: number;
  fileBytes: number;
  evidencePerItem: number;
  pathsPerCategory: number;
  excerptBytes: number;
  diagnosticCount: number;
  gitCommitScanCount: number;
  prEnrichmentCount: number;
}

export interface FullImplementationAuditDiagnostic {
  code: 'file-scan-cap-truncated' | 'file-read-failed' | 'git-history-unavailable' | 'pr-enrichment-unavailable' | 'evidence-cap-truncated';
  severity: 'info' | 'warning';
  message: string;
  path?: string;
  detail?: string;
}

export interface FullImplementationAuditResult {
  context: Record<string, unknown>;
  preview: Record<string, unknown>;
  fingerprint: Record<string, unknown>;
  shippedEvidenceCandidates: ShippedEvidenceCandidate[];
  diagnostics: FullImplementationAuditDiagnostic[];
}

interface CurrentStateHit {
  itemId: string;
  evidenceSource: 'current-file-state' | 'code-search' | 'test-search' | 'documentation-search';
  confidence: 'strong' | 'ambiguous';
  matchedBy: string[];
  path: string;
  excerpt: string;
  score: number;
}

const DEFAULT_CAPS: FullImplementationAuditCaps = {
  fileScanCount: 600,
  fileBytes: 80_000,
  evidencePerItem: 6,
  pathsPerCategory: 6,
  excerptBytes: 260,
  diagnosticCount: 12,
  gitCommitScanCount: 250,
  prEnrichmentCount: 10,
};

const EXCLUDED_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.next', '.turbo', '.cache']);
const SECRET_PATH = /(^|\/)(\.env|\.npmrc|\.pypirc|id_rsa|id_dsa|id_ecdsa|id_ed25519|credentials?|secrets?)(\.|$|\/)|\.(pem|key|p12|pfx|crt|cer|env)$/i;
const TEXT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md', '.mdx', '.txt', '.yaml', '.yml', '.html', '.css', '.scss', '.java', '.scala', '.py', '.go', '.rs', '.sh']);

export async function collectBacklogCurationFullImplementationAudit(input: {
  cwd: string;
  items: readonly BacklogItem[];
  traceSummaries: readonly TraceSummary[];
  caps?: Partial<FullImplementationAuditCaps & ShippedEvidenceCaps>;
  itemAuditConcurrency?: number;
  enrichPullRequests?: boolean;
  signal?: AbortSignal;
}): Promise<FullImplementationAuditResult> {
  const caps = normalizeFullAuditCaps(input.caps);
  const diagnostics: FullImplementationAuditDiagnostic[] = [];
  const itemIds = input.items.map((item) => item.id).sort();
  const currentHits = await collectCurrentStateHits(input.cwd, input.items, caps, diagnostics, input.signal);
  const shippedCaps = normalizeShippedEvidenceCaps({ ...input.caps, gitCommitScanCount: caps.gitCommitScanCount, prEnrichmentCount: caps.prEnrichmentCount });
  const gitHistory = await collectGitHistoryRecordsForRange(input.cwd, { maxCount: caps.gitCommitScanCount, allowOverflowProbe: true }, shippedCaps, input.signal);
  diagnostics.push(...mapGitDiagnostics(gitHistory.diagnostics));
  if (gitHistory.records.length > caps.gitCommitScanCount) {
    diagnostics.push({ code: 'evidence-cap-truncated', severity: 'info', message: `Full-audit git history capped at ${caps.gitCommitScanCount} commits.` });
  }
  const records = gitHistory.records.slice(0, caps.gitCommitScanCount);
  const prEnrichment = input.enrichPullRequests === false
    ? { pullRequests: [], diagnostics: [] as ShippedEvidenceDiagnostic[] }
    : await enrichPullRequests({ cwd: input.cwd, numbers: records.flatMap((record) => record.prNumbers), caps: shippedCaps, signal: input.signal });
  diagnostics.push(...mapPrDiagnostics(prEnrichment.diagnostics));
  const classified = await classifyBacklogCurationEvidence({ cwd: input.cwd, items: input.items, traceSummaries: input.traceSummaries, gitHistory: { records, diagnostics: gitHistory.diagnostics }, pullRequests: prEnrichment.pullRequests, caps: shippedCaps, diagnostics: gitHistory.diagnostics, signal: input.signal });
  const shipped = await collectShippedEvidence({ cwd: input.cwd, items: input.items, traceSummaries: input.traceSummaries, gitHistory: { records, diagnostics: gitHistory.diagnostics }, pullRequestEnrichment: prEnrichment, caps: shippedCaps, enrichPullRequests: true, signal: input.signal });
  diagnostics.push(...mapGitDiagnostics(shipped.diagnostics));
  const historicalClosureCandidates = dedupeCandidates([...classified.shippedEvidenceCandidates, ...shipped.candidates])
    .filter((candidate) => candidate.intent !== 'affected')
    .sort(byCandidate);
  const historicalHints = buildHistoricalHints(historicalClosureCandidates, classified.affectedItemCandidates);
  const sourceFirstResults = await collectSourceFirstAuditResults({
    items: input.items.map((item) => ({ item, currentEvidence: currentHits.filter((hit) => hit.itemId === item.id).map(projectCurrentHitForSourceFirst), historicalHints: historicalHints.filter((hint) => hint.itemId === item.id), traceSummary: input.traceSummaries.find((summary) => summary.itemId === item.id) })),
    itemAuditConcurrency: input.itemAuditConcurrency,
    signal: input.signal,
  });
  const sourceFirstByItem = new Map(sourceFirstResults.map((result) => [result.itemId, result]));
  const sourceFirstClosureCandidates = projectSourceFirstClosureCandidates(sourceFirstResults);
  const items = input.items.map((item) => projectAuditItem(item, currentHits.filter((hit) => hit.itemId === item.id), historicalClosureCandidates.filter((candidate) => candidate.itemId === item.id), input.traceSummaries.find((summary) => summary.itemId === item.id), sourceFirstByItem.get(item.id), caps, diagnostics)).sort((a, b) => String(a.itemId).localeCompare(String(b.itemId)));
  const currentStateEvidenceTruncatedCount = items.reduce((sum, item) => sum + (typeof item.currentStateEvidenceTruncatedCount === 'number' ? item.currentStateEvidenceTruncatedCount : 0), 0);
  const boundedDiagnostics = diagnostics.slice(0, caps.diagnosticCount);
  const context = {
    schemaVersion: 1,
    guidance: [
      'Source-first implementation audit covers every open backlog item in scope with bounded current-source excerpts and navigation-only historical hints.',
      'Current source is the closure authority for shipped/superseded status; git history, PR metadata, lifecycle traces, branch hints, changed paths, and session-plan traces are navigation hints used to interpret current source.',
      'Treat ambiguous or partial evidence as a lead to resolve into actionable backlog curation, open follow-up recommendations, or true product-decision needs-input; use skipped only for exceptional review failures.',
      'Use source-shipped/source-superseded item results and current-source citations for closed-status proposals; keep unproven closure items open but make the draft fix-forward.',
      'Do not claim exhaustive validation beyond supplied bounded current-source citations and caps.',
    ],
    settings: sourceFirstAuditSettings(input.itemAuditConcurrency),
    scope: { itemIds, openItemCount: itemIds.length },
    coverage: { auditedItemCount: itemIds.length, currentStateFileCount: new Set(currentHits.map((hit) => hit.path)).size, currentStateHitCount: currentHits.length, currentStateEvidenceTruncatedCount, gitHistoryCommitCount: records.length, pullRequestCount: prEnrichment.pullRequests.length },
    caps,
    items,
    historicalHints: historicalHints.map(stripHintItemId),
    sourceFirstResults,
    closureCandidates: sourceFirstClosureCandidates,
    diagnostics: boundedDiagnostics,
  };
  const preview = {
    scope: context.scope,
    coverage: context.coverage,
    caps: context.caps,
    settings: context.settings,
    diagnostics: boundedDiagnostics,
    sourceFirstResults,
    historicalHints: (context.historicalHints as SourceFirstHistoricalHint[]).slice(0, 50),
    closureCandidates: sourceFirstClosureCandidates,
    itemSummaries: items.map((item) => ({ itemId: item.itemId, candidateIntent: item.candidateIntent, evidenceCount: Array.isArray(item.evidence) ? item.evidence.length : 0, confidence: item.confidence, currentStateEvidenceTruncatedCount: item.currentStateEvidenceTruncatedCount, evidence: item.evidence, closureCandidates: item.closureCandidates, sourceFirstResult: item.sourceFirstResult })),
  };
  return { context, preview, fingerprint: projectFullImplementationAuditForFingerprint(context), shippedEvidenceCandidates: [], diagnostics: boundedDiagnostics };
}

export function projectFullImplementationAuditForFingerprint(value: Record<string, unknown>): Record<string, unknown> {
  return {
    schemaVersion: value.schemaVersion,
    scope: value.scope,
    coverage: value.coverage,
    caps: value.caps,
    settings: value.settings,
    sourceFirstResults: projectSourceFirstResultsForFingerprint((value.sourceFirstResults ?? []) as SourceFirstAuditResult[]),
    historicalHints: value.historicalHints,
    items: (value.items as Array<Record<string, unknown>>).map((item) => ({ itemId: item.itemId, candidateIntent: item.candidateIntent, confidence: item.confidence, evidence: item.evidence, sourceFirstResult: item.sourceFirstResult })),
    closureCandidates: value.closureCandidates,
    diagnostics: (value.diagnostics as Array<Record<string, unknown>>).map((diagnostic) => ({ code: diagnostic.code, severity: diagnostic.severity, path: diagnostic.path })),
  };
}
// --- eforge:endregion public-collection-types ---

// --- eforge:region diagnostics-cap-helpers ---
function normalizeFullAuditCaps(caps: Partial<FullImplementationAuditCaps> | undefined): FullImplementationAuditCaps {
  return {
    fileScanCount: cap(caps?.fileScanCount, DEFAULT_CAPS.fileScanCount, 5_000),
    fileBytes: cap(caps?.fileBytes, DEFAULT_CAPS.fileBytes, 500_000),
    evidencePerItem: cap(caps?.evidencePerItem, DEFAULT_CAPS.evidencePerItem, 25),
    pathsPerCategory: cap(caps?.pathsPerCategory, DEFAULT_CAPS.pathsPerCategory, 25),
    excerptBytes: cap(caps?.excerptBytes, DEFAULT_CAPS.excerptBytes, 2_000),
    diagnosticCount: cap(caps?.diagnosticCount, DEFAULT_CAPS.diagnosticCount, 50),
    gitCommitScanCount: cap(caps?.gitCommitScanCount, DEFAULT_CAPS.gitCommitScanCount, 500),
    prEnrichmentCount: cap(caps?.prEnrichmentCount, DEFAULT_CAPS.prEnrichmentCount, 25),
  };
}
// --- eforge:endregion diagnostics-cap-helpers ---

// --- eforge:region current-state-file-scan ---
async function collectCurrentStateHits(cwd: string, items: readonly BacklogItem[], caps: FullImplementationAuditCaps, diagnostics: FullImplementationAuditDiagnostic[], signal?: AbortSignal): Promise<CurrentStateHit[]> {
  const files = await listRepositoryFiles(cwd, caps, diagnostics, signal);
  const hits: CurrentStateHit[] = [];
  for (const path of files) {
    throwIfAborted(signal);
    let bounded = '';
    try { bounded = await readFilePrefix(join(cwd, path), caps.fileBytes); } catch (error) {
      diagnostics.push({ code: 'file-read-failed', severity: 'warning', message: `Unable to read ${path}.`, path, detail: error instanceof Error ? error.message : String(error) });
      continue;
    }
    for (const item of items) {
      const hit = matchCurrentFile(item, path, bounded, caps);
      if (hit) hits.push(hit);
    }
  }
  return hits.sort(byHit);
}

async function listRepositoryFiles(cwd: string, caps: FullImplementationAuditCaps, diagnostics: FullImplementationAuditDiagnostic[], signal?: AbortSignal): Promise<string[]> {
  const files: string[] = [];
  let overflow = false;
  async function visit(dir: string): Promise<void> {
    if (overflow) return;
    throwIfAborted(signal);
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (overflow) break;
      const abs = join(dir, entry.name);
      const rel = relative(cwd, abs).split(sep).join('/');
      if (shouldExclude(rel, entry.name)) continue;
      if (entry.isDirectory()) await visit(abs);
      else if (entry.isFile() && isTextLike(rel)) {
        if (files.length >= caps.fileScanCount) overflow = true;
        else files.push(rel);
      }
    }
  }
  await visit(cwd);
  if (overflow) diagnostics.push({ code: 'file-scan-cap-truncated', severity: 'warning', message: `Current-state file scan capped at ${caps.fileScanCount} files.` });
  return files;
}

async function readFilePrefix(path: string, limit: number): Promise<string> {
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(Math.max(0, limit));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).toString('utf-8');
  } finally {
    await handle.close();
  }
}

function matchCurrentFile(item: BacklogItem, path: string, text: string, caps: FullImplementationAuditCaps): CurrentStateHit | undefined {
  const haystack = `${path}\n${text}`;
  const itemSlug = normalizeSlug(item.id);
  const titleSlug = normalizeSlug(item.title);
  const matchedBy = [
    ...(exactItemIdMatch(haystack, item.id) ? ['item-id'] : []),
    ...(normalizeSlug(path).includes(itemSlug) || (titleSlug.length >= 8 && normalizeSlug(path).includes(titleSlug)) ? ['path'] : []),
    ...(titleTokenScore(item.title, haystack) >= 0.55 ? ['item-title'] : []),
  ];
  if (matchedBy.length === 0) return undefined;
  const excerpt = excerptFor(text, [...tokenizeTitle(`${item.id} ${item.title}`), item.id], caps.excerptBytes);
  return { itemId: item.id, evidenceSource: categoryForPath(path, item), confidence: matchedBy.includes('item-id') || matchedBy.includes('path') ? 'strong' : 'ambiguous', matchedBy, path, excerpt, score: matchedBy.length * 10 + titleTokenScore(item.title, haystack) * 10 };
}
// --- eforge:endregion current-state-file-scan ---

// --- eforge:region item-candidate-projection ---
type ItemHistoricalHint = SourceFirstHistoricalHint & { itemId: string };

function buildHistoricalHints(candidates: readonly ShippedEvidenceCandidate[], affected: readonly GitDeltaAffectedItemCandidate[]): ItemHistoricalHint[] {
  return [
    ...candidates.map((candidate) => ({ itemId: candidate.itemId, source: candidate.evidenceSource, intent: candidate.intent, confidence: candidate.confidence, citation: candidate.citation, evidence: candidate.evidence, closureAuthority: false as const })),
    ...affected.map((candidate) => ({ itemId: candidate.itemId, source: candidate.sourceLabel, intent: candidate.intent, confidence: candidate.confidence, citation: candidate.evidence, evidence: candidate.evidence, closureAuthority: false as const })),
  ];
}

function stripHintItemId(hint: ItemHistoricalHint): SourceFirstHistoricalHint {
  const { itemId: _itemId, ...rest } = hint;
  return rest;
}

function projectCurrentHitForSourceFirst(hit: CurrentStateHit): SourceFirstCurrentEvidenceInput {
  return { source: hit.evidenceSource, confidence: hit.confidence, matchedBy: hit.matchedBy, path: hit.path, excerpt: hit.excerpt };
}

function projectAuditItem(item: BacklogItem, hits: CurrentStateHit[], candidates: ShippedEvidenceCandidate[], trace: TraceSummary | undefined, sourceFirst: SourceFirstAuditResult | undefined, caps: FullImplementationAuditCaps, diagnostics: FullImplementationAuditDiagnostic[]): Record<string, unknown> {
  const pathBoundedHits = boundHitsPerCategoryPath(hits, caps.pathsPerCategory);
  const evidenceHits = pathBoundedHits.slice(0, caps.evidencePerItem);
  const evidence = evidenceHits.map((hit) => ({ source: hit.evidenceSource, confidence: hit.confidence, matchedBy: hit.matchedBy, path: hit.path, excerpt: hit.excerpt }));
  const truncatedCount = Math.max(0, hits.length - evidence.length);
  if (truncatedCount > 0) diagnostics.push({ code: 'evidence-cap-truncated', severity: 'info', message: `Full-audit current-state evidence capped for ${item.id}.` });
  const staleInvalid = isStaleOrInvalid(item);
  const candidateIntent = sourceFirst?.intent === 'source-shipped' ? 'shipped'
    : sourceFirst?.intent === 'source-superseded' ? 'superseded'
      : sourceFirst?.intent === 'partial' ? 'partial-implementation'
        : sourceFirst?.intent === 'recheck-note' && hits.length === 0 ? 'recheck-note'
          : hits.length > 0 ? 'partial-implementation' : staleInvalid ? 'stale-invalid' : 'no-change';
  return {
    itemId: item.id,
    title: item.title,
    candidateIntent,
    confidence: sourceFirst?.confidence ?? (hits.length > 0 ? evidence[0]?.confidence ?? 'ambiguous' : staleInvalid ? 'ambiguous' : 'weak'),
    matchedSignals: [...new Set([...hits.flatMap((hit) => hit.matchedBy), ...candidates.flatMap((candidate) => candidate.matchedBy ?? [])])].sort(),
    evidence,
    currentStateEvidenceCount: hits.length,
    currentStateEvidenceTruncatedCount: truncatedCount,
    historicalHints: candidates.map(projectCandidate),
    closureCandidates: sourceFirst === undefined ? [] : projectSourceFirstClosureCandidates([sourceFirst]),
    ...(sourceFirst !== undefined && { sourceFirstResult: sourceFirst }),
    ...(trace !== undefined && { lifecycleTrace: { lifecycleState: trace.lifecycleState, hasActiveTrace: trace.hasActiveTrace, linkRowCount: trace.linkRows.length, landingRefCount: trace.landingRefs.length, prRefCount: trace.prRefs.length } }),
    guidance: guidanceFor(candidateIntent),
  };
}

function boundHitsPerCategoryPath(hits: readonly CurrentStateHit[], pathsPerCategory: number): CurrentStateHit[] {
  const pathCounts = new Map<CurrentStateHit['evidenceSource'], Set<string>>();
  return hits.filter((hit) => {
    const paths = pathCounts.get(hit.evidenceSource) ?? new Set<string>();
    if (!paths.has(hit.path) && paths.size >= pathsPerCategory) return false;
    paths.add(hit.path);
    pathCounts.set(hit.evidenceSource, paths);
    return true;
  });
}

function projectCandidate(candidate: ShippedEvidenceCandidate): Record<string, unknown> {
  return {
    itemId: candidate.itemId,
    intent: candidate.intent,
    source: candidate.evidenceSource,
    evidenceSource: candidate.evidenceSource,
    closureAuthority: false,
    confidence: candidate.confidence,
    matchedBy: candidate.matchedBy ?? [],
    evidence: candidate.evidence,
    citation: candidate.citation,
    ...(candidate.commit && { commit: { shortHash: candidate.commit.shortHash, subject: candidate.commit.subject, committedAt: candidate.commit.committedAt } }),
    ...(candidate.pr && { pr: { number: candidate.pr.number, title: candidate.pr.title, state: candidate.pr.state, mergedAt: candidate.pr.mergedAt } }),
  };
}

function guidanceFor(intent: string): string {
  if (intent === 'partial-implementation') return 'Keep open; turn partial evidence into concrete remaining-work curation or recommendations rather than a generic skip.';
  if (intent === 'needs-input') return 'Use needs-input only for true product decisions after source/context review; do not close without current-source authority.';
  if (intent === 'stale-invalid') return 'Consider stale/invalid cleanup only with supplied metadata evidence.';
  if (intent === 'no-change') return 'No supplied repository evidence supports closure; omit if already fresh or recommend concrete next work if useful.';
  return 'Closure proposal requires the supplied strong evidence prefix and citation.';
}

// --- eforge:endregion item-candidate-projection ---

// --- eforge:region formatting-redaction-helpers ---
function categoryForPath(path: string, item: BacklogItem): CurrentStateHit['evidenceSource'] {
  if (exactItemIdMatch(path, item.id) || normalizeSlug(path).includes(normalizeSlug(item.id))) return 'current-file-state';
  const lower = path.toLowerCase();
  if (/(^|\/)(test|tests|__tests__|spec)(\/|$)|\.(test|spec)\.[cm]?[jt]sx?$/.test(lower)) return 'test-search';
  if (/\.(md|mdx|txt)$|(^|\/)(docs?|documentation)(\/|$)/.test(lower)) return 'documentation-search';
  if (/\.md$/.test(lower)) return 'documentation-search';
  return 'code-search';
}

function excerptFor(text: string, tokens: readonly string[], limit: number): string {
  const lowered = tokens.map((token) => token.toLowerCase()).filter((token) => token.length >= 3);
  const lines = text.split(/\r?\n/).filter((line) => lowered.some((token) => line.toLowerCase().includes(token))).slice(0, 3).join('\n');
  return redact(boundString(lines || text.slice(0, limit), limit));
}

function redact(text: string): string {
  return text.replace(/-----BEGIN [^-]+PRIVATE KEY-----[\s\S]*?-----END [^-]+PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]')
    .replace(/\b(AKIA|ASIA)[A-Z0-9]{16}\b/g, '[REDACTED TOKEN]')
    .replace(/\b(authorization)(\s*:\s*)bearer\s+[^\s'\",;]+/gi, '$1$2Bearer [REDACTED]')
    .replace(/\b((?:(?:export\s+)?(?:const|let|var)\s+)?[A-Za-z_$][\w$.-]*)(\s*[:=]\s*)(?:(["'])[^\s'\"]+\3|[^\s'\",;]+)/g, (match, key: string, separator: string, quote: string | undefined) => isSecretAssignmentKey(key) ? `${key}${separator}${quote ?? ''}[REDACTED]${quote ?? ''}` : match)
    .replace(/\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b|\bsk-[A-Za-z0-9_-]{20,}\b|\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g, '[REDACTED TOKEN]');
}

function isSecretAssignmentKey(key: string): boolean {
  return /(?:secret|token|api[_-]?key|apikey|password|passwd)/i.test(key.replace(/^(?:export\s+)?(?:const|let|var)\s+/i, ''));
}

function shouldExclude(rel: string, name: string): boolean {
  return EXCLUDED_DIRS.has(name) || rel === '.eforge' || rel.startsWith('.eforge/') || SECRET_PATH.test(rel);
}

function isTextLike(path: string): boolean {
  const match = /\.[^.\/]+$/.exec(path);
  return match === null || TEXT_EXTENSIONS.has(match[0].toLowerCase());
}

function isStaleOrInvalid(item: BacklogItem): boolean {
  return item.tags.some((tag) => /^(stale|invalid|obsolete)$/i.test(tag)) || (typeof item.stale_after === 'string' && item.stale_after.length > 0 && item.stale_after < new Date().toISOString().slice(0, 10));
}

// --- eforge:endregion formatting-redaction-helpers ---

// --- eforge:region shipped-diagnostics-candidate-helpers ---
function mapGitDiagnostics(diagnostics: readonly ShippedEvidenceDiagnostic[]): FullImplementationAuditDiagnostic[] {
  return diagnostics.map((diagnostic) => ({ code: diagnostic.code === 'capExceeded' ? 'evidence-cap-truncated' : 'git-history-unavailable', severity: diagnostic.code === 'capExceeded' ? 'info' : 'warning', message: diagnostic.message, detail: diagnostic.detail }));
}

function mapPrDiagnostics(diagnostics: readonly ShippedEvidenceDiagnostic[]): FullImplementationAuditDiagnostic[] {
  return diagnostics.map((diagnostic) => ({ code: diagnostic.code === 'capExceeded' ? 'evidence-cap-truncated' : 'pr-enrichment-unavailable', severity: diagnostic.code === 'capExceeded' ? 'info' : 'warning', message: diagnostic.message, detail: diagnostic.detail }));
}

function dedupeCandidates(candidates: readonly ShippedEvidenceCandidate[]): ShippedEvidenceCandidate[] {
  const byKey = new Map<string, ShippedEvidenceCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.itemId}:${candidate.intent}:${candidate.commit?.hash ?? ''}:${candidate.pr?.number ?? ''}:${candidate.citation}`;
    if (!byKey.has(key)) byKey.set(key, candidate);
  }
  return [...byKey.values()];
}

function byCandidate(left: ShippedEvidenceCandidate, right: ShippedEvidenceCandidate): number {
  return left.itemId.localeCompare(right.itemId) || String(left.intent).localeCompare(String(right.intent)) || (left.commit?.shortHash ?? '').localeCompare(right.commit?.shortHash ?? '') || (left.pr?.number ?? 0) - (right.pr?.number ?? 0) || left.citation.localeCompare(right.citation);
}

function byHit(left: CurrentStateHit, right: CurrentStateHit): number {
  return left.itemId.localeCompare(right.itemId) || right.score - left.score || left.evidenceSource.localeCompare(right.evidenceSource) || left.path.localeCompare(right.path) || left.excerpt.localeCompare(right.excerpt);
}

// --- eforge:endregion shipped-diagnostics-candidate-helpers ---

// --- eforge:region diagnostics-cap-runtime-helpers ---
function cap(value: unknown, fallback: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.min(Math.floor(value), max) : fallback;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error('Backlog curation full implementation audit was aborted.');
}
// --- eforge:endregion diagnostics-cap-runtime-helpers ---
