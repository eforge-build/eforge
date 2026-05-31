// --- eforge:region plan-01-queue-recovery-api-engine ---
import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { API_ROUTES, type QueueRecoveryAnalyzeRequest, type QueueRecoveryApplyRequest, type QueueRecoveryOperation } from '@eforge-build/client';
import { analyzeQueueRecovery, applyQueueRecovery } from '@eforge-build/engine/queue/recovery-cascade';
import type { DaemonState } from './server.js';
import type { AutoBuildQueueMutationReason } from './auto-build-supervisor.js';

interface QueueRecoveryRouteOptions {
  cwd?: string;
  queueDir?: string;
  daemonState?: DaemonState;
  sendJson(res: ServerResponse, data: unknown): void;
  sendJsonError(res: ServerResponse, status: number, error: string): void;
  rejectUnsafeMutationRequest(req: IncomingMessage, res: ServerResponse, operationLabel: string): boolean;
  notifyQueueMutation(state: DaemonState | undefined, reason: AutoBuildQueueMutationReason): void;
}

export async function handleQueueRecoveryRoutes(req: IncomingMessage, res: ServerResponse, url: string, options: QueueRecoveryRouteOptions): Promise<boolean> {
  if (req.method === 'POST' && url === API_ROUTES.queueRecoveryAnalyze) {
    const body = await parseRequestObject<QueueRecoveryAnalyzeRequest>(req, res, options); if (!body) return true;
    if (!validateSelected(body.selectedPrdId, res, options)) return true;
    if (!validateStrategy(body.strategy, res, options)) return true;
    if (!options.cwd) { options.sendJsonError(res, 503, 'Working directory not configured'); return true; }
    try { options.sendJson(res, await analyzeQueueRecovery({ cwd: options.cwd, selectedPrdId: body.selectedPrdId, strategy: body.strategy, queueDir: resolve(options.cwd, options.queueDir ?? '.eforge/queue') })); }
    catch (err) { options.sendJsonError(res, 500, err instanceof Error ? err.message : 'Failed to analyze queue recovery'); }
    return true;
  }

  if (req.method === 'POST' && url === API_ROUTES.queueRecoveryApply) {
    if (options.rejectUnsafeMutationRequest(req, res, 'Queue recovery mutations')) return true;
    if (!options.daemonState) { options.sendJsonError(res, 503, 'Daemon mode not active'); return true; }
    const body = await parseRequestObject<QueueRecoveryApplyRequest>(req, res, options); if (!body) return true;
    if (!validateSelected(body.selectedPrdId, res, options)) return true;
    if (!validateStrategy(body.strategy, res, options)) return true;
    const expectedOperations = validateExpectedOperations(body.expectedOperations, res, options); if (!expectedOperations) return true;
    if (!options.cwd) { options.sendJsonError(res, 503, 'Working directory not configured'); return true; }
    try {
      const result = await applyQueueRecovery({ cwd: options.cwd, selectedPrdId: body.selectedPrdId, strategy: body.strategy, expectedOperations, queueDir: resolve(options.cwd, options.queueDir ?? '.eforge/queue') });
      if (result.operationResults.some((op) => op.status === 'applied')) options.notifyQueueMutation(options.daemonState, 'apply-recovery');
      options.sendJson(res, result);
    } catch (err) { options.sendJsonError(res, 500, err instanceof Error ? err.message : 'Failed to apply queue recovery'); }
    return true;
  }
  return false;
}

async function parseRequestObject<T>(req: IncomingMessage, res: ServerResponse, options: QueueRecoveryRouteOptions): Promise<T | null> {
  try {
    const raw = await parseJsonBody(req);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { options.sendJsonError(res, 400, 'Invalid request body: must be a JSON object'); return null; }
    return raw as unknown as T;
  } catch (err) {
    options.sendJsonError(res, err instanceof RequestBodyTooLargeError ? 413 : 400, err instanceof RequestBodyTooLargeError ? 'Request body too large' : 'Invalid JSON body');
    return null;
  }
}

