import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';

import { runIntake } from '../agents/intake.js';
import { runStalenessAssessor } from '../agents/staleness-assessor.js';
import { resolveTrunkBranch } from '../branch-policy.js';
import type { AgentRuntimeRegistry } from '../agent-runtime-registry.js';
import type { EforgeConfig } from '../config.js';
import type { BuildOptions, CompileOptions, EforgeEvent } from '../events.js';
import { forgeCommit, retryOnLock } from '../git.js';
import { composeCommitMessage } from '../model-tracker.js';
import { resolveAgentConfig } from '../pipeline.js';
import {
  claimPrd,
  getCompiledResumeFrontmatter,
  getHeadHash,
  getPrdDiffSummary,
  QueueSkipReason,
  type CompiledResumeFrontmatter,
  type PrdFrontmatter,
  type QueuedPrd,
  type QueueSkipReasonValue,
} from '../prd-queue.js';
import type { QueueOptions } from '../eforge.js';
import { withRunId } from '../session.js';
import { resolveStackBaseContext, type StackBaseContext } from '../stacking/base-resolver.js';
import { createProvider, type StackProviderAdapter } from '../stacking/provider.js';
import { prepareTrunkSyncBase, type TrunkSyncResult } from '../trunk-sync.js';
import {
  appendAcceptanceCriteriaInventoryBlock,
  requireAcceptanceCriteriaInventoryFromPrd,
  stripAcceptanceCriteriaInventoryBlock,
} from '../validation/acceptance-criteria-inventory.js';

const exec = promisify(execFile);

// --- eforge:region queued-prd-types ---
type ResumeBuildOptions = {
  setName?: string;
  featureBranch?: string;
  baseBranch?: string;
  cwd?: string;
  verbose?: boolean;
  abortController?: AbortController;
  schedulerOwned?: boolean;
  landingAction?: 'pr' | 'merge' | 'leave';
  landingAutoMerge?: boolean;
};

export interface QueuedPrdBuildContext {
  cwd: string;
  config: EforgeConfig;
  agentRuntimes: AgentRuntimeRegistry;
  compile: (source: string, options: Partial<CompileOptions>) => AsyncGenerator<EforgeEvent>;
  build: (planSet: string, options: Partial<BuildOptions>) => AsyncGenerator<EforgeEvent>;
  resumeBuild: (prdId: string, options: ResumeBuildOptions) => AsyncGenerator<EforgeEvent>;
}

type SessionResult = {
  status: 'completed' | 'failed' | 'skipped';
  summary: string;
};

type SessionInfo = {
  prdSessionId: string;
  injectedSessionId?: string;
};

type ReadCompiledResumeResult =
  | { ok: true; compiledResume: CompiledResumeFrontmatter | undefined }
  | { ok: false; message: string };

type SimpleResult<T> = { ok: true; value: T } | { ok: false; message: string };

type StalenessOutcome =
  | { kind: 'continue'; prd: QueuedPrd }
  | { kind: 'terminal' };

type CompileOverrides = {
  baseBranchOverride?: string;
  worktreeBaseRefOverride?: string;
};
// --- eforge:endregion queued-prd-types ---

