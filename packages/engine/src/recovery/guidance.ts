import { constants } from 'node:fs';
import { access, lstat, open, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { RecoveryGuidancePrepareResponse, RecoveryGuidancePatchedPlan, RecoveryVerdictSidecar } from '@eforge-build/client';
import { forgeCommit } from '../git.js';
import { validatePlanSetName } from '../plan.js';
import { computeWorktreeBase } from '../worktree-ops.js';
import { readRecoverySidecarProjection } from './sidecar-read.js';
import { patchRecoveryGuidanceSection, renderRecoveryGuidanceSection } from './guidance-render.js';
import {
  assertNoPreexistingGuidanceTargetDiff,
  currentHead,
  ensureGuidanceMergeWorktree,
  gitPathExists,
  hasAnyDiff,
  listGuidanceArtifactPathsAtCommit,
  locateGuidanceArtifacts,
  materializeGuidanceArtifactsFromHistory,
} from './guidance-artifacts.js';

export interface PrepareRecoveryGuidanceOptions {
  cwd: string;
  prdId: string;
  setName?: string;
  featureBranch?: string;
  baseBranch?: string;
  queueDir?: string;
  outputDir?: string;
  dbPath?: string;
  trunkBranch?: string;
}

export type RecoveryGuidanceErrorKind = 'validation' | 'missing-sidecar' | 'preflight';

export class RecoveryGuidanceError extends Error {
  constructor(message: string, readonly kind: RecoveryGuidanceErrorKind = 'validation') {
    super(message);
    this.name = 'RecoveryGuidanceError';
  }
}

export async function prepareRecoveryGuidance(options: PrepareRecoveryGuidanceOptions): Promise<RecoveryGuidancePrepareResponse> {
  void options.dbPath;
  void options.trunkBranch;
  assertSafeSegment(options.prdId, 'prdId');
  const cwd = resolve(options.cwd);
  const queueRelDir = options.queueDir ?? '.eforge/queue';
  const queueDir = resolveUnderCwd(cwd, queueRelDir, 'queueDir');
  const failedDir = join(queueDir, 'failed');
  const sidecarAbsPath = join(failedDir, `${options.prdId}.recovery.json`);
  await assertExists(sidecarAbsPath, `Recovery sidecar not found for ${options.prdId}`);

  let projection: Awaited<ReturnType<typeof readRecoverySidecarProjection>>;
  try {
    projection = await readRecoverySidecarProjection(failedDir, options.prdId);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    throw new RecoveryGuidanceError((err as Error).message, code === 'ENOENT' ? 'missing-sidecar' : 'validation');
  }
  const sidecar = projection.sidecar;
  const setName = options.setName ?? sidecar.setName;
  try {
    validatePlanSetName(setName);
  } catch (err) {
    throw new RecoveryGuidanceError((err as Error).message, 'validation');
  }
  validateSafeGitRef(setName, 'setName');
  if (options.setName !== undefined && options.setName !== sidecar.setName) {
    throw new RecoveryGuidanceError(`Requested setName '${options.setName}' does not match recovery sidecar setName '${sidecar.setName}'`);
  }

  const identity = sidecar.boundedEvidence.identity;
  const featureBranch = options.featureBranch ?? identity.featureBranch;
  const baseBranch = options.baseBranch ?? identity.baseBranch;
  validateSafeGitRef(featureBranch, 'featureBranch');
  validateSafeGitRef(baseBranch, 'baseBranch');
  if (options.featureBranch !== undefined && options.featureBranch !== identity.featureBranch) throw new RecoveryGuidanceError(`Requested featureBranch '${options.featureBranch}' does not match recovery sidecar featureBranch '${identity.featureBranch}'`);
  if (options.baseBranch !== undefined && options.baseBranch !== identity.baseBranch) throw new RecoveryGuidanceError(`Requested baseBranch '${options.baseBranch}' does not match recovery sidecar baseBranch '${identity.baseBranch}'`);

  const outputDir = normalizeRepoRelativeDir(options.outputDir ?? 'eforge/plans', 'outputDir');
  const sidecarPath = toRepoRelative(cwd, sidecarAbsPath);
  const rootPlanIds = rootFailedPlanIds(sidecar);
  for (const planId of rootPlanIds) assertSafePlanId(planId);

  const mergeWorktreePath = join(computeWorktreeBase(cwd, setName), '__merge__');
  try {
    await ensureGuidanceMergeWorktree({ cwd, mergeWorktreePath, featureBranch });
  } catch (err) {
    throw new RecoveryGuidanceError((err as Error).message, 'preflight');
  }
  let artifactLocation: Awaited<ReturnType<typeof locateGuidanceArtifacts>>;
  try {
    artifactLocation = await locateGuidanceArtifacts({ cwd, mergeWorktreePath, featureBranch, outputDir, setName });
  } catch (err) {
    throw new RecoveryGuidanceError((err as Error).message, 'preflight');
  }
  const candidateRootPaths = rootPlanIds.map((planId) => join(outputDir, setName, `${planId}.md`));

  if (!artifactLocation) {
    return responseBase({ options, setName, featureBranch, baseBranch, outputDir, sidecarPath, sidecar, plans: rootPlanIds.map((planId, index) => ({ planId, path: candidateRootPaths[index]!, status: 'artifact-missing', reason: 'Compiled plan artifacts were not found in the merge worktree, feature branch tip, or feature branch history.' })) });
  }

  try {
    await assertNoPreexistingGuidanceTargetDiff({ mergeWorktreePath, targetPaths: candidateRootPaths });
  } catch (err) {
    throw new RecoveryGuidanceError((err as Error).message, 'preflight');
  }

  let restoredPaths: string[] = [];
  if (artifactLocation.source !== 'merge-worktree') {
    try {
      await materializeGuidanceArtifactsFromHistory({ mergeWorktreePath, artifactCommit: artifactLocation.artifactCommit, planSetRelPath: artifactLocation.planSetRelPath });
      if (artifactLocation.source === 'branch-history') {
        restoredPaths = await listGuidanceArtifactPathsAtCommit({ cwd, artifactCommit: artifactLocation.artifactCommit, planSetRelPath: artifactLocation.planSetRelPath });
      }
    } catch (err) {
      throw new RecoveryGuidanceError((err as Error).message, 'preflight');
    }
  }

  const orchRelPath = join(artifactLocation.planSetRelPath, 'orchestration.yaml');
  const compiledPlanIds = await readCompiledPlanIds(resolve(mergeWorktreePath, orchRelPath));
  const isNonPlanRoot = (planId: string) => !compiledPlanIds.has(planId) && isKnownNonPlanRecoveryScope(planId);
  const patchRootPlanIds = rootPlanIds.filter((planId) => !isNonPlanRoot(planId));
  const nonPlanRoots = rootPlanIds.filter(isNonPlanRoot).map((planId) => ({
    planId,
    path: orchRelPath,
    status: 'already-current' as const,
    reason: 'Terminal failure scope is not a compiled plan; no plan guidance patch is required.',
  }));
  const patchRootPaths = patchRootPlanIds.map((planId) => join(outputDir, setName, `${planId}.md`));

  const preflight = await preflightTargets({ rootPlanIds: patchRootPlanIds, rootPaths: patchRootPaths, sidecar });
  if (preflight !== undefined) return responseBase({ options, setName, featureBranch, baseBranch, outputDir, sidecarPath, sidecar, plans: orderGuidancePlans(rootPlanIds, [...preflight, ...nonPlanRoots]) });

  const missing = [] as RecoveryGuidancePatchedPlan[];
  for (let i = 0; i < patchRootPlanIds.length; i++) {
    if (!(await gitPathExists(mergeWorktreePath, patchRootPaths[i]!))) {
      missing.push({ planId: patchRootPlanIds[i]!, path: patchRootPaths[i]!, status: 'artifact-missing', reason: 'Root failed compiled plan markdown artifact is missing.' });
    }
  }
  if (missing.length > 0) {
    const blocked = patchRootPlanIds.map((planId, index) => missing.find((item) => item.planId === planId) ?? { planId, path: patchRootPaths[index]!, status: 'blocked' as const, reason: 'Recovery guidance was not applied because another root target is missing.' });
    return responseBase({ options, setName, featureBranch, baseBranch, outputDir, sidecarPath, sidecar, plans: orderGuidancePlans(rootPlanIds, [...blocked, ...nonPlanRoots]) });
  }

  const unsafe = await unsafeRootTargets({ mergeWorktreePath, rootPlanIds: patchRootPlanIds, rootPaths: patchRootPaths });
  if (unsafe.length > 0) {
    const blocked = patchRootPlanIds.map((planId, index) => unsafe.find((item) => item.planId === planId) ?? { planId, path: patchRootPaths[index]!, status: 'blocked' as const, reason: 'Recovery guidance was not applied because another root target is unsafe.' });
    return responseBase({ options, setName, featureBranch, baseBranch, outputDir, sidecarPath, sidecar, plans: orderGuidancePlans(rootPlanIds, [...blocked, ...nonPlanRoots]) });
  }

  const plans: RecoveryGuidancePatchedPlan[] = [];
  for (let i = 0; i < patchRootPlanIds.length; i++) {
    const planId = patchRootPlanIds[i]!;
    const planPath = patchRootPaths[i]!;
    const absPlanPath = resolve(mergeWorktreePath, planPath);
    const { content: raw, identity: planIdentity } = await readSafeRegularFile(absPlanPath);
    const section = renderRecoveryGuidanceSection({ sidecar, planId, sidecarPath, featureBranch, baseBranch, setName, prdId: options.prdId });
    const patched = patchRecoveryGuidanceSection(raw, section);
    if (patched.changed) await writeSafeRegularFile(absPlanPath, patched.content, planIdentity);
    plans.push({ planId, path: planPath, status: patched.changed ? 'patched' : 'already-current' });
  }

  const commitPaths = uniqueSorted([...restoredPaths, ...patchRootPaths]);
  let commitSha: string | undefined;
  if (commitPaths.length > 0 && await hasAnyDiff(mergeWorktreePath, commitPaths)) {
    await forgeCommit(mergeWorktreePath, `recovery(${options.prdId}): add compiled plan guidance`, { paths: commitPaths });
    commitSha = await currentHead(mergeWorktreePath);
  }

  return responseBase({ options, setName, featureBranch, baseBranch, outputDir, sidecarPath, sidecar, plans: orderGuidancePlans(rootPlanIds, [...plans, ...nonPlanRoots]), commitSha });
}

export function recoveryGuidanceResumeBlocker(response: RecoveryGuidancePrepareResponse): string | undefined {
  if (response.plans.length === 0) return 'Recovery guidance found no root failed plans to patch.';
  const blocked = response.plans.find((plan) => plan.status !== 'patched' && plan.status !== 'already-current');
  return blocked ? `Recovery guidance for ${blocked.planId} is ${blocked.status}${blocked.reason ? `: ${blocked.reason}` : ''}` : undefined;
}

async function readCompiledPlanIds(orchestrationPath: string): Promise<Set<string>> {
  try {
    const raw = await readFile(orchestrationPath, 'utf-8');
    const data = parseYaml(raw) as { plans?: Array<{ id?: unknown }> } | null;
    const ids = Array.isArray(data?.plans)
      ? data.plans.map((plan) => plan.id).filter((id): id is string => typeof id === 'string' && id.length > 0)
      : [];
    return new Set(ids);
  } catch (err) {
    throw new RecoveryGuidanceError(`Recovery guidance could not read compiled orchestration plan ids: ${(err as Error).message}`, 'preflight');
  }
}

function orderGuidancePlans(rootPlanIds: string[], plans: RecoveryGuidancePatchedPlan[]): RecoveryGuidancePatchedPlan[] {
  return rootPlanIds.flatMap((planId) => plans.filter((plan) => plan.planId === planId));
}

function isKnownNonPlanRecoveryScope(planId: string): boolean {
  return planId === 'landing' || planId === 'validation' || planId === 'prd-validation' || planId === 'acceptance-validation';
}

function preflightTargets(opts: { rootPlanIds: string[]; rootPaths: string[]; sidecar: RecoveryVerdictSidecar }): Promise<RecoveryGuidancePatchedPlan[] | undefined> {
  const blocked = opts.rootPlanIds.flatMap((planId, index) => {
    const evidence = opts.sidecar.boundedEvidence.plans.find((plan) => plan.planId === planId);
    if (evidence?.status === 'blocked' || evidence?.status === 'skipped') {
      return [{ planId, path: opts.rootPaths[index]!, status: 'blocked' as const, reason: `Root plan status is ${evidence.status}; blocked/skipped artifacts are not patched.` }];
    }
    return [];
  });
  if (blocked.length === 0) return Promise.resolve(undefined);
  return Promise.resolve(opts.rootPlanIds.map((planId, index) => blocked.find((item) => item.planId === planId) ?? { planId, path: opts.rootPaths[index]!, status: 'blocked', reason: 'Recovery guidance was not applied because another root target is blocked.' }));
}

async function unsafeRootTargets(opts: { mergeWorktreePath: string; rootPlanIds: string[]; rootPaths: string[] }): Promise<RecoveryGuidancePatchedPlan[]> {
  const root = await realpath(opts.mergeWorktreePath);
  const unsafe: RecoveryGuidancePatchedPlan[] = [];
  for (let i = 0; i < opts.rootPlanIds.length; i++) {
    const planId = opts.rootPlanIds[i]!;
    const path = opts.rootPaths[i]!;
    const absPath = resolve(opts.mergeWorktreePath, path);
    try {
      const stat = await lstat(absPath);
      if (stat.isSymbolicLink() || !stat.isFile()) {
        unsafe.push({ planId, path, status: 'blocked', reason: 'Root failed compiled plan markdown artifact is not a safe regular file.' });
        continue;
      }
      const target = await realpath(absPath);
      if (!isPathInside(root, target)) {
        unsafe.push({ planId, path, status: 'blocked', reason: 'Root failed compiled plan markdown artifact resolves outside the merge worktree.' });
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        unsafe.push({ planId, path, status: 'artifact-missing', reason: 'Root failed compiled plan markdown artifact is missing.' });
        continue;
      }
      unsafe.push({ planId, path, status: 'blocked', reason: 'Root failed compiled plan markdown artifact could not be verified as a safe regular file.' });
    }
  }
  return unsafe;
}

interface SafeFileIdentity {
  dev: number;
  ino: number;
}

async function readSafeRegularFile(path: string): Promise<{ content: string; identity: SafeFileIdentity }> {
  const handle = await openGuidanceTarget(path, constants.O_RDONLY);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new RecoveryGuidanceError('Root failed compiled plan markdown artifact is not a safe regular file.', 'preflight');
    return { content: await handle.readFile('utf-8'), identity: { dev: stat.dev, ino: stat.ino } };
  } finally {
    await handle.close();
  }
}

