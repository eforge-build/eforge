/**
 * Monitor-facing service functions for the accepted-success recovery routes.
 *
 * Resolves the queue directory, effective landing action, and plan output
 * directory from project configuration, then delegates preview/apply to the
 * engine helper. Engine-level `AcceptSuccessError`s carry an HTTP status that
 * the route handlers surface directly.
 */

import { resolve } from 'node:path';
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

async function resolveHelperOptions(context: MonitorContext, prdId: string): Promise<AcceptSuccessHelperOptions> {
  if (!context.cwd) throw new HttpRouteError(503, 'Working directory not configured');
  const queueDir = context.queuePaths?.queueDir ?? resolve(context.cwd, '.eforge/queue');
  const { config } = await loadConfig(context.cwd);
  return {
    cwd: context.cwd,
    prdId,
    queueDir,
    landingAction: config.landing.action,
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

export async function applyAcceptSuccessForRequest(
  context: MonitorContext,
  body: AcceptSuccessRequest,
): Promise<AcceptSuccessResponse> {
  const options = await resolveHelperOptions(context, body.prdId);
  try {
    return await applyAcceptSuccess(options, body);
  } catch (err) {
    translateError(err);
  }
}
