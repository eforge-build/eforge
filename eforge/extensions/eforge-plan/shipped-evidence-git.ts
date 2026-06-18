import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import type { GitHistoryCollection, GitHistoryRangeInput, GitHistoryRecord, ShippedEvidenceCaps, ShippedEvidenceDiagnostic, ShippedEvidenceExcerpt } from './shipped-evidence-types.js';
import { tokenizeTitle } from './shipped-evidence-matching.js';
import { boundChangedPaths, boundString, normalizeShippedEvidenceCaps } from './shipped-evidence-limits.js';

const execFile = promisify(execFileCallback);
const LOG_SEPARATOR = '\x1e';
const FIELD_SEPARATOR = '\x1f';

export async function collectGitHistoryRecords(cwd: string, caps: Partial<ShippedEvidenceCaps> = {}, signal?: AbortSignal): Promise<GitHistoryCollection> {
  const limits = normalizeShippedEvidenceCaps(caps);
  const collection = await collectGitHistoryRecordsForRange(cwd, {}, caps, signal);
  if (collection.records.length >= limits.gitCommitScanCount) {
    const capDiagnostic: ShippedEvidenceDiagnostic = { code: 'capExceeded', message: `Git history scan capped at ${limits.gitCommitScanCount} commits.` };
    return { records: collection.records, diagnostics: [...collection.diagnostics, capDiagnostic].slice(0, limits.diagnosticCount) };
  }
  return collection;
}

export async function collectGitHistoryRecordsForRange(cwd: string, range: GitHistoryRangeInput = {}, caps: Partial<ShippedEvidenceCaps> = {}, signal?: AbortSignal): Promise<GitHistoryCollection> {
  const limits = normalizeShippedEvidenceCaps(caps);
  const diagnostics: ShippedEvidenceDiagnostic[] = [];
  throwIfAborted(signal);
  const inside = await runGit(cwd, ['rev-parse', '--is-inside-work-tree'], limits, undefined, signal);
  if (!inside.ok) {
    return { records: [], diagnostics: [{ code: 'gitUnavailable', message: 'Git history is unavailable for shipped-evidence collection.', detail: inside.detail }] };
  }
  if (inside.stdout.trim() !== 'true') {
    return { records: [], diagnostics: [{ code: 'gitUnavailable', message: 'Git history is unavailable for shipped-evidence collection.' }] };
  }

  const maxCount = normalizeRangeMaxCount(range.maxCount, limits.gitCommitScanCount, range.allowOverflowProbe === true);
  if (maxCount === 0) return { records: [], diagnostics: [] };
  throwIfAborted(signal);
  const revisionArgs = range.revisionRange === undefined ? [] : [range.revisionRange];
  const log = await runGit(cwd, [
    'log',
    '--date-order',
    `--max-count=${maxCount}`,
    `--format=${LOG_SEPARATOR}%H${FIELD_SEPARATOR}%h${FIELD_SEPARATOR}%P${FIELD_SEPARATOR}%cI${FIELD_SEPARATOR}%s${FIELD_SEPARATOR}%b`,
    ...revisionArgs,
  ], limits, undefined, signal);
  if (!log.ok) {
    return { records: [], diagnostics: [{ code: 'gitCommandFailed', message: 'Unable to read reachable git log.', detail: log.detail }] };
  }

  const records: GitHistoryRecord[] = [];
  for (const entry of log.stdout.split(LOG_SEPARATOR).map((value) => value.trim()).filter(Boolean)) {
    throwIfAborted(signal);
    const [hash, shortHash, parentsText, committedAt, subject, ...bodyParts] = entry.split(FIELD_SEPARATOR);
    if (!hash || !shortHash || !subject) continue;
    const body = bodyParts.join(FIELD_SEPARATOR).trim();
    const parents = (parentsText ?? '').split(/\s+/).filter(Boolean);
    const changedPaths = await collectChangedPaths(cwd, hash, limits, diagnostics, signal);
    const text = `${subject}\n${body}`;
    records.push({
      source: 'git-history',
      hash,
      shortHash,
      subject,
      ...(body.length > 0 && { body }),
      ...(committedAt && { committedAt }),
      parents,
      isMerge: parents.length > 1,
      prNumbers: extractPullRequestNumbers(text),
      branchHints: extractBranchHints(text).slice(0, limits.branchHintCount),
      changedPaths,
    });
  }
  return { records, diagnostics: diagnostics.slice(0, limits.diagnosticCount) };
}