// --- eforge:region pre-build-validation ---
export async function* runQueuedPrdBuild(
  ctx: QueuedPrdBuildContext,
  prd: QueuedPrd,
  options: QueueOptions,
  sessionId?: string,
): AsyncGenerator<EforgeEvent> {
  yield emitQueuePrdStart(prd);

  const claimed = await claimPrd(prd.id, ctx.cwd);
  if (!claimed) {
    yield* emitAlreadyClaimedSkip(prd, sessionId);
    return;
  }

  const prdSessionId = sessionId ?? randomUUID();
  const sessionInfo: SessionInfo = { prdSessionId, ...(sessionId !== undefined && { injectedSessionId: sessionId }) };
  const compiledResumeResult = readCompiledResumeFrontmatter(prd.frontmatter);
  if (!compiledResumeResult.ok) {
    yield* emitPreBuildFailureEvents(prd.id, prdSessionId, sessionId, compiledResumeResult.message);
    return;
  }

  const compiledResume = compiledResumeResult.compiledResume;
  const acceptanceResult = validateAcceptanceInventory(prd, compiledResume, ctx.config);
  if (!acceptanceResult.ok) {
    yield* emitPreBuildFailureEvents(prd.id, prdSessionId, sessionId, acceptanceResult.message);
    return;
  }

  const staleOutcome = yield* assessAndApplyStaleness(ctx, prd, options, compiledResume, sessionInfo);
  if (staleOutcome.kind === 'terminal') return;
  prd = staleOutcome.prd;

  yield* runMainQueuedPrdSession(ctx, prd, options, prdSessionId, sessionId, compiledResume);
}

function emitQueuePrdStart(prd: QueuedPrd): EforgeEvent {
  return { timestamp: ts(), type: 'queue:prd:start', prdId: prd.id, title: prd.frontmatter.title } as EforgeEvent;
}

function* emitAlreadyClaimedSkip(prd: QueuedPrd, injectedSessionId?: string): Generator<EforgeEvent> {
  yield { timestamp: ts(), type: 'queue:prd:skip', prdId: prd.id, reason: QueueSkipReason.AlreadyClaimed } as EforgeEvent;
  if (injectedSessionId !== undefined) {
    yield { type: 'session:end', sessionId: injectedSessionId, result: { status: 'skipped', summary: 'PRD already claimed by another process' }, timestamp: ts() } as EforgeEvent;
  }
  yield { timestamp: ts(), type: 'queue:prd:complete', prdId: prd.id, status: 'skipped' } as EforgeEvent;
}

function* emitPreBuildFailureEvents(prdId: string, prdSessionId: string, injectedSessionId: string | undefined, message: string): Generator<EforgeEvent> {
  if (injectedSessionId === undefined) {
    yield { type: 'session:start', sessionId: prdSessionId, timestamp: ts() } as EforgeEvent;
  }
  yield* emitPlanFailureEvents(prdId, message);
  yield { type: 'session:end', sessionId: prdSessionId, result: { status: 'failed', summary: message }, timestamp: ts() } as EforgeEvent;
  yield { timestamp: ts(), type: 'queue:prd:complete', prdId, status: 'failed' } as EforgeEvent;
}

function readCompiledResumeFrontmatter(frontmatter: PrdFrontmatter): ReadCompiledResumeResult {
  try {
    return { ok: true, compiledResume: getCompiledResumeFrontmatter(frontmatter) };
  } catch (err) {
    return { ok: false, message: errorMessage(err) };
  }
}

function validateAcceptanceInventory(
  prd: QueuedPrd,
  compiledResume: CompiledResumeFrontmatter | undefined,
  config: EforgeConfig,
): SimpleResult<undefined> {
  if (compiledResume !== undefined) return { ok: true, value: undefined };
  try {
    requireAcceptanceCriteriaInventoryFromPrd(prd.content, {
      allowNoAcceptanceCriteria: config.build.validation.allowNoAcceptanceCriteria,
    });
    return { ok: true, value: undefined };
  } catch (err) {
    return { ok: false, message: errorMessage(err) };
  }
}
// --- eforge:endregion pre-build-validation ---

