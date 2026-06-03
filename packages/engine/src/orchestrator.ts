/**
 * Orchestrator — greedy dependency-driven parallel execution,
 * git worktree lifecycle, and in-memory state tracking.
 *
 * Yields EforgeEvents (schedule:start, schedule:ready, merge:start, merge:complete, build:*)
 * as an AsyncGenerator. Agent execution is injected via PlanRunner callbacks.
 *
 * Active build state lives in memory only — no singleton state.json is written.
 * Compile→build handoff uses deterministic path computation from planSet name.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';

const exec = promisify(execFile);
import type { EforgeEvent, OrchestrationConfig, EforgeState, PlanState } from './events.js';
import { updatePlanStatus } from './state.js';
import {
  computeWorktreeBase,
  type MergeResolver,
} from './worktree-ops.js';
import { WorktreeManager } from './worktree-manager.js';
import { executePlans, validate, prdValidate, recordArtifact, stackLanding, finalize, syncDirectPrBaseBeforeValidation, type PhaseContext } from './orchestrator/phases.js';
import { ModelTracker } from './model-tracker.js';
import type { NativeExtensionRegistry } from './extensions/types.js';
import type { PolicyGateFailurePolicy } from './extensions/policy-gate-runtime.js';
import type { EforgeConfig, LandingConfig } from './config.js';
import type { ValidationConfig } from './config.js';
import type { StackBaseContext } from './stacking/base-resolver.js';
import type { StackProviderAdapter } from './stacking/provider.js';

/**
 * Callback that runs a single plan in a worktree.
 * Injected by the consumer to avoid circular dependencies with agent modules.
 */
export type PlanRunner = (
  planId: string,
  worktreePath: string,
  plan: OrchestrationConfig['plans'][0],
) => AsyncGenerator<EforgeEvent>;

/**
 * Callback that attempts to fix validation failures.
 * Injected by the consumer (typically wraps the validation-fixer agent).
 * @param cwd - Working directory where validation runs (merge worktree path)
 */
export type ValidationFixer = (
  cwd: string,
  failures: Array<{ command: string; exitCode: number; output: string }>,
  attempt: number,
  maxAttempts: number,
) => AsyncGenerator<EforgeEvent>;

/**
 * Callback that runs PRD validation after post-merge validation passes.
 * Injected by the consumer (typically wraps the prd-validator agent).
 * @param cwd - Working directory (merge worktree path)
 * @param context - Optional context carrying deterministic validation evidence
 */
export type PrdValidator = (
  cwd: string,
  context?: { validationCommandEvidence?: Array<{ command: string; exitCode: number; output?: string }> },
) => AsyncGenerator<EforgeEvent>;

export type AcceptanceUnknownResolver = (
  cwd: string,
  request: import('./validation/acceptance-unknown-resolution.js').AcceptanceUnknownResolverRequest,
) => AsyncGenerator<EforgeEvent, import('./validation/acceptance-unknown-resolution.js').AcceptanceUnknownResolution[], void>;

/**
 * Callback that attempts to close PRD validation gaps.
 * Injected by the consumer (typically wraps the gap-closer agent).
 * @param cwd - Working directory (merge worktree path)
 * @param gaps - The gaps identified by PRD validation
 */
export type GapCloser = (
  cwd: string,
  gaps: import('./events.js').PrdValidationGap[],
  completionPercent?: number,
) => AsyncGenerator<EforgeEvent>;

