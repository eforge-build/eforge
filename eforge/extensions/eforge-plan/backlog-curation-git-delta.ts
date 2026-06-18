import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { canonicalJson } from './markdown-store-support.js';
import { collectGitHistoryRecordsForRange } from './shipped-evidence-git.js';
import { boundString, normalizeShippedEvidenceCaps } from './shipped-evidence-limits.js';
import { enrichPullRequests, type PullRequestEnrichmentResult } from './shipped-evidence-pr.js';
import type { GitDeltaAffectedItemCandidate, GitHistoryCollection, GitHistoryRecord, ShippedEvidenceCaps, ShippedEvidenceDiagnostic, ShippedEvidencePrMetadata } from './shipped-evidence-types.js';

const execFile = promisify(execFileCallback);
const BASELINE_RELATIVE_PATH = '.eforge/storage/extensions/eforge-plan/analysis-baseline/current.json';
const HEX_COMMIT_PATTERN = '^(?:[a-f0-9]{40}|[a-f0-9]{64})$';
const DIAGNOSTIC_LIMIT = 20;

export const AcceptedAnalysisBaselineSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  taskId: Type.String({ minLength: 1 }),
  passKind: Type.String({ minLength: 1 }),
  sourceFingerprint: Type.String({ minLength: 1 }),
  acceptedAt: Type.String({ minLength: 1 }),
  git: Type.Object({
    headCommit: Type.Union([Type.String({ pattern: HEX_COMMIT_PATTERN }), Type.Null()]),
    headCommittedAt: Type.Optional(Type.String()),
  }, { additionalProperties: false }),
  coverage: Type.Object({}, { additionalProperties: true }),
  diagnostics: Type.Array(Type.Object({}, { additionalProperties: true })),
}, { additionalProperties: false });

export type AcceptedAnalysisBaseline = Static<typeof AcceptedAnalysisBaselineSchema>;

export interface BacklogCurationGitDeltaCaps {
  commitScanCount: number;
  changedPathCount: number;
  excerptCount: number;
  excerptBytes: number;
  prEnrichmentCount: number;
  subprocessTimeoutMs: number;
}

export interface BacklogCurationGitDeltaDiagnostic {
  code: 'git-unavailable' | 'baseline-missing' | 'baseline-invalid-sidecar' | 'baseline-unreachable' | 'baseline-shallow' | 'scan-cap-truncated' | 'changed-path-cap-truncated' | 'git-command-failed' | 'pr-cap-truncated' | 'pr-enrichment-unavailable';
  severity: 'info' | 'warning';
  message: string;
  commit?: string;
  detail?: string;
}

export interface BacklogCurationGitDeltaSource {
  baseline: { source: 'accepted-analysis-sidecar' | 'missing' | 'invalid-sidecar' | 'unavailable'; commit: string | null; time?: string; taskId?: string; sourceFingerprint?: string };
  currentHead: { commit: string; time?: string } | null;
  coverage: { kind: 'complete' | 'fallback' | 'unavailable'; range?: string; reason?: string };
  caps: BacklogCurationGitDeltaCaps;
  scannedCommitCount: number;
  scannedCommits: Array<Record<string, unknown>>;
  affectedItemCandidates: GitDeltaAffectedItemCandidate[];
  diagnostics: BacklogCurationGitDeltaDiagnostic[];
}

export interface BacklogCurationGitDeltaWithHistory {
  gitDelta: BacklogCurationGitDeltaSource;
  gitHistory: GitHistoryCollection;
  pullRequestEnrichment?: PullRequestEnrichmentResult;
}

const DEFAULT_CAPS: BacklogCurationGitDeltaCaps = {
  commitScanCount: 80,
  changedPathCount: 12,
  excerptCount: 3,
  excerptBytes: 320,
  prEnrichmentCount: 6,
  subprocessTimeoutMs: 3500,
};

const MAX_CAPS: BacklogCurationGitDeltaCaps = {
  commitScanCount: 500,
  changedPathCount: 100,
  excerptCount: 10,
  excerptBytes: 2_000,
  prEnrichmentCount: 25,
  subprocessTimeoutMs: 15_000,
};

