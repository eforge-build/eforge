/**
 * Phase functions for the orchestrator — executePlans, validate, finalize.
 * Each phase is an async generator that yields EforgeEvents.
 * The orchestrator's execute() method calls these in sequence via yield*.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

import type { EforgeEvent, OrchestrationConfig, EforgeState } from '../events.js';
import { transitionPlan } from './plan-lifecycle.js';
import { WorktreeManager } from '../worktree-manager.js';
import { Semaphore, AsyncEventQueue } from '../concurrency.js';
import type { PlanRunner, ValidationFixer, PrdValidator, GapCloser } from '../orchestrator.js';
import type { MergeResolver } from '../worktree-ops.js';
import { cleanupPlanFiles } from '../cleanup.js';
import { execWithTimeout } from '../exec-with-timeout.js';
import { MIN_POST_MERGE_COMMAND_TIMEOUT_MS } from '../config.js';
import { ModelTracker, composeCommitMessage } from '../model-tracker.js';
// --- eforge:region plan-01-engine-config-and-landing ---
import { executeLandingAction, type LandingResult } from '../landing.js';
// --- eforge:endregion plan-01-engine-config-and-landing ---
// --- eforge:region plan-03-branch-aware-landing ---
import type { EforgeConfig, LandingConfig } from '../config.js';
// --- eforge:endregion plan-03-branch-aware-landing ---
// --- eforge:region plan-02-artifact-aware-queue-base-resolution ---
import { recordSuccessfulBuildArtifact } from '../stacking/artifacts.js';
import type { StackBaseContext } from '../stacking/base-resolver.js';
// --- eforge:endregion plan-02-artifact-aware-queue-base-resolution ---
// --- eforge:region plan-02-stack-provider-runtime ---
import { executeStackLanding } from '../stacking/landing.js';
import { updateStackLayerLanding } from '../stacking/state.js';
import type { StackProviderAdapter } from '../stacking/provider.js';
// --- eforge:endregion plan-02-stack-provider-runtime ---
// --- eforge:region plan-02-policy-gate-engine-integration ---
import {
  buildFinalMergePolicyGateContext,
  buildPlanMergePolicyGateContext,
  executePolicyGate,
  type PolicyGateFailurePolicy,
} from '../extensions/policy-gate-runtime.js';
import type { NativeExtensionRegistry } from '../extensions/types.js';
// --- eforge:endregion plan-02-policy-gate-engine-integration ---

/**
 * Shared context passed between phase functions.
 * Carries all state and configuration needed by each phase.
 */
export interface PhaseContext {
  state: EforgeState;
  config: OrchestrationConfig;
  repoRoot: string;
  planRunner: PlanRunner;
  parallelism: number;
  signal?: AbortSignal;
  postMergeCommands?: string[];
  validateCommands?: string[];
  postMergeCommandTimeoutMs?: number;
  validationFixer?: ValidationFixer;
  maxValidationRetries: number;
  mergeResolver?: MergeResolver;
  prdValidator?: PrdValidator;
  gapCloser?: GapCloser;
  minCompletionPercent: number;
  gapClosePerformed: boolean;
  mergeWorktreePath: string;
  featureBranch: string;
  worktreeManager: WorktreeManager;
  /** Tracks plans whose merges failed (accumulated across executePlans) */
  failedMerges: Set<string>;
  /** Tracks recently merged plan IDs for merge resolver context enrichment */
  recentlyMergedIds: string[];
  // --- eforge:region plan-01-engine-config-and-landing ---
  /** Whether the landing action completed successfully (replaces featureBranchMerged). */
  landingSucceeded: boolean;
  // --- eforge:endregion plan-01-engine-config-and-landing ---
  /** Accumulates model IDs from agent:start events across all phases. Used for the final merge commit's Models-Used: trailer. */
  modelTracker: ModelTracker;
  /** Whether to run cleanup on the feature branch before the final merge. */
  shouldCleanup?: boolean;
  /** Plan set name for cleanup commit message. */
  cleanupPlanSet?: string;
  /** Output directory containing plan files. */
  cleanupOutputDir?: string;
  /** Path to the PRD file to remove during cleanup. */
  cleanupPrdFilePath?: string;
  // --- eforge:region plan-02-policy-gate-engine-integration ---
  /** Optional extension registry for policy gates. */
  extensionRegistry?: Pick<NativeExtensionRegistry, 'policyGates'>;
  /** Timeout in milliseconds for policy gate handlers. */
  policyGateTimeoutMs?: number;
  /** Failure policy for thrown, timed-out, or invalid policy gate handlers. */
  policyGateFailurePolicy?: PolicyGateFailurePolicy;
  // --- eforge:endregion plan-02-policy-gate-engine-integration ---
  // --- eforge:region plan-03-branch-aware-landing ---
  /** EforgeConfig subset for trunk policy resolution in executeLandingAction. */
  engineConfig?: Pick<EforgeConfig, 'build'>;
  // --- eforge:endregion plan-03-branch-aware-landing ---
  // --- eforge:region plan-02-artifact-aware-queue-base-resolution ---
  /** Queued PRD id for stack artifact recording. */
  prdId?: string;
  /** Resolved stack context for queued stacked builds. */
  stackContext?: StackBaseContext;
  /** Which post-build landing action to execute (canonical: pr | merge | leave). */
  landingAction: LandingConfig['action'];
  // --- eforge:endregion plan-02-artifact-aware-queue-base-resolution ---
  // --- eforge:region plan-02-stack-provider-runtime ---
  /** Instantiated stack provider adapter for git-spice landing (stacked builds only). */
  stackProvider?: StackProviderAdapter;
  // --- eforge:endregion plan-02-stack-provider-runtime ---
}

