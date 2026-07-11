import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { EforgeEvent, TestOwnership } from '@eforge-build/client';
import type { BuildStageSpec } from '../config.js';
import type { BuildStageContext } from './types.js';

const exec = promisify(execFile);
const GIT_BUFFER_BYTES = 10 * 1024 * 1024;

export type TestOwnershipStage = 'implement' | 'test-write' | 'test';

export interface TestOwnershipSnapshot {
  cwd: string;
  head: string;
  trackedPaths: Set<string>;
  baselineChangedPaths: Set<string>;
  /**
   * Set when the boundary could not be captured for a reason other than
   * "not a git repository" (e.g. index lock contention). Enforcement must
   * fail closed rather than silently skipping the ownership control.
   */
  captureError?: string;
}

export interface TestOwnershipViolation {
  stage: TestOwnershipStage;
  declaredOwner: TestOwnership | 'unspecified';
  changedPaths: string[];
  reason: string;
}

/**
 * Recognize conventional test files across the languages supported by eforge.
 *
 * Name-convention based and intentionally heuristic: this is an anti-footgun
 * guard for cooperating agents, not a hard boundary against an adversarial
 * one. Known trade-offs: directories named `spec/` match even when they hold
 * non-test artifacts (e.g. OpenAPI specs), and test-adjacent config such as
 * vitest.config.ts or CI workflow files is not covered.
 */