export function acceptedAnalysisBaselinePath(cwd: string): string {
  return join(cwd, BASELINE_RELATIVE_PATH);
}

export async function readAcceptedAnalysisBaseline(cwd: string): Promise<AcceptedAnalysisBaseline | null> {
  const result = await readBaseline(cwd);
  return result.kind === 'valid' ? result.baseline : null;
}

export async function writeAcceptedAnalysisBaseline(cwd: string, baseline: Omit<AcceptedAnalysisBaseline, 'schemaVersion'> & { schemaVersion?: 1 }): Promise<AcceptedAnalysisBaseline> {
  const value: AcceptedAnalysisBaseline = { ...baseline, schemaVersion: 1 };
  if (!Value.Check(AcceptedAnalysisBaselineSchema, value)) throw new Error('Invalid accepted-analysis baseline sidecar.');
  const path = acceptedAnalysisBaselinePath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
  return value;
}

export async function collectBacklogCurationGitDelta(input: { cwd: string; caps?: Partial<BacklogCurationGitDeltaCaps>; enrichPullRequests?: boolean; signal?: AbortSignal }): Promise<BacklogCurationGitDeltaSource> {
  return (await collectBacklogCurationGitDeltaWithHistory(input)).gitDelta;
}

export async function collectBacklogCurationGitDeltaWithHistory(input: { cwd: string; caps?: Partial<BacklogCurationGitDeltaCaps>; enrichPullRequests?: boolean; signal?: AbortSignal }): Promise<BacklogCurationGitDeltaWithHistory> {
  const caps = normalizeGitDeltaCaps(input.caps);
  const diagnostics: BacklogCurationGitDeltaDiagnostic[] = [];
  const baselineRead = await readBaseline(input.cwd);
  throwIfAborted(input.signal);
  const inside = await runGit(input.cwd, ['rev-parse', '--is-inside-work-tree'], caps, input.signal);
  if (!inside.ok || inside.stdout.trim() !== 'true') {
    diagnostics.push({ code: 'git-unavailable', severity: 'warning', message: 'Git is unavailable for backlog curation git-delta collection.', detail: inside.ok ? undefined : inside.detail });
    return { gitDelta: buildDelta(baselineProjection(baselineRead), null, { kind: 'unavailable', reason: 'git-unavailable' }, caps, [], diagnostics), gitHistory: unavailableGitHistory(inside.ok ? undefined : inside.detail) };
  }

  const head = await resolveHead(input.cwd, caps, input.signal);
  if (head === null) {
    diagnostics.push({ code: 'git-unavailable', severity: 'warning', message: 'Unable to resolve current HEAD for backlog curation git-delta collection.' });
    return { gitDelta: buildDelta(baselineProjection(baselineRead), null, { kind: 'unavailable', reason: 'git-unavailable' }, caps, [], diagnostics), gitHistory: unavailableGitHistory() };
  }

  const baseline = baselineProjection(baselineRead);
  let coverage: BacklogCurationGitDeltaSource['coverage'] = { kind: 'fallback', reason: 'baseline-missing' };
  let revisionRange: string | undefined;
  if (baselineRead.kind === 'missing') diagnostics.push({ code: 'baseline-missing', severity: 'info', message: 'Accepted-analysis baseline sidecar is missing; scanning bounded recent history.' });
  else if (baselineRead.kind === 'invalid') diagnostics.push({ code: 'baseline-invalid-sidecar', severity: 'warning', message: 'Accepted-analysis baseline sidecar is invalid; scanning bounded recent history.', detail: baselineRead.detail });
  else if (baselineRead.baseline.git.headCommit === null) diagnostics.push({ code: 'baseline-missing', severity: 'info', message: 'Accepted-analysis baseline has no git HEAD; scanning bounded recent history.' });
  else {
    const commit = baselineRead.baseline.git.headCommit;
    const shallow = await runGit(input.cwd, ['rev-parse', '--is-shallow-repository'], caps, input.signal);
    const shallowRepo = shallow.ok && shallow.stdout.trim() === 'true';
    if (shallowRepo) diagnostics.push({ code: 'baseline-shallow', severity: 'warning', message: 'Repository is shallow; scanning bounded recent history.', commit });
    else if (!(await commitExists(input.cwd, commit, caps, input.signal)) || !(await isAncestor(input.cwd, commit, head.commit, caps, input.signal))) {
      diagnostics.push({ code: 'baseline-unreachable', severity: 'warning', message: 'Accepted-analysis baseline commit is unavailable or not an ancestor of HEAD; scanning bounded recent history.', commit });
    } else {
      revisionRange = `${commit}..${head.commit}`;
      coverage = { kind: 'complete', range: revisionRange };
    }
  }

  let scan = await collectGitHistoryRecordsForRange(input.cwd, { revisionRange, maxCount: caps.commitScanCount, allowOverflowProbe: true }, toShippedCaps(caps), input.signal);
  const rangeScanFailed = coverage.kind === 'complete' && hasPrimaryRangeScanFailure(scan.diagnostics);
  const primaryRangeDiagnostics = rangeScanFailed ? scan.diagnostics : [];
  if (rangeScanFailed) {
    coverage = { kind: 'fallback', reason: 'git-command-failed' };
    scan = await collectGitHistoryRecordsForRange(input.cwd, { maxCount: caps.commitScanCount, allowOverflowProbe: true }, toShippedCaps(caps), input.signal);
  }
  const truncated = scan.records.length > caps.commitScanCount;
  const records = scan.records.slice(0, caps.commitScanCount);
  diagnostics.push(...mapShippedDiagnostics(primaryRangeDiagnostics), ...mapShippedDiagnostics(scan.diagnostics));
  if (rangeScanFailed) diagnostics.push({ code: 'git-command-failed', severity: 'warning', message: 'Complete git-delta range scan failed; scanning bounded recent history instead.' });
  if (truncated) {
    diagnostics.push({ code: 'scan-cap-truncated', severity: 'warning', message: `Git delta scan capped at ${caps.commitScanCount} commits.` });
    if (coverage.kind === 'complete') coverage = { kind: 'fallback', reason: 'scan-cap-truncated' };
  }
  if (coverage.kind !== 'complete') coverage = { kind: 'fallback', reason: diagnostics.find((d) => d.code.startsWith('baseline-'))?.code ?? coverage.reason ?? 'fallback-recent-history' };

  let pullRequestEnrichment: PullRequestEnrichmentResult | undefined;
  if (input.enrichPullRequests !== false) {
    pullRequestEnrichment = await enrichPullRequests({ cwd: input.cwd, numbers: records.flatMap((record) => record.prNumbers), caps: toShippedCaps(caps), signal: input.signal });
    diagnostics.push(...pullRequestEnrichment.diagnostics.map(mapPrDiagnostic));
  }
  const prs = new Map((pullRequestEnrichment?.pullRequests ?? []).map((pr) => [pr.number, pr]));
  const gitHistory = { records, diagnostics: scan.diagnostics };
  return { gitDelta: buildDelta(baseline, head, coverage, caps, records.map((record) => projectCommit(record, prs, caps)), diagnostics), gitHistory, ...(pullRequestEnrichment && { pullRequestEnrichment }) };
}