/**
 * Walk the dependency graph from a failed plan and mark all transitive
 * dependents as blocked. Returns build:failed events for each blocked plan.
 */
export function propagateFailure(
  state: EforgeState,
  failedPlanId: string,
  plans: OrchestrationConfig['plans'],
): EforgeEvent[] {
  const events: EforgeEvent[] = [];

  // Build adjacency: planId → direct dependents
  const dependents = new Map<string, string[]>();
  for (const plan of plans) {
    for (const dep of plan.dependsOn) {
      if (!dependents.has(dep)) dependents.set(dep, []);
      dependents.get(dep)!.push(plan.id);
    }
  }

  // BFS for transitive dependents
  const queue = [failedPlanId];
  const blocked = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const dep of dependents.get(current) ?? []) {
      if (blocked.has(dep)) continue;
      blocked.add(dep);

      const planState = state.plans[dep];
      if (planState && planState.status !== 'completed' && planState.status !== 'merged') {
        // Emit lifecycle events (plan:status:change, plan:error:set) before plan:build:failed
        events.push(...transitionPlan(state, dep, 'blocked', { error: `Blocked by failed dependency: ${failedPlanId}` }));
        events.push({
          timestamp: new Date().toISOString(),
          type: 'plan:build:failed',
          planId: dep,
          error: `Blocked by failed dependency: ${failedPlanId}`,
        });
      }
      queue.push(dep);
    }
  }

  return events;
}

/**
 * Check if a plan's merge should be skipped because one of its dependencies
 * is in the failedMerges set. Returns null to proceed, or a skip reason string.
 */
export function shouldSkipMerge(
  planId: string,
  plans: OrchestrationConfig['plans'],
  failedMerges: Set<string>,
): string | null {
  const plan = plans.find((p) => p.id === planId);
  if (!plan) return null;

  for (const dep of plan.dependsOn) {
    if (failedMerges.has(dep)) {
      return `Skipped: dependency "${dep}" failed to merge`;
    }
  }

  return null;
}

// --- eforge:region plan-02-policy-gate-engine-integration ---
function policyBlockReason(prefix: string, decision: { decision: string; reason?: string }): string {
  const reason = decision.reason ?? decision.decision;
  return `${prefix}: ${reason}`;
}

function hasPolicyGates(ctx: PhaseContext, gateKind: 'plan-merge' | 'final-merge'): boolean {
  return (ctx.extensionRegistry?.policyGates ?? []).some((registration) => registration.gateKind === gateKind);
}
// --- eforge:endregion plan-02-policy-gate-engine-integration ---

/**
 * Compute the maximum number of plans that could run concurrently
 * based on the dependency graph's wave structure.
 *
 * Plans are grouped into waves: wave 0 has no dependencies,
 * wave N depends only on plans in waves < N. The max wave size
 * determines the peak concurrency.
 */
export function computeMaxConcurrency(
  plans: OrchestrationConfig['plans'],
): number {
  if (plans.length === 0) return 0;

  // Assign each plan to a wave based on its dependencies
  const waveOf = new Map<string, number>();

  // Iteratively resolve waves — a plan's wave is max(wave of deps) + 1
  // For plans with no deps, wave is 0.
  const planMap = new Map(plans.map((p) => [p.id, p]));

  const resolveWave = (planId: string, visited: Set<string>): number => {
    if (waveOf.has(planId)) return waveOf.get(planId)!;
    if (visited.has(planId)) return 0; // cycle guard
    visited.add(planId);

    const plan = planMap.get(planId);
    if (!plan || plan.dependsOn.length === 0) {
      waveOf.set(planId, 0);
      return 0;
    }

    let maxDepWave = 0;
    for (const dep of plan.dependsOn) {
      maxDepWave = Math.max(maxDepWave, resolveWave(dep, visited));
    }
    const wave = maxDepWave + 1;
    waveOf.set(planId, wave);
    return wave;
  };

  for (const plan of plans) {
    resolveWave(plan.id, new Set());
  }

  // Count plans per wave, return the max (only count actual plans, not phantom deps)
  const waveCounts = new Map<number, number>();
  for (const plan of plans) {
    const wave = waveOf.get(plan.id) ?? 0;
    waveCounts.set(wave, (waveCounts.get(wave) ?? 0) + 1);
  }

  let maxConcurrency = 0;
  for (const count of waveCounts.values()) {
    maxConcurrency = Math.max(maxConcurrency, count);
  }

  return maxConcurrency;
}