function validateSelected(selectedPrdId: unknown, res: ServerResponse, options: QueueRecoveryRouteOptions): selectedPrdId is string {
  if (!selectedPrdId || typeof selectedPrdId !== 'string') { options.sendJsonError(res, 400, 'Missing required field: selectedPrdId'); return false; }
  if (!isValidPathSegment(selectedPrdId)) { options.sendJsonError(res, 400, 'Invalid selectedPrdId: must not contain path separators or traversal sequences'); return false; }
  return true;
}

function validateStrategy(strategy: unknown, res: ServerResponse, options: QueueRecoveryRouteOptions): strategy is string | undefined {
  if (strategy !== undefined && typeof strategy !== 'string') { options.sendJsonError(res, 400, 'Invalid strategy: must be a string when present'); return false; }
  return true;
}

function validateExpectedOperations(value: unknown, res: ServerResponse, options: QueueRecoveryRouteOptions): QueueRecoveryOperation[] | null {
  if (!Array.isArray(value)) { options.sendJsonError(res, 400, 'Missing required field: expectedOperations'); return null; }
  const operations: QueueRecoveryOperation[] = [];
  for (const [index, raw] of value.entries()) {
    const errorPrefix = `Invalid expectedOperations[${index}]`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { options.sendJsonError(res, 400, `${errorPrefix}: must be an object`); return null; }
    const op = raw as Record<string, unknown>;
    if (typeof op.id !== 'string') { options.sendJsonError(res, 400, `${errorPrefix}: id must be a string`); return null; }
    if (op.kind !== 'move-prd' && op.kind !== 'remove-recovery-sidecars') { options.sendJsonError(res, 400, `${errorPrefix}: kind is invalid`); return null; }
    if (typeof op.prdId !== 'string' || !isValidPathSegment(op.prdId)) { options.sendJsonError(res, 400, `${errorPrefix}: prdId must be a safe string`); return null; }
    if (!isValidQueueRecoveryLocation(op.expectedSourceLocation)) { options.sendJsonError(res, 400, `${errorPrefix}: expectedSourceLocation is invalid`); return null; }
    if (typeof op.reason !== 'string') { options.sendJsonError(res, 400, `${errorPrefix}: reason must be a string`); return null; }
    if (op.kind === 'move-prd') {
      if (!isValidQueueRecoveryLocation(op.targetLocation)) { options.sendJsonError(res, 400, `${errorPrefix}: targetLocation is required and invalid`); return null; }
      operations.push({ id: op.id, kind: op.kind, prdId: op.prdId, expectedSourceLocation: op.expectedSourceLocation, targetLocation: op.targetLocation, reason: op.reason });
    } else {
      operations.push({ id: op.id, kind: op.kind, prdId: op.prdId, expectedSourceLocation: op.expectedSourceLocation, reason: op.reason });
    }
  }
  return operations;
}

function isValidQueueRecoveryLocation(value: unknown): value is QueueRecoveryOperation['expectedSourceLocation'] {
  return value === 'queue' || value === 'waiting' || value === 'failed' || value === 'skipped';
}

class RequestBodyTooLargeError extends Error {}

function parseJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = []; let totalSize = 0;
    req.on('data', (chunk: Buffer) => { totalSize += chunk.length; if (totalSize > 1024 * 1024) { reject(new RequestBodyTooLargeError('Request body too large')); req.destroy(); return; } chunks.push(chunk); });
    req.on('end', () => { try { const body = Buffer.concat(chunks).toString('utf-8'); resolveBody(body ? JSON.parse(body) : {}); } catch (err) { reject(err); } });
    req.on('error', reject);
  });
}

function isValidPathSegment(value: string): boolean {
  return value.length > 0 && !value.includes('/') && !value.includes('\\') && !value.includes('..') && !value.includes('\0');
}
// --- eforge:endregion plan-01-queue-recovery-api-engine ---
