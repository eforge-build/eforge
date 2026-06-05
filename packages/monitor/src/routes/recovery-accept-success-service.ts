/**
 * Monitor-facing service functions for the accepted-success recovery routes.
 *
 * Resolves the queue directory, effective landing action, and plan output
 * directory from project configuration, then delegates preview/apply to the
 * engine helper. Engine-level `AcceptSuccessError`s carry an HTTP status that
 * the route handlers surface directly.
 */

import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { loadConfig } from '@eforge-build/engine/config';
import {
  previewAcceptSuccess,
  applyAcceptSuccess,
  AcceptSuccessError,
  type AcceptSuccessHelperOptions,
} from '@eforge-build/engine/recovery/accept-success';
import type {
  AcceptSuccessPreviewResponse,
  AcceptSuccessRequest,
  AcceptSuccessResponse,
} from '@eforge-build/client';
import type { MonitorContext } from '../context.js';
import { HttpRouteError } from '../http/route-errors.js';
import { buildAndPersistRunUpsert } from '../recorder.js';

type FailedPrdIntent = { landingAction?: 'pr' | 'merge' | 'leave'; landingAutoMerge?: boolean };

function unquoteFrontmatterValue(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) return value.slice(1, -1);
  return value;
}

function parseFailedPrdIntent(content: string): FailedPrdIntent {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const intent: FailedPrdIntent = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kvMatch = line.match(/^(\w[\w_]*)\s*:\s*(.*)$/);
    if (!kvMatch) continue;
    const [, key, rawValue] = kvMatch;
    const value = unquoteFrontmatterValue(rawValue.trim());
    if (key === 'landing' && (value === 'pr' || value === 'merge' || value === 'leave')) intent.landingAction = value;
    if (key === 'landing_auto_merge' && (value === 'true' || value === 'false')) intent.landingAutoMerge = value === 'true';
  }
  return intent;
}

async function readFailedPrdIntent(cwd: string, queueDir: string, prdId: string): Promise<FailedPrdIntent> {
  try {
    const content = await readFile(resolve(cwd, queueDir, 'failed', `${prdId}.md`), 'utf-8');
    return parseFailedPrdIntent(content);
  } catch {
    return {};
  }
}

async function resolveHelperOptions(context: MonitorContext, prdId: string): Promise<AcceptSuccessHelperOptions> {
  if (!context.cwd) throw new HttpRouteError(503, 'Working directory not configured');
  const queueDir = context.queuePaths?.queueDir ?? resolve(context.cwd, '.eforge/queue');
  const { config } = await loadConfig(context.cwd);
  const prdIntent = await readFailedPrdIntent(context.cwd, queueDir, prdId);
  return {
    cwd: context.cwd,
    prdId,
    queueDir,
    landingAction: prdIntent.landingAction ?? config.landing.action,
    ...(prdIntent.landingAutoMerge !== undefined ? { landingAutoMerge: prdIntent.landingAutoMerge } : {}),
    prAutoMergePolicy: config.landing.pr.autoMerge,
    planOutputDir: config.plan.outputDir,
    trunkBranch: config.build.trunkBranch,
    allowLocalMergeToTrunk: config.build.allowLocalMergeToTrunk,
  };
}

function translateError(err: unknown): never {
  if (err instanceof AcceptSuccessError) throw new HttpRouteError(err.status, err.message);
  throw err;
}

export async function previewAcceptSuccessForRequest(
  context: MonitorContext,
  prdId: string,
): Promise<AcceptSuccessPreviewResponse> {
  const options = await resolveHelperOptions(context, prdId);
  try {
    return await previewAcceptSuccess(options);
  } catch (err) {
    translateError(err);
  }
}

async function readSidecarSetName(queueDir: string, prdId: string): Promise<string | undefined> {
  try {
    const raw = await readFile(join(queueDir, 'failed', `${prdId}.recovery.json`), 'utf-8');
    const parsed = JSON.parse(raw) as { summary?: { setName?: unknown } };
    return typeof parsed.summary?.setName === 'string' ? parsed.summary.setName : undefined;
  } catch {
    return undefined;
  }
}

function reconcileCompletedRun(context: MonitorContext, setName: string, completedAt: string): void {
  const run = context.db.getRuns().find((candidate) =>
    candidate.planSet === setName &&
    candidate.status === 'failed' &&
    ['build', 'resume', 'run'].includes(candidate.command)
  );
  if (!run) return;
  context.db.updateRunStatus(run.id, 'completed', completedAt);
  buildAndPersistRunUpsert(context.db, run.id, run.id);
}

async function reconcileAcceptedSuccessComplete(context: MonitorContext, options: AcceptSuccessHelperOptions, result: AcceptSuccessResponse): Promise<void> {
  if (result.applied.landing.status !== 'complete') return;
  const setName = await readSidecarSetName(options.queueDir, options.prdId);
  if (setName) reconcileCompletedRun(context, setName, result.applied.acceptedAt);
}

export async function applyAcceptSuccessForRequest(
  context: MonitorContext,
  body: AcceptSuccessRequest,
): Promise<AcceptSuccessResponse> {
  const options = await resolveHelperOptions(context, body.prdId);
  try {
    const result = await applyAcceptSuccess(options, body);
    await reconcileAcceptedSuccessComplete(context, options, result);
    return result;
  } catch (err) {
    translateError(err);
  }
}