/**
 * Execute all plans: greedy scheduling, plan running, merging completed plans.
 * Yields schedule, build, and merge events.
 */
export async function* executePlans(ctx: PhaseContext): AsyncGenerator<EforgeEvent> {
  const { state, config, planRunner, signal } = ctx;
  const planMap = new Map(config.plans.map((p) => [p.id, p]));

  // Determine if plan worktrees are needed based on dependency graph concurrency
  const maxConcurrency = computeMaxConcurrency(config.plans);
  const needsPlanWorktrees = maxConcurrency > 1;

  const allPlanIds = config.plans.map((p) => p.id);
  yield { timestamp: new Date().toISOString(), type: 'schedule:start', planIds: allPlanIds };

  const semaphore = new Semaphore(ctx.parallelism);
  const eventQueue = new AsyncEventQueue<EforgeEvent>();

  // Track running plans: planId → Promise that resolves when the plan finishes
  const running = new Map<string, Promise<void>>();

  // Per-plan model trackers: planId → ModelTracker (populated by observing agent:start events)
  const perPlanTrackers = new Map<string, ModelTracker>();

  /**
   * Check if a plan is ready to start: pending status and all deps merged.
   */
  const isReady = (planId: string): boolean => {
    const ps = state.plans[planId];
    if (!ps || ps.status !== 'pending') return false;
    return ps.dependsOn.every((dep) => {
      const depState = state.plans[dep];
      return depState && depState.status === 'merged';
    });
  };

  /**
   * Launch a single plan: acquire semaphore, create worktree, run, update state.
   * Pushes events into the shared eventQueue. Returns a promise that resolves
   * when the plan run (and worktree cleanup) is finished.
   */
  const launchPlan = (planId: string): Promise<void> => {
    eventQueue.addProducer();

    // Create a per-plan tracker to record models for this plan's squash-merge commit
    const perPlanTracker = new ModelTracker();
    perPlanTrackers.set(planId, perPlanTracker);

    const planPromise = (async () => {
      const plan = planMap.get(planId)!;
      let worktreePath: string | undefined;

      try {
        await semaphore.acquire();

        worktreePath = await ctx.worktreeManager.acquireForPlan(planId, plan.branch, needsPlanWorktrees);

        state.plans[planId].worktreePath = worktreePath;
        for (const e of transitionPlan(state, planId, 'running')) eventQueue.push(e);

        // Delegate to injected plan runner
        let buildFailedError: string | undefined;
        for await (const event of planRunner(planId, worktreePath, plan)) {
          if (event.type === 'plan:build:failed' && event.planId === planId) {
            buildFailedError = event.error;
          }
          // Record agent:start events into per-plan and shared trackers
          if (event.type === 'agent:start') {
            perPlanTracker.record(event.model);
            ctx.modelTracker.record(event.model);
          }
          eventQueue.push(event);
        }

        if (buildFailedError !== undefined) {
          for (const e of transitionPlan(state, planId, 'failed', { error: buildFailedError })) eventQueue.push(e);

          const failureEvents = propagateFailure(state, planId, config.plans);
          for (const e of failureEvents) eventQueue.push(e);
        } else {
          for (const e of transitionPlan(state, planId, 'completed')) eventQueue.push(e);
        }
      } catch (err) {
        // Handle all failures (worktree creation, plan runner, etc.)
        if (state.plans[planId].status !== 'failed') {
          for (const e of transitionPlan(state, planId, 'failed', { error: (err as Error).message })) eventQueue.push(e);
        }

        // Propagate failure to transitive dependents
        const failureEvents = propagateFailure(state, planId, config.plans);
        for (const e of failureEvents) eventQueue.push(e);
      } finally {
        semaphore.release();
        await ctx.worktreeManager.releaseForPlan(planId);
        eventQueue.removeProducer();
      }
    })();

    running.set(planId, planPromise);
    return planPromise;
  };

  /**
   * Find all ready plans, emit schedule:ready, and launch them.
   */
  const startReadyPlans = (reason: string): void => {
    for (const planId of allPlanIds) {
      if (running.has(planId)) continue;
      if (!isReady(planId)) continue;

      eventQueue.push({ timestamp: new Date().toISOString(), type: 'plan:schedule:ready', planId, reason });
      launchPlan(planId);
    }
  };

  // Start all zero-dependency plans
  startReadyPlans('no dependencies');

  // Keep the queue alive while the orchestrator is active (plans add/remove
  // themselves as producers; this extra producer prevents premature termination
  // between the last plan finishing and new plans starting).
  eventQueue.addProducer();
  let sentinelActive = true;
  const removeSentinel = () => {
    if (sentinelActive) {
      sentinelActive = false;
      eventQueue.removeProducer();
    }
  };

  // Guard: if no plans were launched (all have unmet dependencies on resume),
  // remove sentinel immediately to avoid hanging.
  if (running.size === 0) {
    removeSentinel();
  }

  // Event-driven loop: yield events in real-time as plan runners push them.
  // After each event, check if any plans completed and process merges inline.
  try {
    for await (const event of eventQueue) {
      if (signal?.aborted) {
        break;
      }

      yield event;

      // Check if any running plans just finished (completed or failed — NOT pending,
      // which is the initial state before the async plan runner updates it to running)
      const justCompleted: string[] = [];
      for (const [planId] of running) {
        const ps = state.plans[planId];
        if (ps && (ps.status === 'completed' || ps.status === 'failed')) {
          justCompleted.push(planId);
        }
      }

      if (justCompleted.length === 0) continue;

      for (const planId of justCompleted) {
        running.delete(planId);
      }

      // Merge completed plans immediately (serialized — one at a time)
      for (const planId of justCompleted) {
        if (signal?.aborted) break;

        const planState = state.plans[planId];
        if (!planState || planState.status !== 'completed') continue;

        const skipReason = shouldSkipMerge(planId, config.plans, ctx.failedMerges);
        if (skipReason) {
          ctx.failedMerges.add(planId);
          yield* transitionPlan(state, planId, 'failed', { error: skipReason });
          yield { timestamp: new Date().toISOString(), type: 'plan:build:failed', planId, error: skipReason };

          const failureEvents = propagateFailure(state, planId, config.plans);
          for (const e of failureEvents) yield e;
          continue;
        }

        yield { timestamp: new Date().toISOString(), type: 'plan:merge:start', planId };

        try {
          const plan = planMap.get(planId)!;

          // --- eforge:region plan-02-policy-gate-engine-integration ---
          if (hasPolicyGates(ctx, 'plan-merge')) {
            const diff = await ctx.worktreeManager.getPlanDiff(planId, plan);
            const policyResult = await executePolicyGate({
              registry: ctx.extensionRegistry,
              gateKind: 'plan-merge',
              context: buildPlanMergePolicyGateContext({ planId, diff }, { cwd: ctx.mergeWorktreePath }),
              timeoutMs: ctx.policyGateTimeoutMs ?? 5_000,
              failurePolicy: ctx.policyGateFailurePolicy ?? 'fail-closed',
            });

            for (const e of policyResult.events) yield e;

            if (policyResult.blocked) {
              const error = policyBlockReason('Policy gate blocked plan merge', policyResult.decision);
              ctx.failedMerges.add(planId);
              yield* transitionPlan(state, planId, 'failed', { error });
              yield { timestamp: new Date().toISOString(), type: 'plan:build:failed', planId, error };

              const failureEvents = propagateFailure(state, planId, config.plans);
              for (const e of failureEvents) yield e;
              continue;
            }
          }
          // --- eforge:endregion plan-02-policy-gate-engine-integration ---

          const commitSha = await ctx.worktreeManager.mergePlan(planId, plan, {
            mode: config.mode,
            mergeResolver: ctx.mergeResolver,
            recentlyMergedIds: ctx.recentlyMergedIds,
            planMap,
            modelTracker: perPlanTrackers.get(planId),
          });

          yield* transitionPlan(state, planId, 'merged');
          planState.merged = true;
          ctx.recentlyMergedIds.push(planId);

          yield { timestamp: new Date().toISOString(), type: 'plan:merge:complete', planId, commitSha };
        } catch (err) {
          ctx.failedMerges.add(planId);
          yield* transitionPlan(state, planId, 'failed', { error: `Merge failed: ${(err as Error).message}` });

          yield {
            timestamp: new Date().toISOString(),
            type: 'plan:build:failed',
            planId,
            error: `Merge failed: ${(err as Error).message}`,
          };

          // Propagate to transitive dependents
          const failureEvents = propagateFailure(state, planId, config.plans);
          for (const e of failureEvents) yield e;
        }
      }

      // After merges, check for newly unblocked plans and start them
      if (!signal?.aborted) {
        startReadyPlans('dependencies merged');
      }

      // If no more running plans, terminate the queue
      if (running.size === 0) {
        removeSentinel();
      }
    }
  } finally {
    // Ensure sentinel is removed on abort or unexpected exit
    removeSentinel();
  }

  // Promote plan-level terminal failure to run-level status so post-execute
  // phase guards in orchestrator.ts (validate, prdValidate, finalize) short-
  // circuit. Before the throw→stream switch for build:failed, generator
  // unwinding handled this implicitly; now we signal it explicitly.
  const anyTerminalFailure = Object.values(state.plans).some(
    (p) => p.status === 'failed' || p.status === 'blocked',
  );
  if (anyTerminalFailure && (state.status as string) !== 'failed') {
    state.status = 'failed';
    state.completedAt = new Date().toISOString();
  }
}