export function isTestPath(filePath: string): boolean {
  const normalized = filePath.replaceAll('\\', '/').replace(/^\.\//, '');
  const base = normalized.slice(normalized.lastIndexOf('/') + 1);
  if (/(^|\/)(test|tests|__tests__|spec)(\/|$)/i.test(normalized)) return true;
  return /\.(test|spec)\.[^.]+$/i.test(base)
    || /(?:^test_.*|_test)\.py$/i.test(base)
    || /_test\.go$/i.test(base)
    || /(?:Test|Tests)\.(?:java|kt|scala|cs)$/i.test(base)
    || /_spec\.rb$/i.test(base);
}

/** Stages whose working-tree changes are checked against the ownership boundary. */
const OWNERSHIP_GUARDED_STAGES: ReadonlySet<string> = new Set<TestOwnershipStage>(['implement', 'test-write', 'test']);

export function hasTestStages(build: readonly BuildStageSpec[]): boolean {
  return build.some(spec => Array.isArray(spec) ? spec.some(stage => stage.startsWith('test')) : spec.startsWith('test'));
}

/** Validate pipeline/owner compatibility before any build-stage agent starts. */
export function validateTestOwnershipPipeline(
  build: readonly BuildStageSpec[],
  owner: TestOwnership | undefined,
): TestOwnershipViolation | undefined {
  const stages = build.flatMap(spec => Array.isArray(spec) ? spec : [spec]);
  const testWriteCount = stages.filter(stage => stage === 'test-write').length;
  if (testWriteCount > 0 && owner !== 'test-writer') {
    return {
      stage: 'test-write',
      declaredOwner: owner ?? 'unspecified',
      changedPaths: [],
      reason: owner
        ? `test-write is incompatible with ${owner} ownership`
        : 'test-write requires an explicit test-writer owner',
    };
  }
  if (owner === 'test-writer' && testWriteCount !== 1) {
    return {
      stage: 'test-write',
      declaredOwner: owner,
      changedPaths: [],
      reason: `test-writer ownership requires exactly one test-write stage; found ${testWriteCount}`,
    };
  }
  // Enforcement diffs the shared working tree at stage boundaries, so it
  // cannot attribute changes made by concurrent stages: each stage's guard
  // would see its siblings' edits and misfire, then roll back in-flight work.
  for (const spec of build) {
    if (!Array.isArray(spec)) continue;
    const guarded = spec.filter(stage => OWNERSHIP_GUARDED_STAGES.has(stage));
    if (guarded.length > 1) {
      return {
        stage: guarded[0] as TestOwnershipStage,
        declaredOwner: owner ?? 'unspecified',
        changedPaths: [],
        reason: `ownership-guarded stages cannot share a parallel group (found ${guarded.join(', ')}); working-tree enforcement cannot attribute concurrent changes`,
      };
    }
  }
  return undefined;
}

/**
 * Capture a stage boundary. Returns undefined only when cwd is not a git
 * repository (non-git test contexts); any other git failure returns a
 * sentinel snapshot carrying `captureError` so enforcement fails closed
 * instead of silently disabling the control.
 *
 * The baseline exemption is path-identity based: paths already dirty or
 * untracked at capture time are excluded from attribution by name, so a
 * stage may modify those specific files without detection. Closing that gap
 * would require content-based tracking (e.g. hashing the baseline).
 */
export async function captureTestOwnershipSnapshot(cwd: string): Promise<TestOwnershipSnapshot | undefined> {
  let head: string;
  try {
    head = (await git(cwd, ['rev-parse', 'HEAD'])).trim();
  } catch (error) {
    return isNotGitRepositoryError(error) ? undefined : captureFailureSnapshot(cwd, error);
  }
  try {
    const trackedPaths = new Set(splitNul(await git(cwd, ['ls-files', '-z'])));
    const baselineChangedPaths = new Set([
      ...splitNul(await git(cwd, ['diff', '--name-only', '-z', head, '--'])),
      ...splitNul(await git(cwd, ['ls-files', '--others', '--exclude-standard', '-z'])),
    ]);
    return { cwd, head, trackedPaths, baselineChangedPaths };
  } catch (error) {
    return captureFailureSnapshot(cwd, error);
  }
}

/**
 * Check one mutating stage against its ownership boundary. Violating stage
 * changes are rolled back before the violation is returned.
 */
export async function enforceTestOwnershipAfterStage(input: {
  snapshot: TestOwnershipSnapshot | undefined;
  stage: TestOwnershipStage;
  owner: TestOwnership | undefined;
  testBugsFixed?: number;
}): Promise<TestOwnershipViolation | undefined> {
  if (!input.snapshot) return undefined;
  if (input.snapshot.captureError) {
    throw new Error(`test ownership snapshot capture failed: ${input.snapshot.captureError}`);
  }
  const changedPaths = await changedPathsSince(input.snapshot);
  const testPaths = changedPaths.filter(isTestPath);
  let reason: string | undefined;
  let violatingPaths: string[] = [];

  if (input.stage === 'implement' && input.owner && input.owner !== 'builder' && testPaths.length > 0) {
    violatingPaths = testPaths;
    reason = `implement changed test files owned by ${input.owner}`;
  } else if (input.stage === 'test-write') {
    const productionPaths = changedPaths.filter(path => !isTestPath(path));
    if (input.owner !== 'test-writer') {
      violatingPaths = changedPaths;
      reason = 'test-write ran without test-writer ownership';
    } else if (productionPaths.length > 0) {
      violatingPaths = productionPaths;
      reason = 'test-write changed non-test files';
    }
  } else if (input.stage === 'test') {
    const newTestPaths = testPaths.filter(path => !input.snapshot!.trackedPaths.has(path));
    if (newTestPaths.length > 0) {
      violatingPaths = newTestPaths;
      reason = 'tester created new test files instead of only triaging existing tests';
    } else if (testPaths.length > 0 && (input.testBugsFixed ?? 0) === 0) {
      violatingPaths = testPaths;
      reason = 'tester changed existing tests without reporting a concrete test-bug fix';
    }
  }

  if (!reason) return undefined;
  await restoreSnapshot(input.snapshot, changedPaths);
  return {
    stage: input.stage,
    declaredOwner: input.owner ?? 'unspecified',
    changedPaths: [...new Set(violatingPaths)].sort(),
    reason,
  };
}

export async function* enforceTestOwnershipGuard(ctx: BuildStageContext, snapshot: TestOwnershipSnapshot | undefined, stage: TestOwnershipStage, testBugsFixed?: number): AsyncGenerator<EforgeEvent, boolean> {
  const owner = ctx.planEntry?.testOwnership;
  if (snapshot?.captureError) {
    // The implement guard is a no-op without a non-builder owner, so a
    // capture failure there is only worth a diagnostic. When a boundary is
    // active, skipping would silently disable the control - fail closed.
    if (stage === 'implement' && (owner === undefined || owner === 'builder')) {
      yield { timestamp: new Date().toISOString(), type: 'plan:build:progress', planId: ctx.planId, message: `test ownership snapshot unavailable (${snapshot.captureError}); no ownership boundary applies to ${stage}` };
      return false;
    }
    yield { timestamp: new Date().toISOString(), type: 'plan:build:failed', planId: ctx.planId, error: `Test ownership enforcement for ${stage} failed closed: ${snapshot.captureError}` };
    ctx.buildFailed = true;
    return true;
  }
  let violation: TestOwnershipViolation | undefined;
  try {
    violation = await enforceTestOwnershipAfterStage({ snapshot, stage, owner, testBugsFixed });
  } catch (error) {
    yield { timestamp: new Date().toISOString(), type: 'plan:build:failed', planId: ctx.planId, error: `Test ownership enforcement for ${stage} failed: ${describeError(error)}` };
    ctx.buildFailed = true;
    return true;
  }
  if (!violation) return false;
  for (const event of testOwnershipViolationEvents(ctx.planId, violation)) yield event;
  ctx.buildFailed = true;
  return true;
}

export function testOwnershipViolationEvents(
  planId: string,
  violation: TestOwnershipViolation,
): [EforgeEvent, EforgeEvent] {
  const diagnostic: EforgeEvent = {
    timestamp: new Date().toISOString(),
    type: 'plan:build:test:ownership:violation',
    planId,
    ...violation,
  };
  const paths = violation.changedPaths.length > 0 ? ` Paths: ${violation.changedPaths.map(sanitizePathForMessage).join(', ')}.` : '';
  const failed: EforgeEvent = {
    timestamp: new Date().toISOString(),
    type: 'plan:build:failed',
    planId,
    error: `Test ownership violation during ${violation.stage}: ${violation.reason}.${paths}`,
  };
  return [diagnostic, failed];
}

async function changedPathsSince(snapshot: TestOwnershipSnapshot): Promise<string[]> {
  const diffPaths = splitNul(await git(snapshot.cwd, ['diff', '--name-only', '-z', snapshot.head, '--']));
  const untrackedPaths = splitNul(await git(snapshot.cwd, ['ls-files', '--others', '--exclude-standard', '-z']));
  return [...new Set([...diffPaths, ...untrackedPaths])]
    .filter(path => !snapshot.baselineChangedPaths.has(path))
    .sort();
}

/**
 * Roll back only the paths attributed to the violating stage. A blanket
 * `reset --hard` would also destroy baseline changes - uncommitted work that
 * predates the stage and that changedPathsSince deliberately exempts.
 */
async function restoreSnapshot(snapshot: TestOwnershipSnapshot, changedPaths: string[]): Promise<void> {
  // Move HEAD/index back without touching the working tree. This unstages
  // anything the stage staged or committed, so its new files become
  // untracked and removable below. (Baseline staged-vs-unstaged state is not
  // preserved; baseline content is.)
  await git(snapshot.cwd, ['reset', '--mixed', snapshot.head]);
  const trackedPaths = changedPaths.filter(path => snapshot.trackedPaths.has(path));
  const newPaths = changedPaths.filter(path => !snapshot.trackedPaths.has(path));
  if (trackedPaths.length > 0) await git(snapshot.cwd, ['checkout', snapshot.head, '--', ...trackedPaths.map(literalPathspec)]);
  if (newPaths.length > 0) await git(snapshot.cwd, ['clean', '-fd', '--', ...newPaths.map(literalPathspec)]);
}

/** Agent-created file names are untrusted; `:(literal)` neutralizes pathspec magic (e.g. a file named ":(glob)**"). */
function literalPathspec(filePath: string): string {
  return `:(literal)${filePath}`;
}

/** Filenames come from git raw bytes; strip control characters so a crafted name cannot inject log lines. */
function sanitizePathForMessage(filePath: string): string {
  return filePath.replaceAll(/\p{Cc}/gu, '?');
}

function captureFailureSnapshot(cwd: string, error: unknown): TestOwnershipSnapshot {
  return { cwd, head: '', trackedPaths: new Set(), baselineChangedPaths: new Set(), captureError: describeError(error) };
}

function isNotGitRepositoryError(error: unknown): boolean {
  if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') return true;
  const text = describeError(error);
  return /not a git repository/i.test(text) || /unknown revision or path not in the working tree/i.test(text);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message.trim() : String(error);
}

async function git(cwd: string, args: string[]): Promise<string> {
  return (await exec('git', args, { cwd, maxBuffer: GIT_BUFFER_BYTES })).stdout;
}

function splitNul(value: string): string[] {
  return value.split('\0').filter(Boolean);
}