// --- eforge:region staleness ---
async function* assessAndApplyStaleness(
  ctx: QueuedPrdBuildContext,
  prd: QueuedPrd,
  options: QueueOptions,
  compiledResume: CompiledResumeFrontmatter | undefined,
  sessionInfo: SessionInfo,
): AsyncGenerator<EforgeEvent, StalenessOutcome> {
  const headHash = await getHeadHash(ctx.cwd);
  if (compiledResume !== undefined) return { kind: 'continue', prd };
  if (!prd.lastCommitHash || prd.lastCommitHash === headHash) return { kind: 'continue', prd };

  const staleResult = yield* assessPrdStaleness(ctx, prd, options);
  if (staleResult.verdict === 'obsolete') {
    yield* emitStaleSkip(prd, sessionInfo.injectedSessionId, QueueSkipReason.Obsolete, 'PRD is obsolete');
    return { kind: 'terminal' };
  }
  if (staleResult.verdict !== 'revise') return { kind: 'continue', prd };

  const revisedPrd = yield* applyStaleRevision(ctx, prd, options, staleResult.revision, sessionInfo);
  return revisedPrd === undefined ? { kind: 'terminal' } : { kind: 'continue', prd: revisedPrd };
}

async function* assessPrdStaleness(
  ctx: QueuedPrdBuildContext,
  prd: QueuedPrd,
  options: QueueOptions,
): AsyncGenerator<EforgeEvent, { verdict: 'proceed' | 'revise' | 'obsolete'; revision?: string }> {
  const diffSummary = await getPrdDiffSummary(prd.lastCommitHash, ctx.cwd);
  let verdict: 'proceed' | 'revise' | 'obsolete' = 'proceed';
  let revision: string | undefined;
  const stalenessConfig = resolveAgentConfig('staleness-assessor', ctx.config);
  for await (const event of runStalenessAssessor({
    ...stalenessConfig,
    prdContent: stripAcceptanceCriteriaInventoryBlock(prd.content),
    diffSummary,
    cwd: ctx.cwd,
    prdId: prd.id,
    title: prd.frontmatter.title,
    verbose: options.verbose,
    abortController: options.abortController,
    phase: 'standalone',
    harness: ctx.agentRuntimes.forRole('staleness-assessor'),
  })) {
    if (event.type === 'queue:prd:stale') {
      verdict = event.verdict;
      revision = event.revision;
    }
    yield event;
  }
  return { verdict, revision };
}

async function* applyStaleRevision(
  ctx: QueuedPrdBuildContext,
  prd: QueuedPrd,
  options: QueueOptions,
  revision: string | undefined,
  sessionInfo: SessionInfo,
): AsyncGenerator<EforgeEvent, QueuedPrd | undefined> {
  if (!revision) {
    yield* emitStaleSkip(prd, sessionInfo.injectedSessionId, QueueSkipReason.NeedsRevision, 'PRD needs manual revision');
    return undefined;
  }

  const inventoryResult = yield* extractRevisionInventory(ctx, revision, options);
  if (!inventoryResult.ok) {
    yield* emitPreBuildFailureEvents(prd.id, sessionInfo.prdSessionId, sessionInfo.injectedSessionId, inventoryResult.message);
    return undefined;
  }

  const content = `${inventoryResult.value}\n`;
  const revisedPrd = { ...prd, content };
  await writeFile(prd.filePath, content, 'utf-8');
  yield* commitStaleRevision(ctx, revisedPrd);
  return revisedPrd;
}

async function* extractRevisionInventory(
  ctx: QueuedPrdBuildContext,
  revision: string,
  options: QueueOptions,
): AsyncGenerator<EforgeEvent, SimpleResult<string>> {
  const visibleRevision = stripAcceptanceCriteriaInventoryBlock(revision).trimEnd();
  try {
    const intakeConfig = resolveAgentConfig('formatter', ctx.config);
    const intakeGen = runIntake({
      ...intakeConfig,
      cwd: ctx.cwd,
      sourceContent: visibleRevision,
      verbose: options.verbose,
      abortController: options.abortController,
      phase: 'standalone',
      harness: ctx.agentRuntimes.forRole('formatter'),
      allowNoAcceptanceCriteria: ctx.config.build.validation.allowNoAcceptanceCriteria,
    });
    let intakeIteration = await intakeGen.next();
    while (!intakeIteration.done) {
      yield intakeIteration.value;
      intakeIteration = await intakeGen.next();
    }
    const revisedContent = appendAcceptanceCriteriaInventoryBlock(intakeIteration.value.body, intakeIteration.value.inventory).trimEnd();
    return { ok: true, value: revisedContent };
  } catch (err) {
    return { ok: false, message: errorMessage(err) };
  }
}