async function writeSafeRegularFile(path: string, content: string, expected: SafeFileIdentity): Promise<void> {
  const handle = await openGuidanceTarget(path, constants.O_RDWR);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.dev !== expected.dev || stat.ino !== expected.ino) {
      throw new RecoveryGuidanceError('Root failed compiled plan markdown artifact changed during guidance patching.', 'preflight');
    }
    await handle.truncate(0);
    await handle.writeFile(content, 'utf-8');
  } finally {
    await handle.close();
  }
}

async function openGuidanceTarget(path: string, flags: number): ReturnType<typeof open> {
  try {
    return await open(path, flags | constants.O_NOFOLLOW);
  } catch (err) {
    if (err instanceof RecoveryGuidanceError) throw err;
    throw new RecoveryGuidanceError(`Root failed compiled plan markdown artifact could not be opened safely: ${(err as Error).message}`, 'preflight');
  }
}

function isPathInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function rootFailedPlanIds(sidecar: RecoveryVerdictSidecar): string[] {
  const multi = sidecar.boundedEvidence.failingPlans?.map((plan) => plan.planId).filter(Boolean) ?? [];
  return uniqueSorted(multi.length > 0 ? multi : [sidecar.boundedEvidence.failingPlan.planId]);
}

function responseBase(args: { options: PrepareRecoveryGuidanceOptions; setName: string; featureBranch: string; baseBranch: string; outputDir: string; sidecarPath: string; sidecar: RecoveryVerdictSidecar; plans: RecoveryGuidancePatchedPlan[]; commitSha?: string }): RecoveryGuidancePrepareResponse {
  return {
    prdId: args.options.prdId,
    setName: args.setName,
    featureBranch: args.featureBranch,
    baseBranch: args.baseBranch,
    outputDir: args.outputDir,
    sidecarPath: args.sidecarPath,
    sidecarGeneratedAt: args.sidecar.generatedAt,
    plans: args.plans,
    ...(args.commitSha !== undefined ? { commitSha: args.commitSha } : {}),
  };
}

