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
  AgentTerminalSubtype,
  ShardScope,
  PipelineComposition,
  // --- eforge:region plan-01-stack-contracts-config-state-events ---
  StackProvider,
  LandingPublicationAction,
  // --- eforge:endregion plan-01-stack-contracts-config-state-events ---
} from '@eforge-build/client';

export {
  ORCHESTRATION_MODES,
  SEVERITY_ORDER,
  isAlwaysYieldedAgentEvent,
  EforgeEventSchema,
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
  /** Override the base ref used to create the compile/merge worktree. */
  baseBranchOverride?: string;
  // --- eforge:endregion plan-02-artifact-aware-queue-base-resolution ---
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
  /** Logical stack identifier to persist in PRD frontmatter. */
  stack_id?: string;
  /** Parent PRD id for this stack layer, if any. */
  stack_parent?: string;
  /** Stack provider override for this PRD. */
  stack_provider?: 'git-spice';
  // --- eforge:endregion plan-01-engine-config-and-landing ---
}