async function* commitStaleRevision(ctx: QueuedPrdBuildContext, prd: QueuedPrd): AsyncGenerator<EforgeEvent> {
  try {
    await retryOnLock(() => exec('git', ['add', '--', prd.filePath], { cwd: ctx.cwd }), ctx.cwd);
    await forgeCommit(ctx.cwd, composeCommitMessage(`chore(queue): revise stale PRD ${prd.id}`));
  } catch (err) {
    yield { timestamp: ts(), type: 'queue:prd:commit-failed', prdId: prd.id, title: prd.frontmatter.title, error: errorMessage(err) } as EforgeEvent;
  }
}

function* emitStaleSkip(prd: QueuedPrd, injectedSessionId: string | undefined, reason: QueueSkipReasonValue, summary: string): Generator<EforgeEvent> {
  yield { timestamp: ts(), type: 'queue:prd:skip', prdId: prd.id, reason } as EforgeEvent;
  if (injectedSessionId !== undefined) {
    yield { type: 'session:end', sessionId: injectedSessionId, result: { status: 'skipped', summary }, timestamp: ts() } as EforgeEvent;
  }
  yield { timestamp: ts(), type: 'queue:prd:complete', prdId: prd.id, status: 'skipped' } as EforgeEvent;
}
// --- eforge:endregion staleness ---

// --- eforge:region compile-preparation ---
async function resolveQueuedStackContext(
  ctx: QueuedPrdBuildContext,
  prd: QueuedPrd,
  planSetName: string,
): Promise<SimpleResult<StackBaseContext | undefined>> {
  if (!ctx.config.stacking.enabled) return { ok: true, value: undefined };
  try {
    return { ok: true, value: await resolveStackBaseContext({ cwd: ctx.cwd, config: ctx.config, prd, planSetName }) };
  } catch (err) {
    return { ok: false, message: errorMessage(err) };
  }
}

async function requireQueuedStackProvider(
  ctx: QueuedPrdBuildContext,
  stackContext: StackBaseContext | undefined,
): Promise<SimpleResult<StackProviderAdapter | undefined>> {
  if (stackContext === undefined) return { ok: true, value: undefined };
  try {
    const stackProvider = createProvider(ctx.config.stacking);
    await stackProvider.requireAvailable(ctx.cwd);
    return { ok: true, value: stackProvider };
  } catch (err) {
    return { ok: false, message: errorMessage(err) };
  }
}

async function* resolveCompileOverrides(
  ctx: QueuedPrdBuildContext,
  prd: QueuedPrd,
  stackContext: StackBaseContext | undefined,
): AsyncGenerator<EforgeEvent, SimpleResult<CompileOverrides>> {
  const worktreeOverrideResult = yield* resolveCompileWorktreeOverride(ctx, prd, stackContext);
  if (!worktreeOverrideResult.ok) return worktreeOverrideResult;
  return {
    ok: true,
    value: {
      ...(stackContext?.baseBranch !== undefined && { baseBranchOverride: stackContext.baseBranch }),
      ...(worktreeOverrideResult.value !== undefined && { worktreeBaseRefOverride: worktreeOverrideResult.value }),
    },
  };
}

async function* resolveCompileWorktreeOverride(
  ctx: QueuedPrdBuildContext,
  prd: QueuedPrd,
  stackContext: StackBaseContext | undefined,
): AsyncGenerator<EforgeEvent, SimpleResult<string | undefined>> {
  if (!ctx.config.build.trunkSync.enabled) return { ok: true, value: undefined };
  if (stackContext !== undefined) return yield* resolveStackedTrunkSyncOverride(ctx, prd, stackContext);
  return yield* resolveNonStackedTrunkSyncOverride(ctx, prd);
}

