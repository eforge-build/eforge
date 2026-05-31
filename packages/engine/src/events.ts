// EforgeEvent discriminated union and all supporting types
//
// Wire-protocol types are defined in @eforge-build/client and re-exported
// here so engine code continues to import from './events.js' without changes.

export type {
  EforgeEvent,
  AgentRole,
  AgentResultData,
  EforgeResult,
  ClarificationQuestion,
  ReviewIssue,
  PlanFile,
  OrchestrationConfig,
  PlanState,
  EforgeState,
  ExpeditionModule,
  PrdValidationGap,
  // --- eforge:region plan-01-validation-evidence-contract ---
  AcceptanceCriterionVerdict,
  // --- eforge:endregion plan-01-validation-evidence-contract ---
  TestIssue,
  BuildFailureSummary,
  LandedCommit,
  PlanSummaryEntry,
  FailingPlanEntry,
  ReconciliationReport,
  EforgeStatus,
  QueueEvent,
  StalenessVerdict,
  RecoveryVerdict,
  ReviewPerspective,
  EvaluationIssueOutcome,
  AgentTerminalSubtype,
  ShardScope,
  PipelineComposition,
  // --- eforge:region plan-01-stack-contracts-config-state-events ---
  StackProvider,
  LandingPublicationAction,
  // --- eforge:endregion plan-01-stack-contracts-config-state-events ---
  // --- eforge:region plan-01-terminal-failure-contract ---
  TerminalFailureScope,
  TerminalFailureEnvelope,
  // --- eforge:endregion plan-01-terminal-failure-contract ---
  // --- eforge:region plan-01-engine-resume ---
  BuildResumeStartEvent,
  BuildResumeStateEvent,
  BuildResumeIneligibleEvent,
  BuildResumeCompleteEvent,
  // --- eforge:endregion plan-01-engine-resume ---
} from '@eforge-build/client';

export {
  ORCHESTRATION_MODES,
  SEVERITY_ORDER,
  isAlwaysYieldedAgentEvent,
  EforgeEventSchema,
  EvaluationIssueOutcomeSchema,
  // --- eforge:region plan-01-terminal-failure-contract ---
  TerminalFailureScopeSchema,
  TerminalFailureEnvelopeSchema,
  // --- eforge:endregion plan-01-terminal-failure-contract ---
} from '@eforge-build/client';

// Engine-only types not part of the wire protocol:

// --- eforge:region plan-02-artifact-aware-queue-base-resolution ---
import type { StackBaseContext } from './stacking/base-resolver.js';
// --- eforge:endregion plan-02-artifact-aware-queue-base-resolution ---
// --- eforge:region plan-02-stack-provider-runtime ---
import type { StackProviderAdapter } from './stacking/provider.js';
// --- eforge:endregion plan-02-stack-provider-runtime ---

export interface CompileOptions {
  auto?: boolean;
  verbose?: boolean;
  name?: string;
  cwd?: string;
  abortController?: AbortController;
  // --- eforge:region plan-02-artifact-aware-queue-base-resolution ---
  /** Override the logical/landing base branch (written to orchestration.yaml and used for PR/merge). */
  baseBranchOverride?: string;
  // --- eforge:endregion plan-02-artifact-aware-queue-base-resolution ---
  // --- eforge:region plan-01-pre-compile-trunk-sync-gate ---
  /**
   * Override the git ref used ONLY for `createMergeWorktree()`. When trunk sync
   * selects a fetched commit SHA (remote-ahead case), pass it here rather than
   * via `baseBranchOverride` so the logical/landing base branch stays as the
   * trunk branch name in orchestration.yaml.
   */
  worktreeBaseRefOverride?: string;
  // --- eforge:endregion plan-01-pre-compile-trunk-sync-gate ---
}

export interface BuildOptions {
  auto?: boolean;
  verbose?: boolean;
  dryRun?: boolean;
  cleanup?: boolean;
  cwd?: string;
  abortController?: AbortController;
  prdFilePath?: string;
  // --- eforge:region plan-02-artifact-aware-queue-base-resolution ---
  /** Queued PRD id for stack artifact recording. */
  prdId?: string;
  /** Resolved stack context for queued stacked builds. */
  stackContext?: StackBaseContext;
  // --- eforge:endregion plan-02-artifact-aware-queue-base-resolution ---
  // --- eforge:region plan-02-stack-provider-runtime ---
  /** Instantiated stack provider adapter for git-spice submission (stacked builds only). */
  stackProvider?: StackProviderAdapter;
  // --- eforge:endregion plan-02-stack-provider-runtime ---
  // --- eforge:region plan-01-engine-config-and-landing ---
  /** Override the configured landing action for this build. */
  landingAction?: 'pr' | 'merge' | 'leave';
  // --- eforge:endregion plan-01-engine-config-and-landing ---
  // --- eforge:region plan-01-core-engine-auto-merge ---
  /** Per-run PR auto-merge intent. Resolved against `landing.pr.autoMerge` policy. */
  landingAutoMerge?: boolean;
  // --- eforge:endregion plan-01-core-engine-auto-merge ---
}

export interface EnqueueOptions {
  name?: string;
  verbose?: boolean;
  auto?: boolean;
  abortController?: AbortController;
  /** Override profile name to persist in PRD frontmatter for per-build profile binding. */
  profile?: string;
  // --- eforge:region plan-01-engine-config-and-landing ---
  /** Override the configured landing action for this enqueued build. */
  landingAction?: 'pr' | 'merge' | 'leave';
  // --- eforge:region plan-01-core-engine-auto-merge ---
  /** Per-run PR auto-merge intent. Resolved against `landing.pr.autoMerge` policy. */
  landingAutoMerge?: boolean;
  // --- eforge:endregion plan-01-core-engine-auto-merge ---
  /** Logical stack identifier to persist in PRD frontmatter. */
  stack_id?: string;
  /** Parent PRD id for this stack layer, if any. */
  stack_parent?: string;
  /** Stack provider override for this PRD. */
  stack_provider?: 'git-spice';
  // --- eforge:endregion plan-01-engine-config-and-landing ---
  // --- eforge:region plan-01-build-dependency-core ---
  /**
   * Explicit upstream queue item id. When provided, the enqueued PRD gains
   * `depends_on: [afterQueueId]` and placement is determined by upstream state.
   * Overrides dependency-detector output when set.
   */
  afterQueueId?: string;
  // --- eforge:endregion plan-01-build-dependency-core ---
}