function assertSafeSegment(value: string, label: string): void {
  if (!value || value.includes('/') || value.includes('\\') || value.includes('..') || /[\x00-\x1f\x7f]/.test(value)) throw new RecoveryGuidanceError(`Invalid ${label}: must not contain path separators, traversal sequences, or control characters`);
}

function assertSafePlanId(planId: string): void {
  if (!planId || planId.includes('..') || /[\\/]/.test(planId) || !/^[A-Za-z0-9_-]+$/.test(planId)) throw new RecoveryGuidanceError(`Invalid root plan id: ${planId}`);
}

function validateSafeGitRef(value: string, label: string): void {
  if (!value || /^[.-]|[.]$|[\x00-\x20~^:?*[\\{}@]/.test(value) || value.endsWith('.lock') || value.includes('..')) throw new RecoveryGuidanceError(`Invalid ${label}: contains characters that are not allowed in a branch ref`);
}

function normalizeRepoRelativeDir(value: string, label: string): string {
  if (!value || value.startsWith('/') || value.includes('\\')) throw new RecoveryGuidanceError(`Invalid ${label}: must be repo-relative`);
  const normalized = value.split('/').filter((part) => part.length > 0).join('/');
  if (!normalized || normalized.split('/').some((part) => part === '..' || part === '.')) throw new RecoveryGuidanceError(`Invalid ${label}: must not traverse outside the repository`);
  if (/[:*?\[]/.test(normalized)) throw new RecoveryGuidanceError(`Invalid ${label}: must not contain Git pathspec metacharacters`);
  return normalized;
}

function resolveUnderCwd(cwd: string, maybeRelative: string, label: string): string {
  const resolved = resolve(cwd, maybeRelative);
  if (relative(cwd, resolved).startsWith('..')) throw new RecoveryGuidanceError(`Invalid ${label}: must resolve inside the repository`);
  return resolved;
}

function toRepoRelative(cwd: string, absPath: string): string {
  return relative(cwd, absPath).split('\\').join('/');
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

async function assertExists(path: string, message: string): Promise<void> {
  try {
    await access(path, constants.F_OK);
  } catch {
    throw new RecoveryGuidanceError(message, 'missing-sidecar');
  }
}