export function projectGitDeltaForFingerprint(gitDelta: BacklogCurationGitDeltaSource): Record<string, unknown> {
  return {
    baseline: gitDelta.baseline,
    currentHead: gitDelta.currentHead,
    coverage: gitDelta.coverage,
    caps: gitDelta.caps,
    scannedCommitCount: gitDelta.scannedCommitCount,
    scannedCommits: gitDelta.scannedCommits,
    affectedItemCandidates: gitDelta.affectedItemCandidates,
    diagnostics: gitDelta.diagnostics.map((diagnostic) => ({ code: diagnostic.code, severity: diagnostic.severity, ...(diagnostic.commit && { commit: diagnostic.commit }) })),
  };
}

async function readBaseline(cwd: string): Promise<{ kind: 'valid'; baseline: AcceptedAnalysisBaseline } | { kind: 'missing' } | { kind: 'invalid'; detail: string }> {
  try {
    const value = JSON.parse(await readFile(acceptedAnalysisBaselinePath(cwd), 'utf8')) as unknown;
    if (!Value.Check(AcceptedAnalysisBaselineSchema, value)) return { kind: 'invalid', detail: [...Value.Errors(AcceptedAnalysisBaselineSchema, value)].map((error) => error.message).join('; ') };
    return { kind: 'valid', baseline: value };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' };
    return { kind: 'invalid', detail: error instanceof Error ? error.message : String(error) };
  }
}

