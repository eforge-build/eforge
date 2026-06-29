import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { type BuildFailureSummary, type RecoveryVerdict, type RecoveryVerdictSidecar } from '@eforge-build/client';
import { parseRecoveryAppliedMetadata, parseAcceptSuccessAppliedMetadata } from '@eforge-build/engine/recovery/applied-sidecar';
import { parseRecoverySidecarPayload } from '@eforge-build/engine/recovery/sidecar-read';
import type { MonitorContext } from '../context.js';
import { HttpRouteError } from '../http/route-errors.js';
import { isWithinDir } from './control-validation.js';

function failedDir(context: MonitorContext): string {
  if (context.queuePaths) return context.queuePaths.failedDir;
  if (!context.cwd) throw new HttpRouteError(503, 'Working directory not configured');
  return resolve(context.cwd, context.options.config?.prdQueue?.dir ?? context.options.queueDir ?? '.eforge/queue', 'failed');
}

export async function readRecoverySidecar(context: MonitorContext, prdId: string): Promise<{ markdown: string; json: RecoveryVerdictSidecar }> {
  const base = failedDir(context);
  const mdPath = resolve(base, `${prdId}.recovery.md`);
  const jsonPath = resolve(base, `${prdId}.recovery.json`);
  if (!isWithinDir(mdPath, base) || !isWithinDir(jsonPath, base)) throw new HttpRouteError(400, 'Invalid prdId: resolved path escapes failed PRD directory');
  let markdown: string;
  let jsonContent: string;
  try { [markdown, jsonContent] = await Promise.all([readFile(mdPath, 'utf-8'), readFile(jsonPath, 'utf-8')]); }
  catch { throw new HttpRouteError(404, 'Recovery sidecar not found'); }
  return { markdown, json: parseRecoverySidecar(jsonContent, prdId, 500) };
}

function parseRecoverySidecar(jsonContent: string, prdId: string, statusForInvalid: 400 | 500): RecoveryVerdictSidecar {
  let raw: unknown;
  try { raw = JSON.parse(jsonContent); }
  catch { throw new HttpRouteError(statusForInvalid, `Recovery sidecar JSON is malformed for prdId: ${prdId}`); }
  try {
    const parsed = parseRecoverySidecarPayload(JSON.stringify(raw), prdId);
    const applied = parseAppliedMarker(parsed.applied);
    const { applied: _applied, ...withoutApplied } = parsed;
    return { ...withoutApplied, ...(applied !== undefined ? { applied } : {}) };
  } catch (err) {
    const version = typeof (raw as { schemaVersion?: unknown })?.schemaVersion === 'number' ? ` schemaVersion ${(raw as { schemaVersion: number }).schemaVersion}` : '';
    throw new HttpRouteError(statusForInvalid, `Supported recovery sidecar contract is invalid${version} for prdId: ${prdId}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function parseAppliedMarker(value: unknown): RecoveryVerdictSidecar['applied'] | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null) throw new Error('Recovery sidecar applied marker is invalid');
  const appliedObj = value as Record<string, unknown>;
  const acceptApplied = parseAcceptSuccessAppliedMetadata(appliedObj);
  if (acceptApplied !== undefined) return mergeForwardCompatible(appliedObj, acceptApplied, ['action', 'acceptedAt', 'reasonCategory', 'reason', 'cleanup', 'landing', 'dependents']) as unknown as RecoveryVerdictSidecar['applied'];
  const parsedApplied = parseRecoveryAppliedMetadata(appliedObj);
  if (parsedApplied !== undefined) return mergeForwardCompatible(appliedObj, parsedApplied, ['action', 'appliedAt', 'commitSha']) as unknown as RecoveryVerdictSidecar['applied'];
  throw new Error('Recovery sidecar applied marker is invalid');
}

function mergeForwardCompatible<T>(raw: Record<string, unknown>, parsed: T, knownFields: string[]): T & Record<string, unknown> {
  const known = new Set(knownFields);
  const forwardCompat: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) if (!known.has(key)) forwardCompat[key] = value;
  return { ...forwardCompat, ...(parsed as Record<string, unknown>) } as T & Record<string, unknown>;
}

function projectSummary(sidecar: RecoveryVerdictSidecar): BuildFailureSummary {
  const evidence = sidecar.boundedEvidence;
  return {
    prdId: evidence.identity.prdId,
    setName: evidence.identity.setName,
    featureBranch: evidence.identity.featureBranch,
    baseBranch: evidence.identity.baseBranch,
    plans: evidence.plans,
    failingPlan: evidence.failingPlan,
    landedCommits: evidence.landedCommits,
    diffStat: evidence.diffStat ?? '',
    modelsUsed: evidence.modelsUsed,
    failedAt: evidence.identity.failedAt,
    ...(evidence.identity.partial !== undefined ? { partial: evidence.identity.partial } : {}),
    ...(evidence.failingPlans !== undefined ? { failingPlans: evidence.failingPlans } : {}),
    ...(evidence.terminalFailure !== undefined ? { terminalFailure: evidence.terminalFailure as BuildFailureSummary['terminalFailure'] } : {}),
    ...(evidence.acceptanceValidation !== undefined ? { acceptanceValidation: evidence.acceptanceValidation as BuildFailureSummary['acceptanceValidation'] } : {}),
    ...(evidence.validationCommands !== undefined ? { validationCommands: evidence.validationCommands.map((command) => ({ command: command.command, exitCode: command.exitCode, ...(command.outputPreview !== undefined ? { output: command.outputPreview } : {}) })) } : {}),
    ...(evidence.landing !== undefined ? { landing: evidence.landing } : {}),
    ...(evidence.reviewFailure !== undefined ? { reviewFailure: evidence.reviewFailure as BuildFailureSummary['reviewFailure'] } : {}),
  };
}

export interface RecoveryApplySidecarData {
  summary: BuildFailureSummary;
  verdict: RecoveryVerdict;
}

export async function readRecoveryVerdictForApply(context: MonitorContext, prdId: string): Promise<RecoveryApplySidecarData> {
  const base = failedDir(context);
  const sidecarJsonPath = resolve(base, `${prdId}.recovery.json`);
  if (!isWithinDir(sidecarJsonPath, base)) throw new HttpRouteError(400, 'Invalid prdId: resolved path escapes failed PRD directory');
  let sidecarRaw: string;
  try { sidecarRaw = await readFile(sidecarJsonPath, 'utf-8'); }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new HttpRouteError(404, `No recovery sidecar found for ${prdId}`);
    throw new HttpRouteError(400, `Failed to read recovery sidecar for ${prdId}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const sidecar = parseRecoverySidecar(sidecarRaw, prdId, 400);
  return { summary: projectSummary(sidecar), verdict: sidecar.verdict };
}