async function* resolveStackedTrunkSyncOverride(
  ctx: QueuedPrdBuildContext,
  prd: QueuedPrd,
  stackContext: StackBaseContext,
): AsyncGenerator<EforgeEvent, SimpleResult<string | undefined>> {
  if (stackContext.parentPrdId !== undefined) return { ok: true, value: undefined };
  yield { timestamp: ts(), type: 'planning:progress', message: `Trunk sync: checking '${stackContext.baseBranch}' against remote before compile (PRD ${prd.id})` } as EforgeEvent;
  const tsSyncResult = await prepareTrunkSyncBase({ cwd: ctx.cwd, config: ctx.config, candidateBase: stackContext.baseBranch, parentPrdId: undefined });
  const failure = yield* yieldTrunkSyncEvents(tsSyncResult, prd.id);
  if (failure !== undefined) return { ok: false, message: failure };
  return { ok: true, value: tsSyncResult.baseRef !== stackContext.baseBranch ? tsSyncResult.baseRef : undefined };
}

async function* resolveNonStackedTrunkSyncOverride(
  ctx: QueuedPrdBuildContext,
  prd: QueuedPrd,
): AsyncGenerator<EforgeEvent, SimpleResult<string | undefined>> {
  const { stdout: currentBranchRaw } = await exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: ctx.cwd });
  const currentBranch = currentBranchRaw.trim();
  const resolvedTrunk = await resolveTrunkBranch(ctx.config, ctx.cwd, ctx.config.build.trunkSync.remote);
  if (currentBranch !== resolvedTrunk) return { ok: true, value: undefined };
  yield { timestamp: ts(), type: 'planning:progress', message: `Trunk sync: checking '${resolvedTrunk}' against remote before compile (PRD ${prd.id})` } as EforgeEvent;
  const tsSyncResult = await prepareTrunkSyncBase({ cwd: ctx.cwd, config: ctx.config, candidateBase: resolvedTrunk, parentPrdId: undefined });
  const failure = yield* yieldTrunkSyncEvents(tsSyncResult, prd.id);
  if (failure !== undefined) return { ok: false, message: failure };
  return { ok: true, value: tsSyncResult.baseRef !== resolvedTrunk ? tsSyncResult.baseRef : undefined };
}

// --- eforge:endregion compile-preparation ---

// --- eforge:region phase-execution ---
async function* runMainQueuedPrdSession(
  ctx: QueuedPrdBuildContext,
  prd: QueuedPrd,
  options: QueueOptions,
  prdSessionId: string,
  injectedSessionId: string | undefined,
  compiledResume: CompiledResumeFrontmatter | undefined,
): AsyncGenerator<EforgeEvent> {
  let prdResult: SessionResult = { status: 'failed', summary: 'Session terminated abnormally' };
  try {
    if (injectedSessionId === undefined) yield { type: 'session:start', sessionId: prdSessionId, timestamp: ts() } as EforgeEvent;
    if (compiledResume !== undefined) {
      prdResult = yield* runCompiledResumePhase(ctx, compiledResume, prd, options, prdSessionId);
      return;
    }

    const planSetName = options.name ?? prd.id;
    const preparation = yield* prepareCompileAndBuild(ctx, prd, options, prdSessionId, planSetName);
    if (preparation.status !== 'completed') {
      prdResult = preparation;
      return;
    }
    prdResult = yield* runBuildPhase(ctx, prd, planSetName, options, prdSessionId, preparation.stackContext, preparation.stackProvider);
  } catch (err) {
    prdResult = { status: 'failed', summary: errorMessage(err) };
  } finally {
    yield* emitTerminalQueuedPrdEvents(prd, prdSessionId, prdResult);
  }
}