export interface OrchestratorOptions {
  repoRoot: string;
  planRunner: PlanRunner;
  signal?: AbortSignal;
  postMergeCommands?: string[];
  validateCommands?: string[];
  postMergeCommandTimeoutMs?: number;
  validationFixer?: ValidationFixer;
  maxValidationRetries?: number;
  mergeResolver?: MergeResolver;
  prdValidator?: PrdValidator;
  acceptanceUnknownResolver?: AcceptanceUnknownResolver;
  gapCloser?: GapCloser;
  /** Minimum PRD completion percentage (0-100) required to attempt gap closing. Defaults to 75. */
  minCompletionPercent?: number;
  /** Path to the merge worktree (created during compile, computed deterministically during build). */
  mergeWorktreePath?: string;
  /** Whether to run cleanup on the feature branch before the final merge. */
  shouldCleanup?: boolean;
  /** Plan set name for cleanup commit message. */
  cleanupPlanSet?: string;
  /** Output directory containing plan files. */
  cleanupOutputDir?: string;
  /** Path to the PRD file to remove during cleanup. */
  cleanupPrdFilePath?: string;
  /** Optional extension registry for policy gates. */
  extensionRegistry?: Pick<NativeExtensionRegistry, 'policyGates'>;
  /** Timeout in milliseconds for policy gate handlers. */
  policyGateTimeoutMs?: number;
  /** Failure policy for thrown, timed-out, or invalid policy gate handlers. */
  policyGateFailurePolicy?: PolicyGateFailurePolicy;
  /** EforgeConfig subset for trunk policy resolution. When omitted, trunk defaults to "main". */
  engineConfig?: Pick<EforgeConfig, 'build'>;
  /** Queued PRD id for stack artifact recording. */
  prdId?: string;
  /** Resolved stack context for queued stacked builds. */
  stackContext?: StackBaseContext;
  /** Landing action for this build (canonical: pr | merge | leave). */
  landingAction?: LandingConfig['action'];
  /** Configured PR auto-merge policy (from landing.pr.autoMerge). */
  prAutoMergePolicy?: 'ask' | 'always' | 'never';
  /** Per-run PR auto-merge intent (from landingAutoMerge option/frontmatter). */
  landingAutoMerge?: boolean;
  /** Instantiated stack provider adapter for git-spice landing (stacked builds only). */
  stackProvider?: StackProviderAdapter;
  /** Resolved validation waiver config for allowNoCommands and allowEmptyPrdDiff gates. */
  validationPolicy?: ValidationConfig;
  /** Expected acceptance criteria derived from the PRD or plan files. When defined, the
   *  prdValidate phase enforces that every criterion receives a verdict (synthesizing
   *  unknown for any not covered by the validator). When no prdValidator is configured
   *  and this array is defined, the build fails unless an explicit waiver is active. */
  expectedAcceptanceCriteria?: import('./validation/acceptance-criteria.js').ExpectedAcceptanceCriterion[];
  /** Resume seed for compiled-build resume. When provided, merged plans are seeded from prior
   *  build evidence and resume context is injected into builder prompts. */
  resumeSeed?: ResumeSeedOptions;
}

/**
 * Create fresh in-memory state for a plan set.
 *
 * Always creates a new, clean state — there is no resume path.
 * Active build orchestration state lives in memory only; no state.json is written.
 * The featureBranch and worktreeBase are computed deterministically from the
 * config name and repoRoot, so compile→build handoff does not require a JSON file.
 *
 * Returns `{ state }` — the fresh EforgeState for this build session.
 */
export function initializeState(
  config: OrchestrationConfig,
  repoRoot: string,
): { state: EforgeState } {
  const worktreeBase = computeWorktreeBase(repoRoot, config.name);

  const plans: Record<string, PlanState> = {};
  for (const plan of config.plans) {
    plans[plan.id] = {
      status: 'pending',
      branch: plan.branch,
      dependsOn: plan.dependsOn,
      merged: false,
    };
  }

  const state: EforgeState = {
    setName: config.name,
    status: 'running',
    startedAt: new Date().toISOString(),
    baseBranch: config.baseBranch,
    featureBranch: `eforge/${config.name}`,
    worktreeBase,
    plans,
    completedPlans: [],
  };

  return { state };
}

/**
 * Options for seeding orchestrator state from a prior compiled-build run.
 * Passed from the resume entry point after eligibility is confirmed.
 */
export interface ResumeSeedOptions {
  /**
   * Plan IDs with merge-complete evidence from the prior run.
   * These will be seeded as status='merged' and merged=true so the scheduler
   * treats them as dependency-satisfied without re-running them.
   */
  seededMerged: string[];
  /**
   * Per-plan resume context text keyed by plan ID.
   * Injected into builder prompts via BuildStageContext.resumeContext.
   */
  resumeContextByPlan: Map<string, string>;
}

/**
 * Apply resume seed to an already-initialized EforgeState.
 *
 * Mutates the state in place:
 * - Plans in seededMerged → status='merged', merged=true, added to completedPlans.
 * - Plans already at 'pending' that are NOT in seededMerged remain pending (no-op).
 * - Plans not present in state.plans are silently ignored (history may contain
 *   plans that were removed from orchestration.yaml).
 */
export function applyResumeSeed(state: EforgeState, seed: ResumeSeedOptions): void {
  for (const planId of seed.seededMerged) {
    const plan = state.plans[planId];
    if (!plan) continue;
    updatePlanStatus(state, planId, 'merged');
    plan.merged = true;
  }
}

export class Orchestrator {
  private readonly options: OrchestratorOptions;

  constructor(options: OrchestratorOptions) {
    this.options = options;
  }

