import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseWithSchema, safeParseEforgeEvent } from '@eforge-build/client';
import type { BuildFailureSummary, RecoveryVerdict, RecoveryVerdictSidecar } from '@eforge-build/client';
import { recoveryVerdictSchema } from '@eforge-build/engine/schemas';
import { parseRecoveryAppliedMetadata } from '@eforge-build/engine/recovery/applied-sidecar';
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
  return { markdown, json: parseRecoverySidecar(jsonContent, prdId) };
}

function parseRecoverySidecar(jsonContent: string, prdId: string): RecoveryVerdictSidecar {
  let parsed: unknown;
  try { parsed = JSON.parse(jsonContent); }
  catch { throw new HttpRouteError(500, `Recovery sidecar JSON is malformed for prdId: ${prdId}`); }
  if (typeof parsed !== 'object' || parsed === null) throw new HttpRouteError(500, `Recovery sidecar JSON is invalid for prdId: ${prdId}`);
  const sidecar = parsed as Record<string, unknown>;
  if (typeof sidecar.schemaVersion !== 'number' || typeof sidecar.generatedAt !== 'string') throw new HttpRouteError(500, `Recovery sidecar JSON is invalid for prdId: ${prdId}`);
  const summary = safeParseEforgeEvent({ type: 'recovery:summary', timestamp: sidecar.generatedAt, prdId, summary: sidecar.summary });
  if (!summary.success) throw new HttpRouteError(500, `Recovery sidecar summary is invalid for prdId: ${prdId}`);
  const verdict = safeParseEforgeEvent({ type: 'recovery:complete', timestamp: sidecar.generatedAt, prdId, verdict: sidecar.verdict });
  if (!verdict.success) throw new HttpRouteError(500, `Recovery sidecar verdict is invalid for prdId: ${prdId}`);
  const result = { schemaVersion: sidecar.schemaVersion, generatedAt: sidecar.generatedAt, summary: sidecar.summary, verdict: sidecar.verdict } as RecoveryVerdictSidecar;
  // Preserve the optional durable applied marker only when its required metadata
  // fields (action literal, appliedAt, and split-specific successorPrdId) are
  // valid. Validate and normalize via the shared parser so contract-invalid known
  // fields (e.g. `commitSha: 123`, or `successorPrdId` on a non-split marker)
  // never reach the wire. Forward-compatible unknown keys are copied through, but
  // the validated known fields always overlay them. Legacy sidecars without the
  // marker parse unchanged, and a malformed marker is omitted entirely.
  if (typeof sidecar.applied === 'object' && sidecar.applied !== null) {
    const parsedApplied = parseRecoveryAppliedMetadata(sidecar.applied);
    if (parsedApplied !== undefined) {
      const KNOWN_APPLIED_FIELDS = new Set(['action', 'appliedAt', 'successorPrdId', 'commitSha']);
      const forwardCompat: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(sidecar.applied as Record<string, unknown>)) {
        if (!KNOWN_APPLIED_FIELDS.has(key)) forwardCompat[key] = value;
      }
      result.applied = { ...forwardCompat, ...parsedApplied } as RecoveryVerdictSidecar['applied'];
    }
  }
  return result;
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
  let sidecarJson: unknown;
  try { sidecarJson = JSON.parse(sidecarRaw); }
  catch { throw new HttpRouteError(400, `Malformed recovery sidecar JSON for ${prdId}`); }
  if (typeof sidecarJson !== 'object' || sidecarJson === null || !('verdict' in sidecarJson)) {
    throw new HttpRouteError(400, `Recovery sidecar for ${prdId} is missing the verdict field`);
  }
  const sidecar = sidecarJson as Record<string, unknown>;
  const generatedAt = typeof sidecar.generatedAt === 'string' ? sidecar.generatedAt : new Date().toISOString();
  const summary = safeParseEforgeEvent({ type: 'recovery:summary', timestamp: generatedAt, prdId, summary: sidecar.summary });
  if (!summary.success) throw new HttpRouteError(400, `Invalid recovery summary in sidecar for ${prdId}`);
  try {
    return {
      summary: sidecar.summary as BuildFailureSummary,
      verdict: parseWithSchema(recoveryVerdictSchema, sidecar.verdict) as RecoveryVerdict,
    };
  }
  catch (err) { throw new HttpRouteError(400, `Invalid recovery verdict in sidecar for ${prdId}: ${err instanceof Error ? err.message : String(err)}`); }
}