export async function collectGitFileExcerpts(input: {
  cwd: string;
  record: GitHistoryRecord;
  queryText: string;
  caps?: Partial<ShippedEvidenceCaps>;
  diagnostics?: ShippedEvidenceDiagnostic[];
  signal?: AbortSignal;
}): Promise<ShippedEvidenceExcerpt[]> {
  const limits = normalizeShippedEvidenceCaps(input.caps);
  const tokens = tokenizeTitle(input.queryText);
  if (tokens.length === 0) return [];
  const excerpts: ShippedEvidenceExcerpt[] = [];
  for (const path of input.record.changedPaths.slice(0, limits.changedPathCount)) {
    throwIfAborted(input.signal);
    if (excerpts.length >= limits.excerptCount) break;
    if (isSensitivePath(path)) continue;
    const shown = await runGit(input.cwd, ['show', `${input.record.hash}:${path}`], limits, Math.max(64 * 1024, limits.excerptBytes * 16), input.signal);
    if (!shown.ok) {
      const code = shown.detail.toLowerCase().includes('maxbuffer') ? 'gitOutputTruncated' : 'gitCommandFailed';
      input.diagnostics?.push({ code, message: `Unable to read excerpt for ${input.record.shortHash}:${path}.`, detail: shown.detail });
      continue;
    }
    const excerpt = redactSecretLikeText(excerptMatchingLines(shown.stdout, tokens, limits.excerptBytes));
    if (excerpt.length > 0) {
      excerpts.push({ evidenceSource: 'git-history', path, commit: input.record.shortHash, text: boundString(excerpt, limits.excerptBytes) });
    }
  }
  return excerpts;
}

export function extractPullRequestNumbers(text: string): number[] {
  const values = [...text.matchAll(/(?:pull request|pr)\s*#?(\d{1,8})/gi)].map((match) => Number(match[1]));
  return [...new Set(values.filter((value) => Number.isSafeInteger(value) && value > 0))];
}

export function extractBranchHints(text: string): string[] {
  const hints = [
    ...[...text.matchAll(/from\s+([A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+)/gi)].map((match) => match[1]),
    ...[...text.matchAll(/(?:branch|head|source)[:\s]+([A-Za-z0-9_./-]+)/gi)].map((match) => match[1]),
  ];
  return [...new Set(hints.filter((hint) => hint.length > 0))].sort();
}

async function collectChangedPaths(cwd: string, hash: string, caps: ShippedEvidenceCaps, diagnostics: ShippedEvidenceDiagnostic[], signal: AbortSignal | undefined): Promise<string[]> {
  throwIfAborted(signal);
  const result = await runGit(cwd, ['diff-tree', '--no-commit-id', '--name-only', '-r', '-m', hash], caps, undefined, signal);
  if (!result.ok) {
    diagnostics.push({ code: 'gitCommandFailed', message: `Unable to read changed paths for ${hash.slice(0, 12)}.`, detail: result.detail });
    return [];
  }
  const paths = [...new Set(result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))];
  const bounded = boundChangedPaths(paths, caps);
  if (paths.length > bounded.length) diagnostics.push({ code: 'capExceeded', message: `Changed paths capped for ${hash.slice(0, 12)}.` });
  return bounded;
}

async function runGit(cwd: string, args: readonly string[], caps: ShippedEvidenceCaps, maxBuffer = 1024 * 1024, signal?: AbortSignal): Promise<{ ok: true; stdout: string } | { ok: false; detail: string }> {
  try {
    throwIfAborted(signal);
    const { stdout, stderr } = await execFile('git', [...args], { cwd, timeout: caps.subprocessTimeoutMs, maxBuffer, signal });
    return { ok: true, stdout: `${stdout}` || `${stderr}` };
  } catch (error) {
    throwIfAborted(signal);
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

function normalizeRangeMaxCount(value: unknown, limit: number, allowOverflowProbe: boolean): number {
  const fallback = limit;
  const requested = typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
  const bounded = Math.min(requested, limit);
  return bounded === 0 ? 0 : bounded + (allowOverflowProbe ? 1 : 0);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error('Shipped evidence git collection was aborted.');
}

function excerptMatchingLines(text: string, tokens: readonly string[], limit: number): string {
  const normalizedTokens = new Set(tokens.map((token) => token.toLowerCase()));
  const lines = text.split(/\r?\n/).filter((line) => {
    const lower = line.toLowerCase();
    return [...normalizedTokens].some((token) => lower.includes(token));
  });
  const compact = lines.slice(0, 4).map((line) => line.trim()).filter(Boolean).join('\n');
  return boundString(compact, limit);
}

function isSensitivePath(path: string): boolean {
  const lower = path.toLowerCase();
  return /(^|\/)(\.env|\.npmrc|\.pypirc|id_rsa|id_dsa|id_ecdsa|id_ed25519|credentials?|secrets?)(\.|$|\/)/.test(lower)
    || /\.(pem|key|p12|pfx|crt|cer|env)$/i.test(path);
}

function redactSecretLikeText(text: string): string {
  return text
    .replace(/-----BEGIN [^-]+PRIVATE KEY-----[\s\S]*?-----END [^-]+PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]')
    .replace(/\b(AKIA|ASIA)[A-Z0-9]{16}\b/g, '[REDACTED TOKEN]')
    .replace(/\b(secret|token|api[_-]?key|password|passwd|authorization)\b\s*[:=]\s*[^\s'\"]+/gi, '$1=[REDACTED]');
}