function baselineProjection(read: Awaited<ReturnType<typeof readBaseline>>): BacklogCurationGitDeltaSource['baseline'] {
  if (read.kind === 'missing') return { source: 'missing', commit: null };
  if (read.kind === 'invalid') return { source: 'invalid-sidecar', commit: null };
  return { source: read.baseline.git.headCommit === null ? 'unavailable' : 'accepted-analysis-sidecar', commit: read.baseline.git.headCommit, time: read.baseline.git.headCommittedAt, taskId: read.baseline.taskId, sourceFingerprint: read.baseline.sourceFingerprint };
}

function buildDelta(baseline: BacklogCurationGitDeltaSource['baseline'], currentHead: BacklogCurationGitDeltaSource['currentHead'], coverage: BacklogCurationGitDeltaSource['coverage'], caps: BacklogCurationGitDeltaCaps, scannedCommits: Array<Record<string, unknown>>, diagnostics: BacklogCurationGitDeltaDiagnostic[]): BacklogCurationGitDeltaSource {
  return { baseline, currentHead, coverage, caps, scannedCommitCount: scannedCommits.length, scannedCommits, affectedItemCandidates: [], diagnostics: diagnostics.slice(0, DIAGNOSTIC_LIMIT) };
}

function unavailableGitHistory(detail?: string): GitHistoryCollection {
  return { records: [], diagnostics: [{ code: 'gitUnavailable', message: 'Git history is unavailable for shipped-evidence collection.', ...(detail && { detail }) }] };
}

function projectCommit(record: GitHistoryRecord, prs: Map<number, ShippedEvidencePrMetadata>, caps: BacklogCurationGitDeltaCaps): Record<string, unknown> {
  const pr = record.prNumbers.map((number) => prs.get(number)).find((value): value is ShippedEvidencePrMetadata => value !== undefined);
  return {
    hash: record.hash,
    shortHash: record.shortHash,
    subject: boundString(record.subject, caps.excerptBytes),
    ...(record.body && { bodyExcerpt: boundString(record.body, caps.excerptBytes) }),
    ...(record.committedAt && { committedAt: record.committedAt }),
    parents: record.parents,
    isMerge: record.isMerge,
    changedPaths: record.changedPaths.slice(0, caps.changedPathCount),
    branchHints: record.branchHints,
    prNumbers: record.prNumbers.slice(0, caps.prEnrichmentCount),
    ...(pr && { pr: { number: pr.number, title: pr.title, url: pr.url, state: pr.state, mergedAt: pr.mergedAt, headRefName: pr.headRefName, baseRefName: pr.baseRefName, mergeCommitOid: pr.mergeCommitOid, changedPaths: pr.changedPaths.slice(0, caps.changedPathCount) } }),
  };
}

async function resolveHead(cwd: string, caps: BacklogCurationGitDeltaCaps, signal?: AbortSignal): Promise<{ commit: string; time?: string } | null> {
  const commit = await runGit(cwd, ['rev-parse', 'HEAD'], caps, signal);
  if (!commit.ok) return null;
  const time = await runGit(cwd, ['show', '-s', '--format=%cI', 'HEAD'], caps, signal);
  return { commit: commit.stdout.trim(), ...(time.ok && { time: time.stdout.trim() }) };
}

async function commitExists(cwd: string, commit: string, caps: BacklogCurationGitDeltaCaps, signal?: AbortSignal): Promise<boolean> {
  return (await runGit(cwd, ['cat-file', '-e', `${commit}^{commit}`], caps, signal)).ok;
}