/**
 * Run post-merge validation commands with optional fix cycles.
 * Yields validation events. Returns early (without yielding finalize events)
 * if validation fails after all retries.
 */
export async function* validate(ctx: PhaseContext): AsyncGenerator<EforgeEvent> {
  const { state, signal, mergeWorktreePath } = ctx;
  const allMerged = Object.values(state.plans).every((p) => p.status === 'merged');
  const { validateCommands, validationFixer } = ctx;
  const maxRetries = ctx.maxValidationRetries;

  // Config postMergeCommands run first (e.g., pnpm install), then planner-generated
  // validate commands (e.g., pnpm type-check, pnpm test). Deduplicate exact matches.
  const allValidationCommands = [
    ...new Set([...(ctx.postMergeCommands ?? []), ...(validateCommands ?? [])]),
  ];

  if (!allMerged || allValidationCommands.length === 0 || signal?.aborted) return;

  // Resolve effective timeout: clamp to floor and warn if below minimum.
  let effectiveTimeoutMs = ctx.postMergeCommandTimeoutMs ?? 300_000;
  let timeoutWarningEmitted = false;
  if (effectiveTimeoutMs < MIN_POST_MERGE_COMMAND_TIMEOUT_MS) {
    effectiveTimeoutMs = MIN_POST_MERGE_COMMAND_TIMEOUT_MS;
    timeoutWarningEmitted = true;
  }

  // Validation runs in the merge worktree (which already has featureBranch checked out)
  let passed = false;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Emit clamp warning once, before the first command on the first attempt.
    if (attempt === 0 && timeoutWarningEmitted) {
      yield {
        timestamp: new Date().toISOString(),
        type: 'config:warning' as const,
        source: 'validate',
        message: `postMergeCommandTimeoutMs is below the minimum (${MIN_POST_MERGE_COMMAND_TIMEOUT_MS}ms); clamped to floor.`,
      } as EforgeEvent;
    }

    yield { timestamp: new Date().toISOString(), type: 'validation:start', commands: allValidationCommands };
    const failures: Array<{ command: string; exitCode: number; output: string }> = [];
    let validationPassed = true;

    for (const cmd of allValidationCommands) {
      if (signal?.aborted) { validationPassed = false; break; }

      yield { timestamp: new Date().toISOString(), type: 'validation:command:start', command: cmd };

      const result = await execWithTimeout(cmd, { cwd: mergeWorktreePath, timeoutMs: effectiveTimeoutMs, signal });

      if (result.timedOut) {
        yield {
          timestamp: new Date().toISOString(),
          type: 'validation:command:timeout',
          command: cmd,
          timeoutMs: effectiveTimeoutMs,
          pid: result.pid ?? -1,
        };
        const output = `[timed out after ${effectiveTimeoutMs}ms]`;
        yield { timestamp: new Date().toISOString(), type: 'validation:command:complete', command: cmd, exitCode: 124, output };
        failures.push({ command: cmd, exitCode: 124, output });
        validationPassed = false;
        break; // Stop on timeout, same as non-zero exit
      } else if (result.exitCode !== 0) {
        const output = (result.stdout + result.stderr).trim();
        yield { timestamp: new Date().toISOString(), type: 'validation:command:complete', command: cmd, exitCode: result.exitCode, output };
        failures.push({ command: cmd, exitCode: result.exitCode, output });
        validationPassed = false;
        break; // Stop on first non-zero exit code
      } else {
        const output = (result.stdout + result.stderr).trim();
        yield { timestamp: new Date().toISOString(), type: 'validation:command:complete', command: cmd, exitCode: 0, output };
      }
    }

    yield { timestamp: new Date().toISOString(), type: 'validation:complete', passed: validationPassed };

    if (validationPassed) {
      passed = true;
      break;
    }

    // Attempt fix if retries remain and a fixer is available
    if (attempt < maxRetries && validationFixer && !signal?.aborted) {
      for await (const event of validationFixer(mergeWorktreePath, failures, attempt + 1, maxRetries)) {
        if (event.type === 'agent:start') ctx.modelTracker.record(event.model);
        yield event;
      }
      // Loop continues to re-validate
    } else {
      break;
    }
  }

  if (!passed) {
    // --- eforge:region plan-01-engine-config-and-landing ---
    yield { timestamp: new Date().toISOString(), type: 'landing:skipped', action: ctx.landingAction, featureBranch: ctx.featureBranch, baseBranch: ctx.config.baseBranch, reason: 'Validation failed' };
    if (ctx.landingAction === 'merge') {
      yield { timestamp: new Date().toISOString(), type: 'merge:finalize:skipped', featureBranch: ctx.featureBranch, baseBranch: ctx.config.baseBranch, reason: 'Validation failed' };
    }
    // --- eforge:endregion plan-01-engine-config-and-landing ---
    state.status = 'failed';
    state.completedAt = new Date().toISOString();
  }
}

