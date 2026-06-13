import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import type { ShippedEvidenceCaps, ShippedEvidenceDiagnostic, ShippedEvidencePrMetadata } from './shipped-evidence-types.js';
import { boundChangedPaths, boundString, normalizeShippedEvidenceCaps } from './shipped-evidence-limits.js';

const execFile = promisify(execFileCallback);

export interface PullRequestEnrichmentResult {
  pullRequests: ShippedEvidencePrMetadata[];
  diagnostics: ShippedEvidenceDiagnostic[];
}

export async function enrichPullRequests(input: {
  cwd: string;
  numbers: readonly number[];
  caps?: Partial<ShippedEvidenceCaps>;
  signal?: AbortSignal;
}): Promise<PullRequestEnrichmentResult> {
  const caps = normalizeShippedEvidenceCaps(input.caps);
  const numbers = [...new Set(input.numbers)].slice(0, caps.prEnrichmentCount);
  const diagnostics: ShippedEvidenceDiagnostic[] = [];
  if (input.numbers.length > numbers.length) {
    diagnostics.push({ code: 'capExceeded', message: `PR enrichment capped at ${caps.prEnrichmentCount} pull requests.` });
  }
  const pullRequests: ShippedEvidencePrMetadata[] = [];
  for (const number of numbers) {
    throwIfAborted(input.signal);
    const result = await viewPullRequest(input.cwd, number, caps, input.signal);
    if (result.ok) pullRequests.push(result.pr);
    else diagnostics.push(result.diagnostic);
    if (diagnostics.length >= caps.diagnosticCount) break;
  }
  return { pullRequests, diagnostics: diagnostics.slice(0, caps.diagnosticCount) };
}

export async function readGitHubRemote(cwd: string, caps: Partial<ShippedEvidenceCaps> = {}, signal?: AbortSignal): Promise<{ owner: string; repo: string } | undefined> {
  const limits = normalizeShippedEvidenceCaps(caps);
  try {
    throwIfAborted(signal);
    const { stdout } = await execFile('git', ['remote', 'get-url', 'origin'], { cwd, timeout: limits.subprocessTimeoutMs, signal });
    return parseGitHubRemote(String(stdout).trim());
  } catch {
    throwIfAborted(signal);
    return undefined;
  }
}

export function parseGitHubRemote(value: string): { owner: string; repo: string } | undefined {
  const ssh = /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/.exec(value);
  if (ssh) return { owner: ssh[1], repo: stripGitSuffix(ssh[2]) };
  try {
    const url = new URL(value);
    if (url.hostname !== 'github.com') return undefined;
    const [owner, repo] = url.pathname.replace(/^\/+/, '').split('/');
    if (!owner || !repo) return undefined;
    return { owner, repo: stripGitSuffix(repo) };
  } catch {
    return undefined;
  }
}

async function viewPullRequest(cwd: string, number: number, caps: ShippedEvidenceCaps, signal: AbortSignal | undefined): Promise<{ ok: true; pr: ShippedEvidencePrMetadata } | { ok: false; diagnostic: ShippedEvidenceDiagnostic }> {
  try {
    const { stdout } = await execFile('gh', [
      'pr',
      'view',
      String(number),
      '--json',
      'number,title,body,url,state,mergedAt,headRefName,baseRefName,mergeCommit,files',
    ], { cwd, timeout: caps.subprocessTimeoutMs, maxBuffer: 256 * 1024, signal });
    return { ok: true, pr: normalizePullRequest(JSON.parse(String(stdout)) as Record<string, unknown>, caps) };
  } catch (error) {
    throwIfAborted(signal);
    return { ok: false, diagnostic: diagnosticFromError(number, error) };
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error('Shipped evidence PR enrichment was aborted.');
}

function normalizePullRequest(value: Record<string, unknown>, caps: ShippedEvidenceCaps): ShippedEvidencePrMetadata {
  const mergeCommit = asRecord(value.mergeCommit);
  return {
    source: 'pr-history',
    number: numberOrDefault(value.number, 0),
    title: stringOrUndefined(value.title),
    body: boundOptionalString(value.body, caps.excerptBytes * 2),
    url: stringOrUndefined(value.url),
    state: stringOrUndefined(value.state),
    mergedAt: stringOrUndefined(value.mergedAt),
    headRefName: stringOrUndefined(value.headRefName),
    baseRefName: stringOrUndefined(value.baseRefName),
    mergeCommitOid: stringOrUndefined(mergeCommit.oid),
    changedPaths: boundChangedPaths(filesToPaths(value.files), caps),
  };
}

function diagnosticFromError(number: number, error: unknown): ShippedEvidenceDiagnostic {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (lower.includes('timed out') || lower.includes('timeout')) return { code: 'prTimeout', message: `Timed out enriching PR #${number}.`, detail: message };
  if (lower.includes('enoent') || lower.includes('not found')) return { code: 'prUnavailable', message: 'GitHub CLI is unavailable for PR enrichment.', detail: message };
  if (lower.includes('authentication') || lower.includes('not logged') || lower.includes('auth')) return { code: 'prUnauthenticated', message: 'GitHub CLI is not authenticated for PR enrichment.', detail: message };
  if (lower.includes('rate limit')) return { code: 'prRateLimited', message: 'GitHub API rate limit prevented PR enrichment.', detail: message };
  return { code: 'prCommandFailed', message: `Unable to enrich PR #${number}.`, detail: message };
}

function filesToPaths(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => stringOrUndefined(asRecord(entry).path)).filter((path): path is string => path !== undefined);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function boundOptionalString(value: unknown, limit: number): string | undefined {
  const text = stringOrUndefined(value);
  return text === undefined ? undefined : boundString(text, limit);
}

function numberOrDefault(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : fallback;
}

function stripGitSuffix(value: string): string {
  return value.endsWith('.git') ? value.slice(0, -4) : value;
}
