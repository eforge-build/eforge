/**
 * Built-in build stages — all ten build stage registrations plus shared inner helpers.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { EforgeEvent, ReviewIssue } from '../../events.js';
import type { BuildStageSpec, ShardScope } from '../../config.js';
import { emitBuildDecision } from '../../decisions.js';
import { computeReviewThresholdSnapshot } from '../../agents/parallel-reviewer.js';
import {
  withRetry,
  DEFAULT_RETRY_POLICIES,
  EvaluatorNoVerdictsError,
  type RetryPolicy,
  type BuilderContinuationInput,
  type BuilderShardContinuationInput,
  type EvaluatorContinuationInput,
  type ReviewFixerContinuationInput,
  buildShardPolicy,
} from '../../retry.js';
import { builderImplement, builderEvaluate, type BuilderEvaluationResult } from '../../agents/builder.js';
import { runParallelReview } from '../../agents/parallel-reviewer.js';
import { selectNextReviewPerspectives, shouldTerminateCycleEarly } from '../../review-cycle-perspectives.js';
import { runReviewFixer } from '../../agents/review-fixer.js';
import { runValidationRepairFixer } from '../../agents/validation-fixer.js';
import { runDocAuthor } from '../../agents/doc-author.js';
import { runDocSyncer } from '../../agents/doc-syncer.js';
import { runTestWriter, runTester } from '../../agents/tester.js';
import { testIssueToReviewIssue } from '../../agents/common.js';
import { assignReviewIssueIds } from '../../review-issue-traceability.js';
import type { ResolvedAgentConfig } from '../../config.js';
import { runParallel } from '../../concurrency.js';
import { forgeCommit } from '../../git.js';
import { composeCommitMessage } from '../../model-tracker.js';
import {
  applyEvaluationVerdicts,
  assertNoEvaluationDrift,
  prepareEvaluationSnapshot,
  restoreEvaluationSnapshotAfterFailure,
  type EvaluationSnapshot,
  type EvaluationFileVerdictSummary,
} from '../../evaluation/index.js';
import { countEvaluationIssueOutcomes, type EvaluationIssueOutcomeCounts } from '../../evaluation/issue-outcomes.js';
import { captureEvaluationSnapshot, EvaluationInvariantError } from '../../evaluation/index.js';
import type { BuildStageContext } from '../types.js';
import { registerBuildStage } from '../registry.js';
import {
  runValidationProviderRecoveryStage,
  type ValidationRecoveryRepairContext,
} from './validation-provider-recovery.js';
import { resolveAgentConfig } from '../agent-config.js';
import { appendPromptSection, buildReviewCycleFeedback, getReviewCycleFeedback, renderReviewFixerEvaluatorFeedback, renderReviewerPriorOutcomeContext, setReviewCycleFeedback, summarizeEvaluationVerdicts } from '../review-cycle-feedback.js';
import { isMaxTurnsError } from '../../harness.js';
import { createToolTracker } from '../span-wiring.js';
import { withPeriodicFileCheck, emitFilesChanged, emitAgentActivity } from '../git-helpers.js';
import { toBuildFailedEvent } from '../error-translator.js';

const exec = promisify(execFile);

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function hasTestStages(build: BuildStageSpec[]): boolean {
  return build.some((spec) => {
    if (Array.isArray(spec)) return spec.some((s) => s.startsWith('test'));
    return spec.startsWith('test');
  });
}

async function hasEvaluationCandidateChanges(cwd: string): Promise<boolean> {
  try {
    const { stdout: tracked } = await exec('git', ['diff', '--name-only'], { cwd });
    if (tracked.trim().length > 0) return true;
    const { stdout: untracked } = await exec('git', ['ls-files', '--others', '--exclude-standard'], { cwd });
    return untracked.split('\n').some((path) => path.length > 0 && path !== '.eforge' && !path.startsWith('.eforge/'));
  } catch {
    return false;
  }
}

async function unstageEvaluationCandidateChanges(cwd: string): Promise<void> {
  try {
    await exec('git', ['diff', '--cached', '--quiet'], { cwd });
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    if (code === 1) {
      await exec('git', ['reset', '--mixed', 'HEAD'], { cwd });
      return;
    }
    throw err;
  }
}

/** Per-retry builder span + event processing. Span and tracker created per-attempt. */
async function* runBuilderAttempt(
  input: BuilderContinuationInput,
  ctx: BuildStageContext,
  agentConfig: ResolvedAgentConfig,
  parallelStages: string[][],
  verificationScope: 'build-only' | 'full',
): AsyncGenerator<EforgeEvent> {
  const implSpan = ctx.tracing.createSpan('builder', { planId: ctx.planId, phase: 'implement' });
  implSpan.setInput({ planId: ctx.planId, phase: 'implement' });
  const implTracker = createToolTracker(implSpan);
  const { harness: builderHarness, toolbeltSummary: builderTb } = ctx.agentRuntimes.forRoleResolved('builder', ctx.planFile);
  try {
    for await (const event of withPeriodicFileCheck(builderImplement(ctx.planFile, {
      cwd: ctx.worktreePath,
      verbose: ctx.verbose,
      abortController: ctx.abortController,
      ...agentConfig,
      ...builderTb,
      parallelStages,
      verificationScope,
      phase: 'build',
      stage: 'implement',
      ...(input.builderOptions.continuationContext && { continuationContext: input.builderOptions.continuationContext }),
      harness: builderHarness,
    }), ctx)) {
      implTracker.handleEvent(event);
      if (event.type === 'plan:build:failed') implSpan.error('Implementation failed');
      yield event;
    }
    implTracker.cleanup();
    implSpan.end();
  } catch (err) {
    implTracker.cleanup();
    implSpan.error(err as Error);
    throw err;
  }
}

/** Per-retry evaluator span + event processing. Span and tracker created per-attempt. */
function isRetryableNoVerdictsResult(
  result: BuilderEvaluationResult | undefined,
  input: EvaluatorContinuationInput,
): result is BuilderEvaluationResult {
  return result !== undefined &&
    !result.failed &&
    result.source === 'none' &&
    result.verdicts.length === 0 &&
    (input.evaluationSnapshot?.files.length ?? 0) > 0;
}

