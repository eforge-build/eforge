import type { IncomingMessage, ServerResponse } from 'node:http';
import { join, relative, resolve } from 'node:path';
import { API_ROUTES } from '@eforge-build/client';
import type { EforgeConfig } from '@eforge-build/engine/config';
import { projectResumeEligibility, resolveResumeSetName } from '@eforge-build/engine/resume/compiled-build';
import { computeWorktreeBase } from '@eforge-build/engine/worktree-ops';

interface ResumeEligibilityRouteOptions {
  cwd?: string;
  queueDir?: string;
  planOutputDir?: string;
  config?: Pick<EforgeConfig, 'prdQueue' | 'plan' | 'build'>;
  sendJson(res: ServerResponse, data: unknown): void;
  sendJsonError(res: ServerResponse, status: number, error: string): void;
  rejectUnsafeRequest(req: IncomingMessage, res: ServerResponse, operationLabel: string): boolean;
  rejectCrossSiteBrowserRequest(req: IncomingMessage, res: ServerResponse, operationLabel: string): boolean;
}

export async function handleResumeEligibilityRoute(
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
  options: ResumeEligibilityRouteOptions,
): Promise<boolean> {
  if (!isResumeEligibilityRequest(req, url)) return false;

  if (options.rejectUnsafeRequest(req, res, 'Resume eligibility checks')) return true;
  if (options.rejectCrossSiteBrowserRequest(req, res, 'Resume eligibility checks')) return true;
  if (!options.cwd) {
    options.sendJsonError(res, 503, 'No working directory configured');
    return true;
  }

  const params = parseQuery(url);
  const prdId = params.get('prdId');
  if (!validatePrdId(prdId, res, options)) return true;

  const setNameParam = params.get('setName');
  if (setNameParam !== null && !isValidPathSegment(setNameParam)) {
    options.sendJsonError(res, 400, 'Invalid setName: must not contain path separators or traversal sequences');
    return true;
  }

  try {
    await sendResumeEligibility({ prdId, setNameParam, options, res });
  } catch (err) {
    options.sendJsonError(res, 500, err instanceof Error ? err.message : 'Failed to check resume eligibility');
  }
  return true;
}

function isResumeEligibilityRequest(req: IncomingMessage, url: string): boolean {
  return req.method === 'GET' && (url === API_ROUTES.resumeEligibility || url.startsWith(`${API_ROUTES.resumeEligibility}?`));
}

function parseQuery(url: string): URLSearchParams {
  return new URLSearchParams(url.includes('?') ? url.slice(url.indexOf('?') + 1) : '');
}

function validatePrdId(
  prdId: string | null,
  res: ServerResponse,
  options: ResumeEligibilityRouteOptions,
): prdId is string {
  if (!prdId) {
    options.sendJsonError(res, 400, 'Missing required query param: prdId');
    return false;
  }
  if (!isValidPathSegment(prdId)) {
    options.sendJsonError(res, 400, 'Invalid prdId: must not contain path separators or traversal sequences');
    return false;
  }
  return true;
}

async function sendResumeEligibility(args: {
  prdId: string;
  setNameParam: string | null;
  options: ResumeEligibilityRouteOptions;
  res: ServerResponse;
}): Promise<void> {
  const { prdId, setNameParam, options, res } = args;
  const cwd = options.cwd!;
  const prdQueueDir = options.config?.prdQueue?.dir ?? options.queueDir ?? '.eforge/queue';
  const failedDir = resolve(cwd, prdQueueDir, 'failed');
  const setName = setNameParam ?? (await resolveResumeSetName({ prdId, failedDir }));
  if (!isValidPathSegment(setName)) {
    options.sendJsonError(res, 400, 'Resolved setName is invalid: must not contain path separators or traversal sequences');
    return;
  }

  const projection = await projectResumeEligibility({
    cwd,
    setName,
    prdId,
    mergeWorktreePath: join(computeWorktreeBase(cwd, setName), '__merge__'),
    outputDir: options.config?.plan?.outputDir ?? options.planOutputDir ?? 'eforge/plans',
    dbPath: resolve(cwd, '.eforge', 'monitor.db'),
    trunkBranch: options.config?.build?.trunkBranch,
  });

  if (!projection.eligible) {
    options.sendJson(res, {
      eligible: false,
      prdId,
      setName,
      featureBranch: projection.featureBranch,
      reason: projection.reason,
      ...(projection.checkedPath !== undefined ? { checkedPath: relative(cwd, projection.checkedPath) } : {}),
    });
    return;
  }

  options.sendJson(res, {
    eligible: true,
    prdId,
    setName,
    featureBranch: projection.featureBranch,
    artifactAvailability: projection.artifactAvailability,
    ...(projection.artifactCommit !== undefined ? { artifactCommit: projection.artifactCommit } : {}),
    landedCommitCount: projection.landedCommitCount,
    diffStat: projection.diffStat,
    ...(projection.failingPlanId !== undefined ? { failingPlanId: projection.failingPlanId } : {}),
    ...(projection.partial !== undefined ? { partial: projection.partial } : {}),
  });
}

function isValidPathSegment(value: string): boolean {
  return value.length > 0 && !value.includes('/') && !value.includes('\\') && !value.includes('..') && !value.includes('\0');
}