async function* prepareCompileAndBuild(
  ctx: QueuedPrdBuildContext,
  prd: QueuedPrd,
  options: QueueOptions,
  prdSessionId: string,
  planSetName: string,
): AsyncGenerator<EforgeEvent, SessionResult & { stackContext?: StackBaseContext; stackProvider?: StackProviderAdapter }> {
  const stackResult = await resolveQueuedStackContext(ctx, prd, planSetName);
  if (!stackResult.ok) return yield* failPreparedPrd(prd.id, stackResult.message);

  const providerResult = await requireQueuedStackProvider(ctx, stackResult.value);
  if (!providerResult.ok) return yield* failPreparedPrd(prd.id, providerResult.message);

  const overridesResult = yield* resolveCompileOverrides(ctx, prd, stackResult.value);
  if (!overridesResult.ok) return { status: 'failed', summary: overridesResult.message };

  const compileResult = yield* runCompilePhase(ctx, prd, planSetName, options, prdSessionId, overridesResult.value);
  if (compileResult.status !== 'completed') return compileResult;
  return { status: 'completed', summary: 'Compile complete', ...(stackResult.value !== undefined && { stackContext: stackResult.value }), ...(providerResult.value !== undefined && { stackProvider: providerResult.value }) };
}

async function* failPreparedPrd(prdId: string, message: string): AsyncGenerator<EforgeEvent, SessionResult> {
  yield* emitPlanFailureEvents(prdId, message);
  return { status: 'failed', summary: message };
}

async function* runCompiledResumePhase(
  ctx: QueuedPrdBuildContext,
  compiledResume: CompiledResumeFrontmatter,
  prd: QueuedPrd,
  options: QueueOptions,
  prdSessionId: string,
): AsyncGenerator<EforgeEvent, SessionResult> {
  let resumeFailed = false;
  const resolvedLandingAction = options.landingAction ?? prd.frontmatter.landing;
  const resolvedLandingAutoMerge = options.landingAutoMerge ?? prd.frontmatter.landing_auto_merge;
  for await (const event of withRunId(ctx.resumeBuild(compiledResume.sourcePrdId, {
    setName: compiledResume.setName,
    featureBranch: compiledResume.featureBranch,
    baseBranch: compiledResume.baseBranch,
    cwd: ctx.cwd,
    verbose: options.verbose,
    abortController: options.abortController,
    schedulerOwned: true,
    ...(resolvedLandingAction !== undefined && { landingAction: resolvedLandingAction }),
    ...(resolvedLandingAutoMerge !== undefined && { landingAutoMerge: resolvedLandingAutoMerge }),
  }))) {
    yield { ...event, sessionId: prdSessionId } as EforgeEvent;
    if (event.type === 'phase:end' && event.result.status === 'failed') resumeFailed = true;
  }
  return resumeFailed ? { status: 'failed', summary: 'Continue-and-repair failed' } : { status: 'completed', summary: 'Continue-and-repair complete' };
}

async function* runCompilePhase(
  ctx: QueuedPrdBuildContext,
  prd: QueuedPrd,
  planSetName: string,
  options: QueueOptions,
  prdSessionId: string,
  overrides: CompileOverrides,
): AsyncGenerator<EforgeEvent, SessionResult> {
  let compileFailed = false;
  let planSkipped = false;
  let skipReason = '';
  for await (const event of withRunId(ctx.compile(prd.filePath, {
    name: planSetName,
    auto: options.auto,
    verbose: options.verbose,
    cwd: ctx.cwd,
    abortController: options.abortController,
    ...(overrides.baseBranchOverride !== undefined && { baseBranchOverride: overrides.baseBranchOverride }),
    ...(overrides.worktreeBaseRefOverride !== undefined && { worktreeBaseRefOverride: overrides.worktreeBaseRefOverride }),
  }))) {
    yield { ...event, sessionId: prdSessionId } as EforgeEvent;
    if (event.type === 'phase:end' && event.result.status === 'failed') compileFailed = true;
    if (event.type === 'planning:skip') {
      planSkipped = true;
      skipReason = event.reason;
    }
  }
  if (compileFailed) return { status: 'failed', summary: 'Compile failed' };
  if (planSkipped) return { status: 'skipped', summary: skipReason };
  return { status: 'completed', summary: 'Compile complete' };
}