  async *execute(config: OrchestrationConfig): AsyncGenerator<EforgeEvent> {
    const { repoRoot, signal } = this.options;
    const { state } = initializeState(config, repoRoot);
    // Apply resume seed when the caller has reconstructed prior build state.
    if (this.options.resumeSeed) {
      applyResumeSeed(state, this.options.resumeSeed);
    }
    const featureBranch = `eforge/${config.name}`;
    // Compute mergeWorktreePath deterministically; options.mergeWorktreePath overrides for testing
    const mergeWorktreePath = this.options.mergeWorktreePath ?? join(computeWorktreeBase(repoRoot, config.name), '__merge__');
    try { await exec('git', ['rev-parse', '--verify', featureBranch], { cwd: repoRoot }); } catch { throw new Error(`Feature branch '${featureBranch}' not found — it should have been created during compile`); }
    const wm = new WorktreeManager({ repoRoot, worktreeBase: state.worktreeBase, featureBranch, mergeWorktreePath });
    const planMap = new Map(config.plans.map((p) => [p.id, p]));
    const ctx: PhaseContext = {
      state, config, repoRoot, featureBranch, mergeWorktreePath,
      planRunner: this.options.planRunner, parallelism: config.plans.length || 1,
      signal, postMergeCommands: this.options.postMergeCommands, validateCommands: this.options.validateCommands,
      postMergeCommandTimeoutMs: this.options.postMergeCommandTimeoutMs,
      validationFixer: this.options.validationFixer, maxValidationRetries: this.options.maxValidationRetries ?? 2,
      mergeResolver: this.options.mergeResolver, prdValidator: this.options.prdValidator,
      acceptanceUnknownResolver: this.options.acceptanceUnknownResolver,
      gapCloser: this.options.gapCloser,
      minCompletionPercent: this.options.minCompletionPercent ?? 75, worktreeManager: wm,
      failedMerges: new Set<string>(), recentlyMergedIds: [],
      landingSucceeded: false,
      gapClosePerformed: false,
      modelTracker: new ModelTracker(),
      shouldCleanup: this.options.shouldCleanup, cleanupPlanSet: this.options.cleanupPlanSet,
      cleanupOutputDir: this.options.cleanupOutputDir, cleanupPrdFilePath: this.options.cleanupPrdFilePath,
      extensionRegistry: this.options.extensionRegistry,
      policyGateTimeoutMs: this.options.policyGateTimeoutMs,
      policyGateFailurePolicy: this.options.policyGateFailurePolicy,
      engineConfig: this.options.engineConfig,
      prdId: this.options.prdId,
      stackContext: this.options.stackContext,
      landingAction: this.options.landingAction ?? 'merge',
      prAutoMergePolicy: this.options.prAutoMergePolicy,
      landingAutoMerge: this.options.landingAutoMerge,
      stackProvider: this.options.stackProvider,
      validationPolicy: this.options.validationPolicy,
      expectedAcceptanceCriteria: this.options.expectedAcceptanceCriteria,
    };
    try {
      yield* executePlans(ctx);
      if ((state.status as string) !== 'failed') yield* syncDirectPrBaseBeforeValidation(ctx);
      if ((state.status as string) !== 'failed') yield* validate(ctx);
      if ((state.status as string) !== 'failed') yield* prdValidate(ctx);
      // After gap close, rerun both validate and prdValidate to confirm the fixes
      // satisfy both validation commands and acceptance criteria.
      if ((state.status as string) !== 'failed' && ctx.gapClosePerformed) {
        yield* validate(ctx);
        if ((state.status as string) !== 'failed') yield* prdValidate(ctx);
      }
      if ((state.status as string) !== 'failed') yield* recordArtifact(ctx);
      // Stack landing runs unconditionally so it can persist skipped outcomes
      // when the build failed before landing could be attempted.
      yield* stackLanding(ctx);
      if ((state.status as string) !== 'failed') yield* finalize(ctx);
    } finally {
      await wm.cleanupAll();
      for (const [, plan] of planMap) { try { await exec('git', ['branch', '-D', plan.branch], { cwd: repoRoot }); } catch { /* best-effort */ } }
      // Only delete the feature branch when it was merged into base — for pr and leave
      // the branch must be preserved so the PR or manual workflow can reference it.
      if (ctx.landingSucceeded && ctx.landingAction === 'merge') { try { await exec('git', ['branch', '-D', featureBranch], { cwd: repoRoot }); } catch { /* best-effort */ } }
    }
  }
}