async function isAncestor(cwd: string, commit: string, head: string, caps: BacklogCurationGitDeltaCaps, signal?: AbortSignal): Promise<boolean> {
  return (await runGit(cwd, ['merge-base', '--is-ancestor', commit, head], caps, signal)).ok;
}

async function runGit(cwd: string, args: readonly string[], caps: BacklogCurationGitDeltaCaps, signal?: AbortSignal): Promise<{ ok: true; stdout: string } | { ok: false; detail: string }> {
  try {
    throwIfAborted(signal);
    const { stdout } = await execFile('git', [...args], { cwd, timeout: caps.subprocessTimeoutMs, maxBuffer: 1024 * 1024, signal });
    return { ok: true, stdout: String(stdout) };
  } catch (error) {
    throwIfAborted(signal);
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

function normalizeGitDeltaCaps(caps: Partial<BacklogCurationGitDeltaCaps> = {}): BacklogCurationGitDeltaCaps {
  return {
    commitScanCount: cap(caps.commitScanCount, DEFAULT_CAPS.commitScanCount, MAX_CAPS.commitScanCount),
    changedPathCount: cap(caps.changedPathCount, DEFAULT_CAPS.changedPathCount, MAX_CAPS.changedPathCount),
    excerptCount: cap(caps.excerptCount, DEFAULT_CAPS.excerptCount, MAX_CAPS.excerptCount),
    excerptBytes: cap(caps.excerptBytes, DEFAULT_CAPS.excerptBytes, MAX_CAPS.excerptBytes),
    prEnrichmentCount: cap(caps.prEnrichmentCount, DEFAULT_CAPS.prEnrichmentCount, MAX_CAPS.prEnrichmentCount),
    subprocessTimeoutMs: positiveCap(caps.subprocessTimeoutMs, DEFAULT_CAPS.subprocessTimeoutMs, MAX_CAPS.subprocessTimeoutMs),
  };
}

function toShippedCaps(caps: BacklogCurationGitDeltaCaps): Partial<ShippedEvidenceCaps> {
  return normalizeShippedEvidenceCaps({ gitCommitScanCount: caps.commitScanCount, changedPathCount: caps.changedPathCount, excerptCount: caps.excerptCount, excerptBytes: caps.excerptBytes, prEnrichmentCount: caps.prEnrichmentCount, subprocessTimeoutMs: caps.subprocessTimeoutMs });
}

function hasPrimaryRangeScanFailure(diagnostics: readonly ShippedEvidenceDiagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.code === 'gitUnavailable' || (diagnostic.code === 'gitCommandFailed' && diagnostic.message === 'Unable to read reachable git log.'));
}

function mapShippedDiagnostics(diagnostics: readonly ShippedEvidenceDiagnostic[]): BacklogCurationGitDeltaDiagnostic[] {
  return diagnostics.map((diagnostic) => ({ code: mapShippedDiagnosticCode(diagnostic), severity: 'warning', message: diagnostic.message, detail: diagnostic.detail }));
}

function mapShippedDiagnosticCode(diagnostic: ShippedEvidenceDiagnostic): BacklogCurationGitDeltaDiagnostic['code'] {
  if (diagnostic.code === 'capExceeded') return diagnostic.message.startsWith('Changed paths capped') ? 'changed-path-cap-truncated' : 'scan-cap-truncated';
  if (diagnostic.code === 'gitUnavailable') return 'git-unavailable';
  return 'git-command-failed';
}

function mapPrDiagnostic(diagnostic: ShippedEvidenceDiagnostic): BacklogCurationGitDeltaDiagnostic {
  return { code: diagnostic.code === 'capExceeded' ? 'pr-cap-truncated' : 'pr-enrichment-unavailable', severity: 'warning', message: diagnostic.message, detail: diagnostic.detail };
}

function cap(value: unknown, fallback: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.min(Math.floor(value), max) : fallback;
}

function positiveCap(value: unknown, fallback: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), max) : fallback;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error('Backlog curation git-delta collection was aborted.');
}

void canonicalJson;