async function* runBuildPhase(
  ctx: QueuedPrdBuildContext,
  prd: QueuedPrd,
  planSetName: string,
  options: QueueOptions,
  prdSessionId: string,
  stackContext: StackBaseContext | undefined,
  stackProvider: StackProviderAdapter | undefined,
): AsyncGenerator<EforgeEvent, SessionResult> {
  let buildFailed = false;
  const resolvedLandingAction = options.landingAction ?? prd.frontmatter.landing;
  const resolvedLandingAutoMerge = options.landingAutoMerge ?? prd.frontmatter.landing_auto_merge;
  for await (const event of withRunId(ctx.build(planSetName, {
    auto: options.auto,
    verbose: options.verbose,
    cwd: ctx.cwd,
    abortController: options.abortController,
    prdFilePath: prd.filePath,
    prdId: prd.id,
    ...(stackContext !== undefined && { stackContext }),
    ...(stackProvider !== undefined && { stackProvider }),
    ...(resolvedLandingAction !== undefined && { landingAction: resolvedLandingAction }),
    ...(resolvedLandingAutoMerge !== undefined && { landingAutoMerge: resolvedLandingAutoMerge }),
    ...(prd.frontmatter.postMerge !== undefined && { postMergeCommands: prd.frontmatter.postMerge }),
  }))) {
    yield { ...event, sessionId: prdSessionId } as EforgeEvent;
    if (event.type === 'phase:end' && event.result.status === 'failed') buildFailed = true;
  }
  return buildFailed ? { status: 'failed', summary: 'Build failed' } : { status: 'completed', summary: 'Build complete' };
}

function* emitTerminalQueuedPrdEvents(prd: QueuedPrd, prdSessionId: string, result: SessionResult): Generator<EforgeEvent> {
  yield { type: 'session:end', sessionId: prdSessionId, result, timestamp: ts() } as EforgeEvent;
  yield { timestamp: ts(), type: 'queue:prd:complete', prdId: prd.id, status: result.status } as EforgeEvent;
}
// --- eforge:endregion phase-execution ---

function collectTrunkSyncEvents(result: TrunkSyncResult, planId: string): { events: EforgeEvent[]; failureSummary?: string } {
  const timestamp = ts();
  const events: EforgeEvent[] = [];
  for (const message of result.diagnostics) events.push({ timestamp, type: 'planning:progress', message } as EforgeEvent);
  for (const message of result.warnings) events.push({ timestamp, type: 'config:warning', message, source: 'trunk-sync' } as EforgeEvent);
  if (result.outcome !== 'failed') return { events };
  const failureSummary = result.warnings[0] ?? 'Trunk sync failed before compile';
  events.push({ timestamp, type: 'plan:status:change', planId, status: 'failed' } as EforgeEvent);
  events.push({ timestamp, type: 'plan:error:set', planId, error: failureSummary } as EforgeEvent);
  return { events, failureSummary };
}

function* yieldTrunkSyncEvents(result: TrunkSyncResult, planId: string): Generator<EforgeEvent, string | undefined> {
  const { events, failureSummary } = collectTrunkSyncEvents(result, planId);
  for (const event of events) yield event;
  return failureSummary;
}

function* emitPlanFailureEvents(planId: string, message: string): Generator<EforgeEvent> {
  yield { timestamp: ts(), type: 'plan:status:change', planId, status: 'failed' } as EforgeEvent;
  yield { timestamp: ts(), type: 'plan:error:set', planId, error: message } as EforgeEvent;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function ts(): string {
  return new Date().toISOString();
}
