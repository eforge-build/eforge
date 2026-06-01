import { join, relative, resolve } from 'node:path';
import type { ResumeEligibilityResponse } from '@eforge-build/client';
import type { MonitorContext } from '../context.js';
import { HttpRouteError } from '../http/route-errors.js';
import { isValidPathSegment } from './control-validation.js';

export async function prepareResumeBuildArgs(context: MonitorContext, body: Record<string, unknown>): Promise<string[]> {
  if (!body.prdId || typeof body.prdId !== 'string') throw new HttpRouteError(400, 'Missing required field: prdId');
  if (!isValidPathSegment(body.prdId)) throw new HttpRouteError(400, 'Invalid prdId: must not contain path separators or traversal sequences');
  if (body.setName !== undefined && (typeof body.setName !== 'string' || !isValidPathSegment(body.setName))) {
    throw new HttpRouteError(400, 'Invalid setName: must not contain path separators or traversal sequences');
  }
  let profileName: string | undefined;
  if (body.profile !== undefined) {
    if (typeof body.profile !== 'string' || body.profile.trim().length === 0) throw new HttpRouteError(400, 'Invalid field: profile must be a non-empty string');
    if (!context.cwd) throw new HttpRouteError(503, 'No working directory configured');
    profileName = body.profile;
    try {
      const { getConfigDir, getConventionalConfigDir, loadProfile } = await import('@eforge-build/engine/config');
      const configDir = (await getConfigDir(context.cwd)) ?? getConventionalConfigDir(context.cwd);
      const profileResult = await loadProfile(configDir, profileName, context.cwd);
      if (!profileResult) throw new HttpRouteError(400, `Profile '${profileName}' not found`);
    } catch (err) {
      if (err instanceof HttpRouteError) throw err;
      throw new HttpRouteError(400, `Invalid profile '${profileName}': ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const args = [body.prdId];
  if (body.setName) args.push('--set-name', body.setName);
  if (profileName) args.push('--profile', profileName);
  return args;
}

export async function buildResumeEligibility(context: MonitorContext, prdId: string, setNameParam: string | null): Promise<ResumeEligibilityResponse> {
  if (!context.cwd) throw new HttpRouteError(503, 'No working directory configured');
  const cwd = context.cwd;
  const { projectResumeEligibility, resolveResumeSetName } = await import('@eforge-build/engine/resume/compiled-build');
  const { computeWorktreeBase } = await import('@eforge-build/engine/worktree-ops');
  const prdQueueDir = context.options.config?.prdQueue?.dir ?? context.options.queueDir ?? '.eforge/queue';
  const failedDir = resolve(cwd, prdQueueDir, 'failed');
  const setName = setNameParam ?? (await resolveResumeSetName({ prdId, failedDir }));
  if (!isValidPathSegment(setName)) throw new HttpRouteError(400, 'Resolved setName is invalid: must not contain path separators or traversal sequences');
  const projection = await projectResumeEligibility({
    cwd,
    setName,
    prdId,
    mergeWorktreePath: join(computeWorktreeBase(cwd, setName), '__merge__'),
    outputDir: context.options.config?.plan?.outputDir ?? context.options.planOutputDir ?? 'eforge/plans',
    dbPath: resolve(cwd, '.eforge', 'monitor.db'),
    trunkBranch: context.options.config?.build?.trunkBranch,
  });
  if (!projection.eligible) {
    return { eligible: false, prdId, setName, featureBranch: projection.featureBranch, reason: projection.reason, ...(projection.checkedPath !== undefined ? { checkedPath: relative(cwd, projection.checkedPath) } : {}) };
  }
  return {
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
  };
}
