import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseWithSchema } from '@eforge-build/client';
import type { RecoveryVerdictSidecar } from '@eforge-build/client';
import { recoveryVerdictSchema } from '@eforge-build/engine/schemas';
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
  try { return { markdown, json: JSON.parse(jsonContent) as RecoveryVerdictSidecar }; }
  catch { throw new HttpRouteError(500, `Recovery sidecar JSON is malformed for prdId: ${prdId}`); }
}

export async function readRecoveryVerdictForApply(context: MonitorContext, prdId: string): Promise<ReturnType<typeof recoveryVerdictSchema.parse>> {
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
  try { return parseWithSchema(recoveryVerdictSchema, (sidecarJson as Record<string, unknown>).verdict); }
  catch (err) { throw new HttpRouteError(400, `Invalid recovery verdict in sidecar for ${prdId}: ${err instanceof Error ? err.message : String(err)}`); }
}