/**
 * Run PRD validation after post-merge validation passes.
 * Compares the original PRD against the implementation to detect gaps.
 * Validator errors fail the build — a crashed validator cannot certify passing.
 */
export async function* prdValidate(ctx: PhaseContext): AsyncGenerator<EforgeEvent> {
  const { state, prdValidator } = ctx;

  if (!prdValidator) return;
  if ((state.status as string) === 'failed') return;

  let terminalEmitted = false;
  try {
    for await (const event of prdValidator(ctx.mergeWorktreePath)) {
      if (event.type === 'agent:start') ctx.modelTracker.record(event.model);
      yield event;
      if (event.type === 'prd_validation:complete') terminalEmitted = true;

      // If PRD validation fails, check viability gate before attempting gap closing
      if (event.type === 'prd_validation:complete' && !event.passed) {
        // Viability gate: if completionPercent is defined and below threshold, fail immediately
        if (event.completionPercent !== undefined && event.completionPercent < ctx.minCompletionPercent) {
          yield { timestamp: new Date().toISOString(), type: 'planning:progress', message: `PRD completion ${event.completionPercent}% is below viability threshold (${ctx.minCompletionPercent}%) - skipping gap closing` };
          state.status = 'failed';
          state.completedAt = new Date().toISOString();
        } else if (ctx.gapCloser && !ctx.gapClosePerformed) {
          try {
            for await (const gapEvent of ctx.gapCloser(ctx.mergeWorktreePath, event.gaps, event.completionPercent)) {
              if (gapEvent.type === 'agent:start') ctx.modelTracker.record(gapEvent.model);
              yield gapEvent;
            }
            ctx.gapClosePerformed = true;
          } catch (err) {
            if (err instanceof Error && err.name === 'AbortError') throw err;
            // Gap closer errors are non-fatal — fall through to fail
            state.status = 'failed';
            state.completedAt = new Date().toISOString();
          }
        } else {
          state.status = 'failed';
          state.completedAt = new Date().toISOString();
        }
      }
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw err;
    // A crashed validator must fail the build. The outer build loop derives
    // final status from events, so emit a terminal prd_validation:complete in
    // addition to the progress log — otherwise the earlier validation:complete
    // verdict stands and the build silently reports as completed. Skip the
    // synthetic terminal event if the validator already yielded one before
    // throwing; downstream consumers assume a single terminal per phase.
    const message = err instanceof Error ? err.message : String(err);
    yield { timestamp: new Date().toISOString(), type: 'planning:progress', message: `PRD validation failed: ${message}` };
    if (!terminalEmitted) {
      yield {
        timestamp: new Date().toISOString(),
        type: 'prd_validation:complete',
        passed: false,
        gaps: [{ requirement: 'PRD validator crashed', explanation: message }],
      };
    }
    state.status = 'failed';
    state.completedAt = new Date().toISOString();
  }
}

// --- eforge:region plan-02-artifact-aware-queue-base-resolution ---
/** Record a successful queued stack build artifact before landing starts. */
export async function* recordArtifact(ctx: PhaseContext): AsyncGenerator<EforgeEvent> {
  if (!ctx.stackContext) return;
  if ((ctx.state.status as string) === 'failed') return;
  if (ctx.signal?.aborted) return;
  const allMerged = Object.values(ctx.state.plans).every((p) => p.status === 'merged');
  if (!allMerged) return;

  try {
    yield await recordSuccessfulBuildArtifact({
      cwd: ctx.repoRoot,
      mergeWorktreePath: ctx.mergeWorktreePath,
      stackContext: ctx.stackContext,
      landingAction: ctx.landingAction,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.state.status = 'failed';
    ctx.state.completedAt = new Date().toISOString();
    yield {
      timestamp: new Date().toISOString(),
      type: 'daemon:error',
      source: 'stack:artifact-recording',
      message: `Failed to record stack artifact for PRD '${ctx.prdId ?? ctx.stackContext.prdId}': ${message}`,
    } as EforgeEvent;
    yield {
      timestamp: new Date().toISOString(),
      type: 'landing:skipped',
      action: ctx.landingAction,
      featureBranch: ctx.featureBranch,
      baseBranch: ctx.config.baseBranch,
      reason: 'Stack artifact recording failed',
    } as EforgeEvent;
  }
}
// --- eforge:endregion plan-02-artifact-aware-queue-base-resolution ---

// --- eforge:region plan-02-stack-provider-runtime ---
/**
 * Run git-spice stack landing for stacked PR builds.
 *
 * Always called (not guarded by state.status check) so it can persist a
 * 'skipped' landing outcome when an earlier phase failed and landing cannot
 * be attempted. When no stack context or no provider is configured this is
 * a no-op, preserving existing behavior for non-stacked builds.
 *
 * For stacked builds with `landingAction === 'pr'` and a running build state,
 * delegates to `executeStackLanding` which tracks, submits, and persists.
 *
 * For stacked builds where the build failed before landing, persists a
 * 'skipped' outcome and emits the corresponding `stack:landing:update` event.
 */
export async function* stackLanding(ctx: PhaseContext): AsyncGenerator<EforgeEvent> {
  if (!ctx.stackContext || !ctx.stackProvider) return;

  const effectiveLandingAction = ctx.landingAction;
  const { prdId, stackId, branch } = ctx.stackContext;

  // If the build failed or was aborted before landing, persist the skipped outcome.
  const preLandingSkipReason = (ctx.state.status as string) === 'failed'
    ? 'Build failed before landing could be attempted'
    : ctx.signal?.aborted === true
      ? 'Build aborted before landing could be attempted'
      : undefined;
  if (preLandingSkipReason !== undefined) {
    const now = new Date().toISOString();
    await updateStackLayerLanding(ctx.repoRoot, prdId, {
      action: effectiveLandingAction,
      status: 'skipped',
      reason: preLandingSkipReason,
      startedAt: now,
      completedAt: now,
    });
    yield {
      timestamp: now,
      type: 'stack:landing:update',
      prdId,
      stackId,
      action: effectiveLandingAction,
      branch,
      status: 'skipped',
      reason: preLandingSkipReason,
    } as EforgeEvent;
    return;
  }

  // Delegate full landing to the stacking/landing helper, but observe the
  // terminal stack landing status so a provider failure cannot be mistaken for
  // a successful PR landing.
  let stackPrLandingCompleted = false;
  let stackPrLandingFailure: string | undefined;
  for await (const event of executeStackLanding({
    cwd: ctx.repoRoot,
    mergeWorktreePath: ctx.mergeWorktreePath,
    stackContext: ctx.stackContext,
    landingAction: effectiveLandingAction,
    provider: ctx.stackProvider,
  })) {
    if (event.type === 'stack:landing:update' && effectiveLandingAction === 'pr') {
      if (event.status === 'complete') stackPrLandingCompleted = true;
      if (event.status === 'failed') stackPrLandingFailure = event.reason ?? 'Stack landing failed';
    }
    yield event;
  }

  // Mark ctx so finalize skips the legacy issue-pr path only when git-spice
  // actually completed the stacked PR landing.
  if (effectiveLandingAction === 'pr') {
    if (stackPrLandingCompleted) {
      ctx.landingSucceeded = true;
    } else {
      const reason = stackPrLandingFailure ?? 'Stack landing did not complete';
      if (stackPrLandingFailure === undefined) {
        const now = new Date().toISOString();
        await updateStackLayerLanding(ctx.repoRoot, prdId, {
          action: effectiveLandingAction,
          status: 'failed',
          reason,
          startedAt: now,
          completedAt: now,
        });
        yield {
          timestamp: now,
          type: 'stack:landing:update',
          prdId,
          stackId,
          action: effectiveLandingAction,
          branch,
          status: 'failed',
          reason,
        } as EforgeEvent;
      }
      ctx.state.status = 'failed';
      ctx.state.completedAt = new Date().toISOString();
    }
  }
}
// --- eforge:endregion plan-02-stack-provider-runtime ---

/**
 * Final landing of the feature branch and status determination.
 * Dispatches on ctx.landingAction to run pr, merge, or leave.
 * Yields landing:* events (and merge:finalize:* for the merge action).
 */
export async function* finalize(ctx: PhaseContext): AsyncGenerator<EforgeEvent> {
  const { state, config, signal, featureBranch } = ctx;
  const allMerged = Object.values(state.plans).every((p) => p.status === 'merged');
  // --- eforge:region plan-01-engine-config-and-landing ---
  const action = ctx.landingAction;
  // --- eforge:endregion plan-01-engine-config-and-landing ---

  if (allMerged && !signal?.aborted) {
    // Build the merge commit message (used by merge action only; passed through for completeness)
    const prefix = config.mode === 'errand' ? 'fix' : 'feat';
    let commitMessage: string;
    if (config.plans.length === 1) {
      commitMessage = composeCommitMessage(`${prefix}(${config.name}): ${config.plans[0].name}`, ctx.modelTracker);
    } else {
      const planList = config.plans.map((p) => `- ${p.id}: ${p.name}`).join('\n');
      commitMessage = composeCommitMessage(`${prefix}(${config.name}): ${config.description}\n\nProfile: ${config.mode}\nPlans:\n${planList}`, ctx.modelTracker);
    }

    // --- eforge:region plan-02-policy-gate-engine-integration ---
    // Policy gate applies only to merge; stays here per plan spec.
    if (action === 'merge' && hasPolicyGates(ctx, 'final-merge')) {
      const diff = await ctx.worktreeManager.getFinalMergeDiff(config.baseBranch);
      const policyResult = await executePolicyGate({
        registry: ctx.extensionRegistry,
        gateKind: 'final-merge',
        context: buildFinalMergePolicyGateContext(
          {
            featureBranch,
            baseBranch: config.baseBranch,
            planIds: config.plans.map((plan) => plan.id),
            diff,
          },
          { cwd: ctx.mergeWorktreePath },
        ),
        timeoutMs: ctx.policyGateTimeoutMs ?? 5_000,
        failurePolicy: ctx.policyGateFailurePolicy ?? 'fail-closed',
      });

      for (const e of policyResult.events) yield e;

      if (policyResult.blocked) {
        const reason = policyBlockReason('Policy gate blocked final merge', policyResult.decision);
        // --- eforge:region plan-01-engine-config-and-landing ---
        yield { timestamp: new Date().toISOString(), type: 'landing:skipped', action, featureBranch, baseBranch: config.baseBranch, reason };
        yield { timestamp: new Date().toISOString(), type: 'merge:finalize:skipped', featureBranch, baseBranch: config.baseBranch, reason };
        // --- eforge:endregion plan-01-engine-config-and-landing ---
        state.status = 'failed';
        state.completedAt = new Date().toISOString();
        return;
      }
    }
    // --- eforge:endregion plan-02-policy-gate-engine-integration ---

    // --- eforge:region plan-01-engine-config-and-landing ---
    // --- eforge:region plan-02-stack-provider-runtime ---
    // For stacked builds with pr, git-spice already submitted the PR in the
    // stackLanding phase (which set ctx.landingSucceeded = true). Skip the
    // executeLandingAction PR publication to avoid a duplicate gh pr create call.
    if (action === 'pr' && ctx.stackContext && ctx.landingSucceeded) {
      // Stack landing already completed; finalize considers this a success.
      // No additional events — stack:landing:update already covers the outcome.
    } else {
    // --- eforge:endregion plan-02-stack-provider-runtime ---
    // Delegate to executeLandingAction for dirty-tree check, cleanup, and the chosen action.
    const landingGen = executeLandingAction({
      action,
      featureBranch,
      baseBranch: config.baseBranch,
      repoRoot: ctx.repoRoot,
      mergeWorktreePath: ctx.mergeWorktreePath,
      worktreeManager: ctx.worktreeManager,
      mergeResolver: ctx.mergeResolver,
      modelTracker: ctx.modelTracker,
      commitMessage,
      signal: ctx.signal,
      shouldCleanup: ctx.shouldCleanup,
      cleanupPlanSet: ctx.cleanupPlanSet,
      cleanupOutputDir: ctx.cleanupOutputDir,
      cleanupPrdFilePath: ctx.cleanupPrdFilePath,
      state,
      config,
      // --- eforge:region plan-03-branch-aware-landing ---
      engineConfig: ctx.engineConfig,
      // --- eforge:endregion plan-03-branch-aware-landing ---
    });

    // Manually iterate to capture the generator return value (LandingResult).
    let landingResult: LandingResult = { landingSucceeded: false };
    while (true) {
      const next = await landingGen.next();
      if (next.done) {
        landingResult = next.value;
        break;
      }
      yield next.value;
    }
    ctx.landingSucceeded = landingResult.landingSucceeded;
    // --- eforge:region plan-02-stack-provider-runtime ---
    } // end stacked PR gate
    // --- eforge:endregion plan-02-stack-provider-runtime ---
    // --- eforge:endregion plan-01-engine-config-and-landing ---
  } else if (!allMerged) {
    // Not all plans merged — skip landing, leave feature branch for inspection.
    // --- eforge:region plan-01-engine-config-and-landing ---
    yield { timestamp: new Date().toISOString(), type: 'landing:skipped', action, featureBranch, baseBranch: config.baseBranch, reason: 'Not all plans merged successfully' };
    if (action === 'merge') {
      yield { timestamp: new Date().toISOString(), type: 'merge:finalize:skipped', featureBranch, baseBranch: config.baseBranch, reason: 'Not all plans merged successfully' };
    }
    // --- eforge:endregion plan-01-engine-config-and-landing ---
  } else if (signal?.aborted) {
    // Aborted before finalize — leave feature branch for inspection.
    // --- eforge:region plan-01-engine-config-and-landing ---
    yield { timestamp: new Date().toISOString(), type: 'landing:skipped', action, featureBranch, baseBranch: config.baseBranch, reason: 'Aborted before finalize' };
    if (action === 'merge') {
      yield { timestamp: new Date().toISOString(), type: 'merge:finalize:skipped', featureBranch, baseBranch: config.baseBranch, reason: 'Aborted before finalize' };
    }
    // --- eforge:endregion plan-01-engine-config-and-landing ---
  }

  // --- eforge:region plan-01-engine-config-and-landing ---
  // Determine final status — completed only when the landing action succeeded.
  state.status = ctx.landingSucceeded ? 'completed' : 'failed';
  // --- eforge:endregion plan-01-engine-config-and-landing ---
  state.completedAt = new Date().toISOString();
}
