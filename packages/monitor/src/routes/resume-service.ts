import { join, relative, resolve } from 'node:path';
import type { ResumeBuildResponse, ResumeEligibilityResponse } from '@eforge-build/client';
import type { MonitorContext } from '../context.js';
import { HttpRouteError } from '../http/route-errors.js';
import { isValidPathSegment } from './control-validation.js';

export async function queueResumeBuild(context: MonitorContext, body: Record<string, unknown>): Promise<ResumeBuildResponse> {
  if (!context.cwd) throw new HttpRouteError(503, 'No working directory configured');
  if (!body.prdId || typeof body.prdId !== 'string') throw new HttpRouteError(400, 'Missing required field: prdId');
  if (!isValidPathSegment(body.prdId)) throw new HttpRouteError(400, 'Invalid prdId: must not contain path separators or traversal sequences');
  if (body.setName !== undefined && (typeof body.setName !== 'string' || !isValidPathSegment(body.setName))) {
    throw new HttpRouteError(400, 'Invalid setName: must not contain path separators or traversal sequences');
  }
  if (typeof body.setName === 'string') await validateResumeSetName(body.setName);

  const prdId = body.prdId;
  const setName = body.setName as string | undefined;
  const profileName = await validateExplicitProfile(context, body.profile);
  const cwd = context.cwd;
  const queueDir = context.options.config?.prdQueue?.dir ?? context.options.queueDir ?? '.eforge/queue';
  const trunkBranch = context.options.config?.build?.trunkBranch;
  const { prepareFailedPrdForQueuedCompiledResume } = await import('@eforge-build/engine/resume/compiled-build');
  const result = await mapResumeMetadataValidation(async () => prepareFailedPrdForQueuedCompiledResume({
    cwd,
    prdId,
    ...(setName !== undefined ? { setName } : {}),
    queueDir,
    outputDir: context.options.config?.plan?.outputDir ?? context.options.planOutputDir ?? 'eforge/plans',
    dbPath: resolve(cwd, '.eforge', 'monitor.db'),
    ...(trunkBranch !== undefined ? { trunkBranch } : {}),
    ...(profileName !== undefined ? { profileOverride: profileName } : {}),
  }));

  if (result.status === 'blocked') throw new HttpRouteError(409, result.reason);

  context.notifyQueueMutation('external');
  const profile = await readQueuedProfile(cwd, queueDir, result.prdId);
  return {
    kind: 'queued',
    prdId: result.prdId,
    setName: result.setName,
    featureBranch: result.featureBranch,
    baseBranch: result.baseBranch,
    movedDescendantIds: result.movedDescendantIds,
    status: result.status,
    detail: result.status === 'already-queued' ? 'Compiled-build resume was already queued.' : 'Compiled-build resume queued.',
    ...(profile !== undefined ? { profile } : {}),
  };
}

async function validateExplicitProfile(context: MonitorContext, value: unknown): Promise<string | undefined> {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0) throw new HttpRouteError(400, 'Invalid field: profile must be a non-empty string');
  const profileName = value;
  try {
    const { getConfigDir, getConventionalConfigDir, loadProfile } = await import('@eforge-build/engine/config');
    const configDir = (await getConfigDir(context.cwd)) ?? getConventionalConfigDir(context.cwd);
    const profileResult = await loadProfile(configDir, profileName, context.cwd);
    if (!profileResult) throw new HttpRouteError(400, `Profile '${profileName}' not found`);
  } catch (err) {
    if (err instanceof HttpRouteError) throw err;
    throw new HttpRouteError(400, `Invalid profile '${profileName}': ${err instanceof Error ? err.message : String(err)}`);
  }
  return profileName;
}

async function readQueuedProfile(cwd: string, queueDir: string, prdId: string): Promise<string | undefined> {
  try {
    const { loadQueue } = await import('@eforge-build/engine/prd-queue');
    const prds = await loadQueue(resolve(cwd, queueDir), cwd);
    return prds.find((prd) => prd.id === prdId)?.frontmatter.profile;
  } catch {
    return undefined;
  }
}

async function validateResumeSetName(setName: string): Promise<void> {
  try {
    const { validatePlanSetName } = await import('@eforge-build/engine/plan');
    validatePlanSetName(setName);
  } catch (err) {
    throw new HttpRouteError(400, err instanceof Error ? err.message : String(err));
  }
  if (/^[.-]|[.]$|[\x00-\x20~^:?*[\\{}@]/.test(setName) || setName.endsWith('.lock') || setName.includes('..')) {
    throw new HttpRouteError(400, 'Invalid setName: contains characters that are not allowed in a branch ref');
  }
}

async function mapResumeMetadataValidation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (err) {
    if (err instanceof HttpRouteError) throw err;
    if (err instanceof Error && /^Invalid (plan set name|setName|prdId)/.test(err.message)) {
      throw new HttpRouteError(400, err.message);
    }
    throw err;
  }
}

export async function buildResumeEligibility(context: MonitorContext, prdId: string, setNameParam: string | null): Promise<ResumeEligibilityResponse> {
  if (!context.cwd) throw new HttpRouteError(503, 'No working directory configured');
  const cwd = context.cwd;
  const { projectResumeEligibility, resolveQueuedCompiledResumeMetadata } = await import('@eforge-build/engine/resume/compiled-build');
  const { computeWorktreeBase } = await import('@eforge-build/engine/worktree-ops');
  const prdQueueDir = context.options.config?.prdQueue?.dir ?? context.options.queueDir ?? '.eforge/queue';
  if (setNameParam !== null) await validateResumeSetName(setNameParam);
  const trunkBranch = context.options.config?.build?.trunkBranch;
  const metadata = await mapResumeMetadataValidation(async () => resolveQueuedCompiledResumeMetadata({
    cwd,
    prdId,
    queueDir: prdQueueDir,
    dbPath: resolve(cwd, '.eforge', 'monitor.db'),
    ...(setNameParam !== null ? { setName: setNameParam } : {}),
    ...(trunkBranch !== undefined ? { trunkBranch } : {}),
  }));
  const projection = await projectResumeEligibility({
    cwd,
    setName: metadata.setName,
    prdId,
    mergeWorktreePath: join(computeWorktreeBase(cwd, metadata.setName), '__merge__'),
    outputDir: context.options.config?.plan?.outputDir ?? context.options.planOutputDir ?? 'eforge/plans',
    dbPath: resolve(cwd, '.eforge', 'monitor.db'),
    ...(trunkBranch !== undefined ? { trunkBranch } : {}),
    featureBranch: metadata.featureBranch,
    baseBranch: metadata.baseBranch,
  });
  if (!projection.eligible) {
    return { eligible: false, prdId, setName: metadata.setName, featureBranch: projection.featureBranch, reason: projection.reason, ...(projection.checkedPath !== undefined ? { checkedPath: relative(cwd, projection.checkedPath) } : {}) };
  }
  return {
    eligible: true,
    prdId,
    setName: metadata.setName,
    featureBranch: projection.featureBranch,
    artifactAvailability: projection.artifactAvailability,
    ...(projection.artifactCommit !== undefined ? { artifactCommit: projection.artifactCommit } : {}),
    landedCommitCount: projection.landedCommitCount,
    diffStat: projection.diffStat,
    ...(projection.failingPlanId !== undefined ? { failingPlanId: projection.failingPlanId } : {}),
    ...(projection.partial !== undefined ? { partial: projection.partial } : {}),
  };
}