async function* runEvaluatorAttempt(
  input: EvaluatorContinuationInput,
  ctx: BuildStageContext,
  evalAgentConfig: ResolvedAgentConfig,
  strictness?: 'strict' | 'standard' | 'lenient',
): AsyncGenerator<EforgeEvent, BuilderEvaluationResult | undefined> {
  const evalSpan = ctx.tracing.createSpan('evaluator', { planId: ctx.planId });
  evalSpan.setInput({ planId: ctx.planId });
  const evalTracker = createToolTracker(evalSpan);
  const { harness: evaluatorHarness, toolbeltSummary: evaluatorTb } = ctx.agentRuntimes.forRoleResolved('evaluator', ctx.planFile);
  try {
    const continuationContext = input.evaluatorOptions.evaluatorContinuationContext as { attempt: number; maxContinuations: number } | undefined;
    const validationRepairContext = typeof input.evaluatorOptions.validationRepairContext === 'string'
      ? input.evaluatorOptions.validationRepairContext
      : undefined;
    const evaluator = builderEvaluate(ctx.planFile, {
      cwd: ctx.worktreePath,
      verbose: ctx.verbose,
      abortController: ctx.abortController,
      ...evalAgentConfig,
      ...evaluatorTb,
      strictness,
      phase: 'build',
      stage: 'evaluate',
      ...(continuationContext && { evaluatorContinuationContext: continuationContext }),
      ...(input.evaluationSnapshot && { evaluatorSnapshot: input.evaluationSnapshot }),
      ...(validationRepairContext !== undefined ? { validationRepairContext } : {}),
      ...(input.round !== undefined ? { round: input.round } : {}),
      preImplementCommit: ctx.preImplementCommit,
      harness: evaluatorHarness,
    });

    while (true) {
      const next = await evaluator.next();
      if (next.done) {
        const result = next.value;
        if (isRetryableNoVerdictsResult(result, input)) {
          throw new EvaluatorNoVerdictsError();
        }
        evalTracker.cleanup();
        evalSpan.end();
        return result;
      }
      const event = next.value;
      evalTracker.handleEvent(event);
      if (event.type === 'plan:build:failed') evalSpan.error('Evaluation failed');
      yield event;
    }
  } catch (err) {
    evalTracker.cleanup();
    evalSpan.error(err as Error);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Inner stage helpers (called by composite stages)
// ---------------------------------------------------------------------------

type LastBuildEvaluation = {
  ran: boolean;
  accepted: number;
  rejected: number;
  review: number;
  files: EvaluationFileVerdictSummary[];
} & EvaluationIssueOutcomeCounts;

type BuildStageContextWithEvaluation = BuildStageContext & {
  __plan02LastBuildEvaluation?: LastBuildEvaluation;
};

function setLastBuildEvaluation(ctx: BuildStageContext, evaluation: LastBuildEvaluation): void {
  (ctx as BuildStageContextWithEvaluation).__plan02LastBuildEvaluation = evaluation;
}

function getLastBuildEvaluation(ctx: BuildStageContext): LastBuildEvaluation | undefined {
  return (ctx as BuildStageContextWithEvaluation).__plan02LastBuildEvaluation;
}

function emptyIssueOutcomeCounts(): EvaluationIssueOutcomeCounts {
  return {
    resolvedIssueOutcomes: 0,
    falsePositiveIssueOutcomes: 0,
    unresolvedIssueOutcomes: 0,
    unresolvedNonBlockingIssueOutcomes: 0,
    needsHumanReviewIssueOutcomes: 0,
    acceptedRiskIssueOutcomes: 0,
    splitToFollowupIssueOutcomes: 0,
    blockingIssueOutcomes: 0,
  };
}

function lastBuildEvaluationNotRun(): LastBuildEvaluation {
  return { ran: false, accepted: 0, rejected: 0, review: 0, files: [], ...emptyIssueOutcomeCounts() };
}
function formatNoVerdictsFailureMessage(s: EvaluationSnapshot, r: string): string {
  const p = s.files.map((f) => f.path).join(', ');
  return p ? `${r} Candidate files with uncommitted changes: ${p}` : r;
}
async function restoreOriginalBuilderCommitState(snapshot: EvaluationSnapshot): Promise<void> {
  await restoreEvaluationSnapshotAfterFailure(snapshot);
  if (snapshot.originalHead) {
    await exec('git', ['reset', '--soft', snapshot.originalHead], { cwd: snapshot.cwd });
  }
}

async function restoreOriginalBuilderCommitStateUnlessDrifted(
  ctx: BuildStageContext,
  snapshot: EvaluationSnapshot,
): Promise<EforgeEvent | undefined> {
  try {
    await assertNoEvaluationDrift(snapshot);
  } catch (err) {
    try {
      await restoreOriginalBuilderCommitState(snapshot);
    } catch {
      // Preserve the drift error as the reported build failure.
    }
    ctx.buildFailed = true;
    return toBuildFailedEvent(ctx.planId, err);
  }
  await restoreOriginalBuilderCommitState(snapshot);
  return undefined;
}

type ReviewStageMetadata = {
  parallel: boolean;
  activePerspectives: string[];
  issuesByPerspective: Partial<Record<string, ReviewIssue[]>>;
  perspectiveErrors: string[];
  completeIssueCount: number;
};

async function* reviewStageInner(
  ctx: BuildStageContext,
  overrides?: { strategy?: 'auto' | 'single' | 'parallel'; perspectives?: string[]; round?: number },
): AsyncGenerator<EforgeEvent, ReviewStageMetadata> {
  const strategy = overrides?.strategy ?? ctx.review.strategy;
  const perspectives = overrides?.perspectives ?? (ctx.review.perspectives.length > 0 ? ctx.review.perspectives : undefined);
  const round = overrides?.round;
  const metadata: ReviewStageMetadata = {
    parallel: false,
    activePerspectives: [],
    issuesByPerspective: {},
    perspectiveErrors: [],
    completeIssueCount: 0,
  };

  // Emit review-strategy decision before dispatching to the reviewer
  if (strategy === 'auto') {
    const snapshot = await computeReviewThresholdSnapshot(ctx.worktreePath, ctx.orchConfig.diffBaseRef ?? ctx.orchConfig.baseBranch);
    yield emitBuildDecision(ctx, {
      kind: 'review-strategy',
      rationale: `Auto-threshold: ${snapshot.changedFiles.length} files, ${snapshot.changedLines} changed lines (threshold: ${snapshot.threshold.files} files or ${snapshot.threshold.lines} lines)`,
      strategy: snapshot.willParallelize ? 'parallel' : 'single',
      source: 'auto-threshold',
      auto: {
        files: snapshot.changedFiles.length,
        lines: snapshot.changedLines,
        threshold: snapshot.threshold,
      },
    });
  } else {
    yield emitBuildDecision(ctx, {
      kind: 'review-strategy',
      rationale: `Strategy set by config: ${strategy}`,
      strategy: strategy === 'parallel' ? 'parallel' : 'single',
      source: 'config',
    });
  }

  const { harness: reviewerHarness, toolbeltSummary: reviewerTb } = ctx.agentRuntimes.forRoleResolved('reviewer', ctx.planFile);
  const reviewerAgentConfig = resolveAgentConfig('reviewer', ctx.config, ctx.planFile, reviewerTb);
  const reviewerPromptAppend = appendPromptSection(reviewerAgentConfig.promptAppend, renderReviewerPriorOutcomeContext(getReviewCycleFeedback(ctx)));
  const reviewSpan = ctx.tracing.createSpan('reviewer', { planId: ctx.planId, phase: 'review' });
  reviewSpan.setInput({ planId: ctx.planId, phase: 'review' });
  const reviewTracker = createToolTracker(reviewSpan);

  // Capture a worktree snapshot before dispatching reviewers so we can detect
  // and discard any mutations they make (reviewers must be non-mutating).
  // Non-git directories (e.g. narrow unit tests) cannot be snapshotted, but a
  // real git worktree that fails snapshot capture must fail closed.
  let reviewWorktreeSnapshot: EvaluationSnapshot | undefined;
  try {
    reviewWorktreeSnapshot = await captureEvaluationSnapshot(ctx.worktreePath);
  } catch (snapshotErr) {
    let isGitWorktree = false;
    try {
      const { stdout } = await exec('git', ['rev-parse', '--is-inside-work-tree'], { cwd: ctx.worktreePath });
      isGitWorktree = stdout.trim() === 'true';
    } catch {
      // Not a git repository — reviewer drift detection is skipped.
    }
    if (isGitWorktree) {
      reviewTracker.cleanup();
      reviewSpan.error(snapshotErr as Error);
      ctx.buildFailed = true;
      yield toBuildFailedEvent(ctx.planId, snapshotErr);
      return metadata;
    }
  }
  // Buffer the aggregate complete event; yield lifecycle/perspective events normally.
  let bufferedReviewComplete: Extract<EforgeEvent, { type: 'plan:build:review:complete' }> | undefined;

  try {
    for await (const event of runParallelReview({
      planContent: ctx.planFile.body,
      baseBranch: ctx.orchConfig.diffBaseRef ?? ctx.orchConfig.baseBranch,
      planId: ctx.planId,
      cwd: ctx.worktreePath,
      verbose: ctx.verbose,
      abortController: ctx.abortController,
      strategy,
      perspectives,
      extensionReviewerPerspectives: ctx.extensionReviewerPerspectives,
      extensionApplicabilityTimeoutMs: ctx.config.extensions.eventHookTimeoutMs,
      ...(round !== undefined ? { round } : {}),
      ...reviewerAgentConfig,
      promptAppend: reviewerPromptAppend,
      phase: 'build',
      stage: 'review',
      harness: reviewerHarness,
    })) {
      reviewTracker.handleEvent(event);
      if (event.type === 'plan:build:review:complete') {
        // Buffer — yield after drift check below.
        bufferedReviewComplete = event;
      } else {
        yield event;
      }
      if (event.type === 'plan:build:review:parallel:start') {
        metadata.parallel = true;
        metadata.activePerspectives = event.perspectives;
      }
      if (event.type === 'plan:build:review:parallel:perspective:complete') {
        metadata.issuesByPerspective[event.perspective] = event.issues;
      }
      if (event.type === 'plan:build:review:parallel:perspective:error') {
        metadata.perspectiveErrors.push(event.perspective);
      }
    }
    reviewTracker.cleanup();
    reviewSpan.end();
  } catch (err) {
    reviewTracker.cleanup();
    reviewSpan.error(err as Error);
    // Reviewer agent failed without emitting plan:build:review:complete — inject a
    // synthetic critical issue so the current review cannot be mistaken for stale
    // issues from an earlier stage or for a clean no-issues result. Continue to
    // the drift check below so any reviewer-side mutations made before the
    // failure are restored before review-fixer/evaluator stages run.
    const failureIssues: ReviewIssue[] = [{
      severity: 'critical',
      category: 'review-contract',
      file: 'reviewer-output',
      description: `Reviewer agent failed: ${err instanceof Error ? err.message : String(err)}`,
    }];
    ctx.reviewIssues = failureIssues;
    metadata.completeIssueCount = failureIssues.length;
    bufferedReviewComplete = {
      timestamp: new Date().toISOString(),
      type: 'plan:build:review:complete',
      planId: ctx.planId,
      issues: failureIssues,
      ...(round !== undefined ? { round } : {}),
    };
  }

  // Check for reviewer-introduced worktree mutations and restore if found.
  let driftIssue: ReviewIssue | undefined;
  if (reviewWorktreeSnapshot !== undefined) {
    try {
      await assertNoEvaluationDrift(reviewWorktreeSnapshot);
    } catch (driftErr) {
      const driftDescription = driftErr instanceof EvaluationInvariantError || driftErr instanceof Error
        ? driftErr.message
        : String(driftErr);
      driftIssue = {
        severity: 'critical',
        category: 'review-contract',
        file: 'reviewer-output',
        description: `Reviewer agent mutated the worktree: ${driftDescription}`,
      };
      try {
        await restoreEvaluationSnapshotAfterFailure(reviewWorktreeSnapshot);
      } catch (restoreErr) {
        // Restoration failed — the worktree is in an unknown state.  Fail the
        // build so mutated reviewer work cannot silently reach evaluation.
        ctx.buildFailed = true;
        yield toBuildFailedEvent(ctx.planId, restoreErr);
        return metadata;
      }
    }
  }

  // Augment the buffered complete event with the drift issue (if any), then yield it.
  const finalIssues = driftIssue ? [...(bufferedReviewComplete?.issues ?? []), driftIssue] : (bufferedReviewComplete?.issues ?? []);
  const finalIssuesWithIds = assignReviewIssueIds(finalIssues, { round, lane: 'review-contract' });

  const completeEvent: Extract<EforgeEvent, { type: 'plan:build:review:complete' }> = bufferedReviewComplete
    ? { ...bufferedReviewComplete, issues: finalIssuesWithIds }
    : { timestamp: new Date().toISOString(), type: 'plan:build:review:complete', planId: ctx.planId, issues: finalIssuesWithIds, ...(round !== undefined ? { round } : {}) };

  ctx.reviewIssues = completeEvent.issues;
  metadata.completeIssueCount = completeEvent.issues.length;
  yield completeEvent;

  return metadata;
}

async function* evaluateStageInner(
  ctx: BuildStageContext,
  overrides?: { strictness?: 'strict' | 'standard' | 'lenient'; round?: number; validationRepairContext?: ValidationRecoveryRepairContext },
): AsyncGenerator<EforgeEvent> {
  try {
    await unstageEvaluationCandidateChanges(ctx.worktreePath);
  } catch (err) {
    yield toBuildFailedEvent(ctx.planId, err);
    ctx.buildFailed = true;
    return;
  }

  if (!(await hasEvaluationCandidateChanges(ctx.worktreePath))) {
    setLastBuildEvaluation(ctx, lastBuildEvaluationNotRun());
    return;
  }

  let snapshot: EvaluationSnapshot;
  try {
    snapshot = await prepareEvaluationSnapshot(ctx.worktreePath, ctx.preImplementCommit ?? 'HEAD~1');
  } catch (err) {
    yield toBuildFailedEvent(ctx.planId, err);
    ctx.buildFailed = true;
    return;
  }

  if (snapshot.files.length === 0) {
    await restoreOriginalBuilderCommitState(snapshot);
    setLastBuildEvaluation(ctx, lastBuildEvaluationNotRun());
    return;
  }

  const strictness = overrides?.strictness ?? ctx.review.evaluatorStrictness;
  const round = overrides?.round;

  // Emit evaluator-strictness decision at the start of every evaluator run
  // source is 'default' when the value is 'standard' and no explicit override was provided,
  // otherwise 'config' (user-configured or stage-level override)
  const strictnessSource: 'config' | 'default' =
    overrides?.strictness === undefined && strictness === 'standard' ? 'default' : 'config';
  yield emitBuildDecision(ctx, {
    kind: 'evaluator-strictness',
    rationale: `Evaluator strictness: ${strictness} (${strictnessSource})`,
    strictness,
    source: strictnessSource,
  });

  const evalAgentConfig = resolveAgentConfig('evaluator', ctx.config, ctx.planFile);
  const initialInput: EvaluatorContinuationInput = {
    worktreePath: ctx.worktreePath,
    planId: ctx.planId,
    ...(round !== undefined ? { round } : {}),
    evaluationSnapshot: snapshot,
    evaluatorOptions: {
      ...(overrides?.validationRepairContext ? { validationRepairContext: overrides.validationRepairContext.promptContext } : {}),
    },
  };
  const evaluatorPolicy = DEFAULT_RETRY_POLICIES.evaluator as RetryPolicy<EvaluatorContinuationInput>;
  let result: BuilderEvaluationResult | undefined;
  let suppressedTerminalFailure: Extract<EforgeEvent, { type: 'plan:build:failed' }> | undefined;

  try {
    const evaluator = withRetry<EvaluatorContinuationInput, BuilderEvaluationResult | undefined>(
      (input) => runEvaluatorAttempt(input, ctx, evalAgentConfig, strictness),
      evaluatorPolicy,
      initialInput,
    );
    while (true) {
      const next = await evaluator.next();
      if (next.done) {
        result = next.value;
        break;
      }
      const event = next.value;
      if (event.type === 'plan:build:failed' && event.terminalSubtype) {
        suppressedTerminalFailure = event;
        continue;
      }
      yield event;
    }
  } catch (err) {
    const driftFailure = await restoreOriginalBuilderCommitStateUnlessDrifted(ctx, snapshot);
    if (driftFailure) {
      yield driftFailure;
      return;
    }
    yield { timestamp: new Date().toISOString(), type: 'plan:build:failed', planId: ctx.planId, error: formatNoVerdictsFailureMessage(snapshot, err instanceof Error ? err.message : String(err)) } as EforgeEvent;
    ctx.buildFailed = true;
    return;
  }

  if (!result || result.failed || result.verdicts.length === 0) {
    const driftFailure = await restoreOriginalBuilderCommitStateUnlessDrifted(ctx, snapshot);
    if (driftFailure) {
      yield driftFailure;
      return;
    }
    yield { timestamp: new Date().toISOString(), type: 'plan:build:failed', planId: ctx.planId, error: formatNoVerdictsFailureMessage(snapshot, suppressedTerminalFailure?.error ?? result?.error ?? 'Evaluator produced no verdicts; review-fixer changes remain uncommitted.') } as EforgeEvent;
    ctx.buildFailed = true;
    return;
  }

  try {
    const application = await applyEvaluationVerdicts(snapshot, result.verdicts, {
      commitMessage: `feat(${ctx.planId}): ${ctx.planFile.name}`,
      modelTracker: ctx.modelTracker,
    });
    ctx.reviewIssues = [];
    const issueOutcomeCounts = countEvaluationIssueOutcomes(result.verdicts);
    setReviewCycleFeedback(ctx, buildReviewCycleFeedback(result.verdicts));
    setLastBuildEvaluation(ctx, {
      ran: true,
      accepted: application.accepted,
      rejected: application.rejected,
      review: application.review,
      files: application.files,
      ...issueOutcomeCounts,
    });
    yield {
      timestamp: new Date().toISOString(),
      type: 'plan:build:evaluate:complete',
      planId: ctx.planId,
      accepted: application.accepted,
      rejected: application.rejected,
      ...issueOutcomeCounts,
      verdicts: summarizeEvaluationVerdicts(result.verdicts),
      ...(round !== undefined ? { round } : {}),
    };
  } catch (err) {
    try {
      await restoreOriginalBuilderCommitState(snapshot);
    } catch {
      // Preserve the deterministic application failure as the reported error.
    }
    yield toBuildFailedEvent(ctx.planId, err);
    ctx.buildFailed = true;
  }
}

/** Per-retry review-fixer span + event processing. Span and tracker created per attempt. */
async function* runReviewFixerAttempt(
  input: ReviewFixerContinuationInput,
  ctx: BuildStageContext,
  onAgentId: (id: string) => void,
  validationRepairContext?: ValidationRecoveryRepairContext,
): AsyncGenerator<EforgeEvent> {
  const { harness: fixerHarness, toolbeltSummary: fixerTb } = ctx.agentRuntimes.forRoleResolved('review-fixer', ctx.planFile);
  const fixerConfig = resolveAgentConfig('review-fixer', ctx.config, ctx.planFile, fixerTb);
  const fixerConfigWithPhase = { ...fixerConfig, phase: 'build', stage: 'review-fix' };
  const fixSpan = ctx.tracing.createSpan('review-fixer', { planId: ctx.planId });
  fixSpan.setInput({ planId: ctx.planId, issueCount: ctx.reviewIssues.length });
  const fixTracker = createToolTracker(fixSpan);
  try {
    for await (const event of withPeriodicFileCheck(runReviewFixer({
      planId: input.planId,
      cwd: input.cwd,
      issues: ctx.reviewIssues,
      evaluatorFeedbackContext: renderReviewFixerEvaluatorFeedback(getReviewCycleFeedback(ctx)),
      validationRepairContext: validationRepairContext?.promptContext,
      ...(input.round !== undefined ? { round: input.round } : {}),
      verbose: ctx.verbose,
      abortController: ctx.abortController,
      ...fixerConfigWithPhase,
      harness: fixerHarness,
      ...(input.reviewFixerOptions.continuationContext !== undefined
        ? { continuationContext: input.reviewFixerOptions.continuationContext }
        : {}),
    }), ctx)) {
      if (event.type === 'agent:start' && event.agent === 'review-fixer') {
        onAgentId(event.agentId);
      }
      fixTracker.handleEvent(event);
      yield event;
    }
    fixTracker.cleanup();
    fixSpan.end();
  } catch (err) {
    fixTracker.cleanup();
    fixSpan.error(err as Error);
    throw err;
  }
}

async function* reviewFixStageInner(
  ctx: BuildStageContext,
  options?: { round?: number; validationRepairContext?: ValidationRecoveryRepairContext },
): AsyncGenerator<EforgeEvent> {
  if (ctx.reviewIssues.length === 0) return;

  // Snapshot HEAD at stage entry — used as baseRef for agent:activity attribution
  let fixerBaseRef: string | undefined;
  try {
    const { stdout } = await exec('git', ['rev-parse', 'HEAD'], { cwd: ctx.worktreePath });
    fixerBaseRef = stdout.trim();
  } catch {
    // Not available — skip activity emission
  }

  let fixerAgentId: string | undefined;

  // Resolve maxContinuations: per-plan > global config > default (3)
  const maxContinuations = ctx.planEntry?.maxContinuations ?? ctx.config.agents.maxContinuations;
  const reviewFixerPolicy: RetryPolicy<ReviewFixerContinuationInput> = {
    ...(DEFAULT_RETRY_POLICIES['review-fixer'] as RetryPolicy<ReviewFixerContinuationInput>),
    maxAttempts: maxContinuations + 1,
  };
  const initialInput: ReviewFixerContinuationInput = {
    cwd: ctx.worktreePath,
    planId: ctx.planId,
    ...(options?.round !== undefined ? { round: options.round } : {}),
    reviewFixerOptions: {},
  };

  try {
    for await (const event of withRetry(
      (input) => runReviewFixerAttempt(input, ctx, (id) => { fixerAgentId = id; }, options?.validationRepairContext),
      reviewFixerPolicy,
      initialInput,
    )) {
      yield event;
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw err;
    // When retry budget is exhausted on max-turns, emit a non-fatal warning
    if (isMaxTurnsError(err)) {
      yield {
        timestamp: new Date().toISOString(),
        type: 'agent:warning',
        agent: 'review-fixer',
        agentId: fixerAgentId ?? 'review-fixer-unknown',
        code: 'review-fixer-retry-budget-exhausted',
        message: `Review fixer exhausted all ${reviewFixerPolicy.maxAttempts} attempt(s) without completing all fixes. Partial fixes may be present in the working tree.`,
      };
    }
    // All other errors are non-fatal — swallow silently
  }

  // Emit agent:activity for the review fixer with exact attribution.
  // The review-fixer does NOT commit — its changes live in the working tree,
  // so we must diff against the working tree (not baseRef...HEAD).
  if (fixerAgentId && fixerBaseRef) {
    try {
      const activityEvent = await emitAgentActivity({
        cwd: ctx.worktreePath,
        baseRef: fixerBaseRef,
        planId: ctx.planId,
        agentId: fixerAgentId,
        agent: 'review-fixer',
        attribution: 'exact',
        mode: 'working-tree',
      });
      if (activityEvent) yield activityEvent;
    } catch {
      // Non-critical — skip silently
    }
  }
}
async function* structuralValidationFixStageInner(ctx: BuildStageContext, validationRepairContext: ValidationRecoveryRepairContext): AsyncGenerator<EforgeEvent> {
  let baseRef: string | undefined; let agentId: string | undefined;
  try { baseRef = (await exec('git', ['rev-parse', 'HEAD'], { cwd: ctx.worktreePath })).stdout.trim(); } catch { /* non-git unit contexts skip commit rollback/activity */ }
  const { harness: fixerHarness, toolbeltSummary: fixerTb } = ctx.agentRuntimes.forRoleResolved('validation-fixer', ctx.planFile); const fixerConfig = { ...resolveAgentConfig('validation-fixer', ctx.config, ctx.planFile, fixerTb), phase: 'build', stage: 'validate-repair' };
  const span = ctx.tracing.createSpan('validation-fixer', { planId: ctx.planId, providerName: validationRepairContext.providerName });
  span.setInput({ planId: ctx.planId, providerName: validationRepairContext.providerName, repairStrategy: validationRepairContext.repairStrategy }); const tracker = createToolTracker(span);
  yield { timestamp: new Date().toISOString(), type: 'plan:build:progress', planId: ctx.planId, message: `Running structural validation repair for provider "${validationRepairContext.providerName}". Checkpoint: ${validationRepairContext.checkpoint.directory}` };
  try {
    const repair = runValidationRepairFixer({ cwd: ctx.worktreePath, planId: ctx.planId, validationRepairContext: validationRepairContext.promptContext, attempt: validationRepairContext.attempt, maxAttempts: validationRepairContext.maxAttempts, verbose: ctx.verbose, abortController: ctx.abortController, ...fixerConfig, harness: fixerHarness });
    for await (const event of withPeriodicFileCheck(repair, ctx)) {
      if (event.type === 'agent:start' && event.agent === 'validation-fixer') agentId = event.agentId;
      tracker.handleEvent(event); yield event;
    }
    tracker.cleanup(); span.end();
  } catch (err) {
    tracker.cleanup(); span.error(err as Error);
    if (err instanceof Error && err.name === 'AbortError') throw err;
    yield toBuildFailedEvent(ctx.planId, err); ctx.buildFailed = true; return;
  }
  if (baseRef) try {
    const currentHead = (await exec('git', ['rev-parse', 'HEAD'], { cwd: ctx.worktreePath })).stdout.trim();
    if (currentHead !== baseRef) {
      await exec('git', ['reset', '--soft', baseRef], { cwd: ctx.worktreePath });
      yield { timestamp: new Date().toISOString(), type: 'plan:build:progress', planId: ctx.planId, message: 'Validation-fixer created a commit during in-build repair; reset it to leave candidate edits for evaluation.' };
    }
  } catch (err) { yield toBuildFailedEvent(ctx.planId, err); ctx.buildFailed = true; return; }
  try { await unstageEvaluationCandidateChanges(ctx.worktreePath); } catch (err) { yield toBuildFailedEvent(ctx.planId, err); ctx.buildFailed = true; return; }
  if (agentId && baseRef) try {
    const activity = await emitAgentActivity({ cwd: ctx.worktreePath, baseRef, planId: ctx.planId, agentId, agent: 'validation-fixer', attribution: 'exact', mode: 'working-tree' }); if (activity) yield activity;
  } catch { /* non-critical */ }
}

async function* testStageInner(ctx: BuildStageContext): AsyncGenerator<EforgeEvent> {
  const { harness: testerHarness, toolbeltSummary: testerTb } = ctx.agentRuntimes.forRoleResolved('tester', ctx.planFile);
  const agentConfig = resolveAgentConfig('tester', ctx.config, ctx.planFile, testerTb);
  const span = ctx.tracing.createSpan('tester', { planId: ctx.planId });
  span.setInput({ planId: ctx.planId });
  const tracker = createToolTracker(span);
  try {
    for await (const event of withPeriodicFileCheck(runTester({
      cwd: ctx.worktreePath,
      planId: ctx.planId,
      planContent: ctx.planFile.body,
      verbose: ctx.verbose,
      abortController: ctx.abortController,
      ...agentConfig,
      phase: 'build',
      stage: 'test',
      harness: testerHarness,
    }), ctx)) {
      tracker.handleEvent(event);
      yield event;
      if (event.type === 'plan:build:test:complete') {
        ctx.reviewIssues = event.productionIssues.map(testIssueToReviewIssue);
      }
    }
    tracker.cleanup();
    span.end();
  } catch (err) {
    tracker.cleanup();
    span.error(err as Error);
    if (err instanceof Error && err.name === 'AbortError') throw err;
  }
}

// ---------------------------------------------------------------------------
// Shard helpers
// ---------------------------------------------------------------------------

/**
 * Determine whether a shard claims a given file path.
 * Roots are matched by path prefix (with or without trailing slash).
 * Files are matched by exact path.
 */
function shardClaimsFile(shard: ShardScope, file: string): boolean {
  if (shard.roots) {
    for (const root of shard.roots) {
      const prefix = root.endsWith('/') ? root : `${root}/`;
      if (file.startsWith(prefix) || file === root) return true;
    }
  }
  if (shard.files) {
    for (const f of shard.files) {
      if (file === f) return true;
    }
  }
  return false;
}

/**
 * Enforce that all staged files are claimed by exactly one shard.
 * Returns ok:true when all files match exactly one shard.
 * Returns ok:false with reason and offending files when:
 * - 'unclaimed': a file is not claimed by any shard
 * - 'overlap': a file is claimed by multiple shards (includes claiming shard IDs)
 */
export function enforceShardScope(
  stagedFiles: string[],
  shards: ShardScope[],
): { ok: true } | { ok: false; reason: 'unclaimed' | 'overlap'; files: string[]; shardIds?: string[][] } {
  const unclaimedFiles: string[] = [];
  const overlappingFiles: string[] = [];
  const overlappingShardIds: string[][] = [];

  for (const file of stagedFiles) {
    const claimingShards = shards.filter((s) => shardClaimsFile(s, file));
    if (claimingShards.length === 0) {
      unclaimedFiles.push(file);
    } else if (claimingShards.length > 1) {
      overlappingFiles.push(file);
      overlappingShardIds.push(claimingShards.map((s) => s.id));
    }
  }

  if (unclaimedFiles.length > 0) {
    return { ok: false, reason: 'unclaimed', files: unclaimedFiles };
  }
  if (overlappingFiles.length > 0) {
    return { ok: false, reason: 'overlap', files: overlappingFiles, shardIds: overlappingShardIds };
  }
  return { ok: true };
}


/** Per-shard-attempt span + event processing. Creates a new span per attempt. */
async function* runBuilderShardAttempt(
  input: BuilderShardContinuationInput,
  ctx: BuildStageContext,
  agentConfig: ResolvedAgentConfig,
  parallelStages: string[][],
): AsyncGenerator<EforgeEvent> {
  const implSpan = ctx.tracing.createSpan('builder', { planId: ctx.planId, phase: 'implement', shardId: input.shardId });
  implSpan.setInput({ planId: ctx.planId, phase: 'implement', shardId: input.shardId });
  const implTracker = createToolTracker(implSpan);
  const { harness: shardBuilderHarness, toolbeltSummary: shardBuilderTb } = ctx.agentRuntimes.forRoleResolved('builder');
  try {
    for await (const event of withPeriodicFileCheck(builderImplement(ctx.planFile, {
      cwd: ctx.worktreePath,
      verbose: ctx.verbose,
      abortController: ctx.abortController,
      ...agentConfig,
      ...shardBuilderTb,
      parallelStages,
      phase: 'build',
      stage: 'implement',
      // verificationScope is intentionally omitted: shardScope instructs the agent not to verify
      shardScope: input.shardScope,
      ...(input.builderOptions.continuationContext && { continuationContext: input.builderOptions.continuationContext }),
      harness: shardBuilderHarness,
    }), ctx)) {
      implTracker.handleEvent(event);
      if (event.type === 'plan:build:failed') implSpan.error('Shard implementation failed');
      yield event;
    }
    implTracker.cleanup();
    implSpan.end();
  } catch (err) {
    implTracker.cleanup();
    implSpan.error(err as Error);
    throw err;
  }
}

/** Run a single shard with its own retry policy. Yields all events including plan:build:failed on exhaustion. */
async function* runShardAttempt(
  shard: ShardScope,
  ctx: BuildStageContext,
  agentConfig: ResolvedAgentConfig,
  parallelStages: string[][],
  maxContinuations: number,
): AsyncGenerator<EforgeEvent> {
  const shardPolicy = buildShardPolicy(shard.id, maxContinuations + 1);

  const initialInput: BuilderShardContinuationInput = {
    worktreePath: ctx.worktreePath,
    baseBranch: ctx.orchConfig.diffBaseRef ?? ctx.orchConfig.baseBranch,
    planId: ctx.planId,
    shardId: shard.id,
    shardScope: shard,
    builderOptions: {},
  };

  try {
    for await (const event of withRetry(
      (input) => runBuilderShardAttempt(input, ctx, agentConfig, parallelStages),
      shardPolicy,
      initialInput,
    )) {
      yield event;
    }
  } catch (err) {
    yield toBuildFailedEvent(ctx.planId, err);
  }
}

// ---------------------------------------------------------------------------
// Built-in Build Stages
// ---------------------------------------------------------------------------

registerBuildStage({
  name: 'implement',
  phase: 'build',
  description: 'Runs the builder agent to implement the plan in a worktree with continuation support.',
  whenToUse: 'Always included as the first build stage. This is where actual code changes are made.',
  costHint: 'high',
  parallelizable: false,
}, async function* implementStage(ctx) {
  // Capture the current HEAD before the builder commits — used by the evaluator as reset target
  try {
    const { stdout } = await exec('git', ['rev-parse', 'HEAD'], { cwd: ctx.worktreePath });
    ctx.preImplementCommit = stdout.trim();
  } catch {
    // Fresh repo or no commits — evaluator will fall back to HEAD~1
  }

  // Resolve maxContinuations: per-plan > global config > default (3)
  const baseAgentConfig = resolveAgentConfig('builder', ctx.config, ctx.planFile);
  // Inject resume context into the builder prompt when resuming a compiled build.
  const agentConfig = ctx.resumeContext
    ? {
        ...baseAgentConfig,
        promptAppend: [baseAgentConfig.promptAppend, ctx.resumeContext].filter(Boolean).join('\n\n'),
      }
    : baseAgentConfig;
  const maxContinuations = ctx.planEntry?.maxContinuations ?? ctx.config.agents.maxContinuations;
  const parallelStages = ctx.build.filter((spec): spec is string[] => Array.isArray(spec));
  const verificationScope = hasTestStages(ctx.build) ? 'build-only' : 'full';

  const shards = agentConfig.shards;

  if (!shards || shards.length === 0) {
    // -----------------------------------------------------------------------
    // Single-builder flow (unchanged from before sharding was added)
    // -----------------------------------------------------------------------
    const initialInput: BuilderContinuationInput = {
      worktreePath: ctx.worktreePath,
      baseBranch: ctx.orchConfig.diffBaseRef ?? ctx.orchConfig.baseBranch,
      planId: ctx.planId,
      builderOptions: {},
    };

    // Policy with a per-plan override for maxAttempts (prior behavior: maxContinuations + 1).
    const builderPolicy: RetryPolicy<BuilderContinuationInput> = {
      ...(DEFAULT_RETRY_POLICIES.builder as RetryPolicy<BuilderContinuationInput>),
      maxAttempts: maxContinuations + 1,
    };

    let lastBuilderAgentId: string | undefined;

    try {
      for await (const event of withRetry(
        (input) => runBuilderAttempt(input, ctx, agentConfig, parallelStages, verificationScope),
        builderPolicy,
        initialInput,
      )) {
        if (event.type === 'agent:start' && event.agent === 'builder') {
          lastBuilderAgentId = event.agentId;
        }
        if (event.type === 'plan:build:failed') {
          yield event;
          ctx.buildFailed = true;
          return;
        }
        yield event;
      }
    } catch (err) {
      yield toBuildFailedEvent(ctx.planId, err);
      ctx.buildFailed = true;
      return;
    }

    // Emit agent:activity for the single builder with exact attribution
    if (lastBuilderAgentId && ctx.preImplementCommit) {
      try {
        const activityEvent = await emitAgentActivity({
          cwd: ctx.worktreePath,
          baseRef: ctx.preImplementCommit,
          planId: ctx.planId,
          agentId: lastBuilderAgentId,
          agent: 'builder',
          attribution: 'exact',
        });
        if (activityEvent) yield activityEvent;
      } catch {
        // Non-critical — skip silently
      }
    }
  } else {
    // -----------------------------------------------------------------------
    // Sharded flow: fan out to N parallel builders, then coordinator phase
    // -----------------------------------------------------------------------
    let anyShardFailed = false;

    // Track the last builder agentId seen per shard for agent:activity emission
    const shardAgentIds = new Map<string, string>();

    const tasks = shards.map((shard) => ({
      id: shard.id,
      run: (): AsyncGenerator<EforgeEvent> => {
        async function* trackShardAgentId() {
          for await (const event of runShardAttempt(shard, ctx, agentConfig, parallelStages, maxContinuations)) {
            if (event.type === 'agent:start' && event.agent === 'builder') {
              shardAgentIds.set(shard.id, event.agentId);
            }
            yield event;
          }
        }
        return trackShardAgentId();
      },
    }));

    // Fan out: run all shards concurrently, collecting events
    for await (const event of runParallel(tasks, { parallelism: shards.length })) {
      if (event.type === 'plan:build:failed') {
        anyShardFailed = true;
      }
      yield event;
    }

    if (anyShardFailed) {
      ctx.buildFailed = true;
      return;
    }

    // -----------------------------------------------------------------------
    // Coordinator phase: scope enforcement → verification → single commit
    // -----------------------------------------------------------------------

    // Safety sweep: stage any working-tree changes left unstaged by shard agents so
    // they are visible to scope enforcement rather than silently dropped or bypassed.
    try {
      await exec('git', ['add', '-A'], { cwd: ctx.worktreePath });
    } catch (err) {
      yield toBuildFailedEvent(ctx.planId, err);
      ctx.buildFailed = true;
      return;
    }

    // Scope enforcement: every staged file must be claimed by exactly one shard
    try {
      const { stdout: stagedOut } = await exec('git', ['diff', '--cached', '--name-only'], { cwd: ctx.worktreePath });
      const stagedFiles = stagedOut.trim().split('\n').filter(Boolean);

      if (stagedFiles.length > 0) {
        const scopeResult = enforceShardScope(stagedFiles, shards);
        if (!scopeResult.ok) {
          let errorMsg: string;
          if (scopeResult.reason === 'unclaimed') {
            errorMsg = `Shard scope enforcement failed: files staged outside any shard scope: ${scopeResult.files.join(', ')}`;
          } else {
            const fileList = scopeResult.files.map((f, i) => {
              const ids = scopeResult.shardIds?.[i]?.join(', ') ?? '?';
              return `${f} (claimed by: ${ids})`;
            }).join(', ');
            errorMsg = `Shard scope enforcement failed: files claimed by multiple shards: ${fileList}`;
          }
          yield { timestamp: new Date().toISOString(), type: 'plan:build:failed', planId: ctx.planId, error: errorMsg };
          ctx.buildFailed = true;
          return;
        }
      }
    } catch (err) {
      yield toBuildFailedEvent(ctx.planId, err);
      ctx.buildFailed = true;
      return;
    }

    // Single coordinator commit
    try {
      const commitMsg = `feat(${ctx.planId}): ${ctx.planFile.name}`;
      await forgeCommit(ctx.worktreePath, composeCommitMessage(commitMsg, ctx.modelTracker));
    } catch (err) {
      yield toBuildFailedEvent(ctx.planId, err);
      ctx.buildFailed = true;
      return;
    }

    // Emit agent:activity for each shard after the coordinator commit.
    // Scope enforcement already verified that every staged file belongs to exactly
    // one shard, so we filter to this shard's files and attribute them as 'exact'.
    // Totals are re-derived from the filtered set so each shard only reports its own
    // contribution rather than the whole-build total.
    if (ctx.preImplementCommit) {
      for (const shard of shards) {
        const shardAgentId = shardAgentIds.get(shard.id);
        if (!shardAgentId) continue;
        try {
          const activityEvent = await emitAgentActivity({
            cwd: ctx.worktreePath,
            baseRef: ctx.preImplementCommit,
            planId: ctx.planId,
            agentId: shardAgentId,
            agent: 'builder',
            attribution: 'exact',
            filter: (f) => shardClaimsFile(shard, f.path),
          });
          if (activityEvent) yield activityEvent;
        } catch {
          // Non-critical — skip silently
        }
      }
    }

    yield { timestamp: new Date().toISOString(), type: 'plan:build:implement:complete', planId: ctx.planId };
  }

  yield* emitFilesChanged(ctx);
});

registerBuildStage({
  name: 'review',
  phase: 'build',
  description: 'Runs a single code review pass identifying issues in the implementation.',
  whenToUse: 'When a single review pass is sufficient. For iterative review-fix cycles, use review-cycle instead.',
  costHint: 'medium',
  predecessors: ['implement'],
}, async function* reviewStage(ctx) {
  yield* reviewStageInner(ctx);
});

registerBuildStage({
  name: 'evaluate',
  phase: 'build',
  description: 'Evaluates unstaged changes from review/fixer, accepting or rejecting each change.',
  whenToUse: 'After review-fix to gate which reviewer suggestions are kept. Used within review-cycle.',
  costHint: 'medium',
  predecessors: ['implement'],
}, async function* evaluateStage(ctx) {
  yield* evaluateStageInner(ctx);
});

registerBuildStage({
  name: 'review-fix',
  phase: 'build',
  description: 'Applies fixes for review issues identified by the reviewer agent.',
  whenToUse: 'After review to fix identified issues. Typically used within review-cycle rather than standalone.',
  costHint: 'medium',
  predecessors: ['implement'],
}, async function* reviewFixStage(ctx) {
  yield* reviewFixStageInner(ctx);
});

registerBuildStage({
  name: 'review-cycle',
  phase: 'build',
  description: 'Runs iterative review-fix-evaluate rounds up to maxRounds, stopping when no actionable issues remain.',
  whenToUse: 'For quality-critical implementations. Combines review, review-fix, and evaluate into an iterative loop.',
  costHint: 'high',
  predecessors: ['implement'],
  conflictsWith: ['review'],
  parallelizable: false,
}, async function* reviewCycleStage(ctx) {
  const maxRounds = ctx.review.maxRounds;
  const strategy = ctx.review.strategy;
  const strictness = ctx.review.evaluatorStrictness;
  const initialConfiguredPerspectives: string[] | undefined = ctx.review.perspectives.length > 0 ? ctx.review.perspectives : undefined;
  let initialPerspectiveOrder: string[] | undefined = initialConfiguredPerspectives;
  let activePerspectivesForRound: string[] | undefined = initialConfiguredPerspectives;
  let droppedForRound: string[] = [];
  let adaptiveRationaleForRound: string | undefined;

  setReviewCycleFeedback(ctx, undefined);

  let terminationReason: 'no-issues' | 'max-rounds' | null = null;
  let lastReviewIssueCount = 0;

  for (let round = 0; round < maxRounds; round++) {
    // Emit perspectives-respawned at the start of each review round
    yield emitBuildDecision(ctx, {
      kind: 'perspectives-respawned',
      rationale: adaptiveRationaleForRound
        ? `Starting review round ${round + 1} of ${maxRounds}: ${adaptiveRationaleForRound}`
        : `Starting review round ${round + 1} of ${maxRounds}`,
      round,
      perspectives: activePerspectivesForRound ?? [],
      dropped: droppedForRound,
    });

    const reviewMetadata = yield* reviewStageInner(ctx, { strategy, perspectives: activePerspectivesForRound, round });
    if (ctx.buildFailed) return;
    if (!initialPerspectiveOrder && reviewMetadata.activePerspectives.length > 0) {
      initialPerspectiveOrder = reviewMetadata.activePerspectives;
    }
    lastReviewIssueCount = reviewMetadata.completeIssueCount;

    if (ctx.reviewIssues.length === 0 && reviewMetadata.perspectiveErrors.length === 0) {
      yield emitBuildDecision(ctx, {
        kind: 'cycle-terminated',
        rationale: `Review cycle terminated after round ${round + 1}: no issues found`,
        round,
        reason: 'no-issues',
        issuesRemaining: 0,
      });
      terminationReason = 'no-issues';
      break;
    }

    yield* reviewFixStageInner(ctx, { round });
    yield* evaluateStageInner(ctx, { strictness, round });
    if (ctx.buildFailed) return;

    if (round < maxRounds - 1) {
      const previousActiveForSelection = reviewMetadata.activePerspectives.length > 0
        ? reviewMetadata.activePerspectives
        : activePerspectivesForRound ?? [];

      // Post-evaluation early termination: skip next round when all fixes are
      // accepted, no critical concerns remain, and confidence is satisfied.
      const planShards = ctx.planFile.agents?.['builder']?.shards;
      const isShardedBuild = (planShards?.length ?? 0) > 0;
      const earlyTerm = shouldTerminateCycleEarly({
        evaluation: getLastBuildEvaluation(ctx),
        issuesByPerspective: reviewMetadata.issuesByPerspective,
        previousActive: previousActiveForSelection,
        perspectiveErrors: reviewMetadata.perspectiveErrors,
        hasTestCycle: ctx.build.flat().includes('test-cycle'),
        verifyWasActive: previousActiveForSelection.includes('verify'),
      });
      if (!isShardedBuild && earlyTerm.terminate) {
        yield emitBuildDecision(ctx, {
          kind: 'cycle-terminated',
          rationale: earlyTerm.rationale,
          round,
          reason: 'no-issues',
          issuesRemaining: 0,
        });
        terminationReason = 'no-issues';
        break;
      }

      const selection = selectNextReviewPerspectives({
        initialOrder: initialPerspectiveOrder ?? previousActiveForSelection,
        previousActive: previousActiveForSelection,
        issuesByPerspective: reviewMetadata.issuesByPerspective,
        evaluation: getLastBuildEvaluation(ctx),
        previousReviewWasParallel: reviewMetadata.parallel,
        perspectiveErrors: reviewMetadata.perspectiveErrors,
        mandatoryPerspectives: isShardedBuild ? ['verify'] : undefined,
      });
      activePerspectivesForRound = selection.perspectives.length > 0
        ? selection.perspectives
        : selection.fallback && previousActiveForSelection.length === 0
          ? undefined
          : selection.perspectives;
      droppedForRound = selection.dropped;
      adaptiveRationaleForRound = selection.rationale;

      if (selection.perspectives.length === 0 && !(selection.fallback && previousActiveForSelection.length === 0)) {
        yield emitBuildDecision(ctx, {
          kind: 'cycle-terminated',
          rationale: `Review cycle terminated after round ${round + 1}: no review perspectives remain relevant after evaluation. ${selection.rationale}`,
          round,
          reason: 'no-issues',
          issuesRemaining: 0,
        });
        terminationReason = 'no-issues';
        break;
      }
    }
  }

  // If all rounds exhausted without finding no-issues, emit max-rounds termination.
  // Guard with `maxRounds > 0`: when maxRounds=0 the loop never ran, there's no
  // cycle to terminate, and `round: maxRounds - 1` would be `-1`, failing
  // BuildDecisionSchema's `nonnegative()` check and crashing the build.
  if (terminationReason === null && maxRounds > 0) {
    const finalEvaluation = getLastBuildEvaluation(ctx);
    const finalEvaluationText = finalEvaluation?.ran
      ? `; final evaluation accepted ${finalEvaluation.accepted} and rejected ${finalEvaluation.rejected}; blocking issue outcomes ${finalEvaluation.blockingIssueOutcomes}`
      : '; final evaluation did not run';
    yield emitBuildDecision(ctx, {
      kind: 'cycle-terminated',
      rationale: `Review cycle exhausted ${maxRounds} round(s); last review found ${lastReviewIssueCount} issue(s)${finalEvaluationText}`,
      round: maxRounds - 1,
      reason: 'max-rounds',
      issuesRemaining: ctx.reviewIssues.length,
      lastReviewIssueCount,
      finalEvaluationRan: finalEvaluation?.ran ?? false,
      ...(finalEvaluation?.ran && {
        finalEvaluationAccepted: finalEvaluation.accepted,
        finalEvaluationRejected: finalEvaluation.rejected,
        finalEvaluationResolved: finalEvaluation.resolvedIssueOutcomes,
        finalEvaluationFalsePositive: finalEvaluation.falsePositiveIssueOutcomes,
        finalEvaluationUnresolved: finalEvaluation.unresolvedIssueOutcomes,
        finalEvaluationNeedsHumanReview: finalEvaluation.needsHumanReviewIssueOutcomes,
        finalEvaluationBlocking: finalEvaluation.blockingIssueOutcomes,
      }),
    } as unknown as Parameters<typeof emitBuildDecision>[1]);
    // Use lastReviewIssueCount rather than ctx.reviewIssues.length because
    // evaluateStageInner clears ctx.reviewIssues after verdict application.
    // Fail only when the final evaluator did not run or explicit issue outcomes
    // say blocking issues remain. Missing issue outcomes are normalized
    // conservatively by countEvaluationIssueOutcomes(): accept => resolved,
    // reject/review => unresolved.
    const evalHasBlockingIssues = !finalEvaluation?.ran || finalEvaluation.blockingIssueOutcomes > 0;
    if (lastReviewIssueCount > 0 && evalHasBlockingIssues) {
      const errorMsg = !finalEvaluation?.ran
        ? `Review cycle exhausted ${maxRounds} round(s) without a final evaluation verdict.`
        : `${finalEvaluation.blockingIssueOutcomes} blocking issue outcome(s) remain after ${maxRounds} review round(s) (${finalEvaluation.unresolvedIssueOutcomes} unresolved, ${finalEvaluation.needsHumanReviewIssueOutcomes} need human review; ${finalEvaluation.rejected} rejected, ${finalEvaluation.review} under review).`;
      yield { timestamp: new Date().toISOString(), type: 'plan:build:failed', planId: ctx.planId, error: errorMsg } as EforgeEvent;
      ctx.buildFailed = true;
    }
  }
});

registerBuildStage({
  name: 'validate',
  phase: 'build',
  description: 'Runs registered extension validation providers as quality gates before review. No-op when no providers are loaded.',
  whenToUse: 'When one or more extension validation providers are loaded (include when providers are registered). Post-merge validation is handled by the Orchestrator and is separate.',
  costHint: 'low',
  predecessors: ['implement'],
  parallelizable: false,
}, async function* validateStage(ctx) {
  // No-op when no validation providers are registered — skip the diff computation entirely.
  const validationProviders = ctx.extensionValidationProviders;
  if (!validationProviders || validationProviders.length === 0) return;
  const getValidationChangedFiles = async (): Promise<string[]> => {
    const validationSnapshot = await computeReviewThresholdSnapshot(ctx.worktreePath, ctx.orchConfig.diffBaseRef ?? ctx.orchConfig.baseBranch);
    return [...validationSnapshot.changedFiles];
  };
  yield* runValidationProviderRecoveryStage(ctx, {
    runReviewFix: (validationRepairContext) => reviewFixStageInner(ctx, { validationRepairContext }),
    runStructuralValidationFix: (validationRepairContext) => structuralValidationFixStageInner(ctx, validationRepairContext),
    runEvaluate: (overrides) => evaluateStageInner(ctx, overrides),
  }, getValidationChangedFiles);
});

registerBuildStage({
  name: 'doc-author',
  phase: 'build',
  description: 'Author plan-specified documentation in parallel with implementation.',
  whenToUse: 'When the plan names new documentation files to create, or describes specific docs to update.',
  costHint: 'medium',
}, async function* docAuthorStage(ctx) {
  const { harness: docAuthorHarness, toolbeltSummary: docAuthorTb } = ctx.agentRuntimes.forRoleResolved('doc-author', ctx.planFile);
  const agentConfig = resolveAgentConfig('doc-author', ctx.config, ctx.planFile, docAuthorTb);
  const docSpan = ctx.tracing.createSpan('doc-author', { planId: ctx.planId });
  docSpan.setInput({ planId: ctx.planId });
  const docTracker = createToolTracker(docSpan);
  try {
    for await (const event of withPeriodicFileCheck(runDocAuthor({
      cwd: ctx.worktreePath,
      planId: ctx.planId,
      planContent: ctx.planFile.body,
      verbose: ctx.verbose,
      abortController: ctx.abortController,
      ...agentConfig,
      phase: 'build',
      stage: 'doc-author',
      harness: docAuthorHarness,
    }), ctx)) {
      docTracker.handleEvent(event);
      yield event;
    }
    docTracker.cleanup();
    docSpan.end();
  } catch (err) {
    docTracker.cleanup();
    docSpan.error(err as Error);
    if (err instanceof Error && err.name === 'AbortError') throw err;
    // Doc-author failure is non-fatal — don't propagate
  }
  // Stage any working-tree changes left by the agent (new files included) and commit
  try {
    const { stdout: statusOut } = await exec('git', ['status', '--porcelain'], { cwd: ctx.worktreePath });
    if (statusOut.trim().length > 0) {
      await exec('git', ['add', '-A'], { cwd: ctx.worktreePath });
      await forgeCommit(ctx.worktreePath, composeCommitMessage(`docs(${ctx.planId}): author documentation`, ctx.modelTracker));
    }
  } catch {
    // Non-critical — don't fail the stage if the commit fails
  }
  yield* emitFilesChanged(ctx);
});

registerBuildStage({
  name: 'doc-sync',
  phase: 'build',
  description: 'Sync existing documentation against the post-implement diff.',
  whenToUse: 'After implementation when changed symbols/paths/APIs/flags may have stale references in existing docs.',
  costHint: 'medium',
  parallelizable: false,
  predecessors: ['implement'],
}, async function* docSyncStage(ctx) {
  // If preImplementCommit is missing, there is no diff to sync against — skip the agent
  if (!ctx.preImplementCommit) {
    yield { timestamp: new Date().toISOString(), type: 'plan:build:doc-sync:start' as const, planId: ctx.planId };
    yield { timestamp: new Date().toISOString(), type: 'plan:build:doc-sync:complete' as const, planId: ctx.planId, docsSynced: 0 };
    return;
  }

  const { harness: docSyncerHarness, toolbeltSummary: docSyncerTb } = ctx.agentRuntimes.forRoleResolved('doc-syncer', ctx.planFile);
  const agentConfig = resolveAgentConfig('doc-syncer', ctx.config, ctx.planFile, docSyncerTb);
  const docSpan = ctx.tracing.createSpan('doc-syncer', { planId: ctx.planId });
  docSpan.setInput({ planId: ctx.planId });
  const docTracker = createToolTracker(docSpan);
  try {
    for await (const event of withPeriodicFileCheck(runDocSyncer({
      cwd: ctx.worktreePath,
      planId: ctx.planId,
      planContent: ctx.planFile.body,
      preImplementCommit: ctx.preImplementCommit,
      verbose: ctx.verbose,
      abortController: ctx.abortController,
      ...agentConfig,
      phase: 'build',
      stage: 'doc-sync',
      harness: docSyncerHarness,
    }), ctx)) {
      docTracker.handleEvent(event);
      yield event;
    }
    docTracker.cleanup();
    docSpan.end();
  } catch (err) {
    docTracker.cleanup();
    docSpan.error(err as Error);
    if (err instanceof Error && err.name === 'AbortError') throw err;
    // Doc-syncer failure is non-fatal — don't propagate
  }
  // Stage any working-tree changes left by the agent (edited docs included) and commit
  try {
    const { stdout: statusOut } = await exec('git', ['status', '--porcelain'], { cwd: ctx.worktreePath });
    if (statusOut.trim().length > 0) {
      await exec('git', ['add', '-A'], { cwd: ctx.worktreePath });
      await forgeCommit(ctx.worktreePath, composeCommitMessage(`docs(${ctx.planId}): sync documentation with implementation`, ctx.modelTracker));
    }
  } catch {
    // Non-critical — don't fail the stage if the commit fails
  }
  yield* emitFilesChanged(ctx);
});

registerBuildStage({
  name: 'test-write',
  phase: 'build',
  description: 'Writes test cases for the implementation using the test-writer agent.',
  whenToUse: 'When automated test generation is desired. Can run after or in parallel with implementation.',
  costHint: 'medium',
  predecessors: ['implement'],
}, async function* testWriteStage(ctx) {
  const { harness: testWriterHarness, toolbeltSummary: testWriterTb } = ctx.agentRuntimes.forRoleResolved('test-writer', ctx.planFile);
  const agentConfig = resolveAgentConfig('test-writer', ctx.config, ctx.planFile, testWriterTb);
  const span = ctx.tracing.createSpan('test-writer', { planId: ctx.planId });
  span.setInput({ planId: ctx.planId });
  const tracker = createToolTracker(span);

  // Get implementation diff for post-implementation context
  let implementationContext = '';
  try {
    const { stdout } = await exec('git', ['diff', `${ctx.orchConfig.diffBaseRef ?? ctx.orchConfig.baseBranch}...HEAD`], { cwd: ctx.worktreePath });
    implementationContext = stdout;
  } catch {
    // No diff available (TDD mode) — that's fine
  }

  try {
    for await (const event of withPeriodicFileCheck(runTestWriter({
      cwd: ctx.worktreePath,
      planId: ctx.planId,
      planContent: ctx.planFile.body,
      implementationContext: implementationContext || undefined,
      verbose: ctx.verbose,
      abortController: ctx.abortController,
      ...agentConfig,
      phase: 'build',
      stage: 'test-write',
      harness: testWriterHarness,
    }), ctx)) {
      tracker.handleEvent(event);
      yield event;
    }
    tracker.cleanup();
    span.end();
  } catch (err) {
    tracker.cleanup();
    span.error(err as Error);
    if (err instanceof Error && err.name === 'AbortError') throw err;
  }
  yield* emitFilesChanged(ctx);
});

registerBuildStage({
  name: 'test',
  phase: 'build',
  description: 'Runs the tester agent to execute tests and identify production code issues.',
  whenToUse: 'When test execution and production issue detection is needed. Used within test-cycle.',
  costHint: 'medium',
  predecessors: ['implement'],
}, async function* testStage(ctx) {
  yield* testStageInner(ctx);
});

registerBuildStage({
  name: 'test-cycle',
  phase: 'build',
  description: 'Runs iterative test-evaluate rounds up to maxRounds, stopping when no production issues remain.',
  whenToUse: 'For test-driven quality assurance. Combines test and evaluate into an iterative loop.',
  costHint: 'high',
  predecessors: ['implement'],
  conflictsWith: ['test'],
  parallelizable: false,
}, async function* testCycleStage(ctx) {
  const maxRounds = ctx.review.maxRounds;
  const strictness = ctx.review.evaluatorStrictness;
  for (let round = 0; round < maxRounds; round++) {
    yield* testStageInner(ctx);
    if (ctx.reviewIssues.length === 0) break;
    yield* evaluateStageInner(ctx, { strictness });
    if (ctx.buildFailed) return;
  }
});
