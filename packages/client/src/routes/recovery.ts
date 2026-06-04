import type { BuildFailureSummary, RecoveryVerdict } from '../events.js';

/** POST /api/recover */
export interface RecoverRequest {
  setName: string;
  prdId: string;
}

/** Response for POST /api/recover */
export interface RecoverResponse {
  sessionId: string;
  pid: number;
}

/** Query params for GET /api/recovery/sidecar */
export interface ReadSidecarRequest {
  prdId: string;
}

// --- eforge:region plan-01-durable-recovery-applied-state ---
/**
 * Durable record that a recovery verdict was applied to a failed PRD. Persisted
 * as the optional `applied` field on `<prdId>.recovery.json` so a repeated apply
 * is idempotent (no duplicate successor enqueue, no repeated Console prompt).
 *
 * Action-discriminated: a `split` marker requires `successorPrdId` (the apply
 * enqueues exactly one successor and idempotent Console UX needs the id);
 * non-split actions do not carry one. `commitSha` is reserved for the
 * `accepted-success` action added by plan-02. The union stays forward compatible
 * with later recovery actions.
 */
interface RecoveryAppliedMetadataBase {
  /** ISO timestamp when the action was applied. */
  appliedAt: string;
  /** Commit SHA produced by an `accepted-success` apply (reserved for plan-02). */
  commitSha?: string;
}

/**
 * Applied marker for a `split` verdict. `successorPrdId` is required: a split
 * apply enqueues exactly one successor, and idempotent Console UX depends on the
 * identifier being present.
 */
export interface RecoverySplitAppliedMetadata extends RecoveryAppliedMetadataBase {
  action: 'split';
  /** Successor PRD id enqueued by the `split` apply. */
  successorPrdId: string;
}

/** Applied marker for non-split verdicts (no successor is enqueued). */
export interface RecoveryNonSplitAppliedMetadata extends RecoveryAppliedMetadataBase {
  action: 'retry' | 'abandon' | 'accepted-success';
  /** Not used by non-split applies; retained for forward compatibility. */
  successorPrdId?: undefined;
}

export type RecoveryAppliedMetadata = RecoverySplitAppliedMetadata | RecoveryNonSplitAppliedMetadata;
// --- eforge:endregion plan-01-durable-recovery-applied-state ---

/**
 * JSON structure written by `eforge recover` into `<prdId>.recovery.json`.
 * Mirrors the shape produced by `writeRecoverySidecar` in the engine (schemaVersion: 1).
 *
 * `summary` and `verdict` use the shared wire types from @eforge-build/client so
 * new optional fields (e.g. failingPlans, commitSha, testPassed) are automatically
 * reflected here without requiring separate maintenance of this interface.
 * Legacy sidecars without the new optional fields still parse because all added
 * fields are optional.
 */
export interface RecoveryVerdictSidecar {
  schemaVersion: number;
  generatedAt: string;
  summary: BuildFailureSummary;
  verdict: RecoveryVerdict;
  // --- eforge:region plan-01-durable-recovery-applied-state ---
  /** Durable applied marker; absent on sidecars written before a verdict is applied. */
  applied?: RecoveryAppliedMetadata;
  // --- eforge:endregion plan-01-durable-recovery-applied-state ---
}

/** Response for GET /api/recovery/sidecar */
export interface ReadSidecarResponse {
  markdown: string;
  json: RecoveryVerdictSidecar;
}

/** POST /api/recover/resume-build */
export interface ResumeBuildRequest {
  prdId: string;
  /** Override set name; when omitted, resolved from the recovery sidecar or prdId. */ setName?: string;
  /** Override active profile for this resumed build (validated before requeue). */ profile?: string;
}

/** Response for POST /api/recover/resume-build */
export interface ResumeBuildResponse {
  kind: 'queued'; prdId: string; setName: string;
  featureBranch: string; baseBranch: string;
  movedDescendantIds: string[]; /** Effective queued PRD profile frontmatter, when one is present. */ profile?: string;
  /** Queue mutation status; `already-queued` makes the operation idempotent. */ status?: 'queued' | 'already-queued'; detail?: string;
}

/**
 * Query params for GET /api/recover/resume-eligibility. When `setName` is omitted
 * the daemon resolves it from the recovery sidecar (`summary.setName`), else `prdId`.
 */
export interface ResumeEligibilityRequest {
  prdId: string;
  setName?: string;
}

export type ResumeArtifactAvailability = 'merge-worktree' | 'feature-branch' | 'branch-history';

interface ResumeEligibilityIdentity {
  prdId: string;
  setName: string;
  featureBranch: string;
}

/** Response for GET /api/recover/resume-eligibility — a read-only preflight. */
export type ResumeEligibilityResponse =
  | (ResumeEligibilityIdentity & {
      eligible: true;
      artifactAvailability: ResumeArtifactAvailability;
      artifactCommit?: string;
      landedCommitCount: number;
      diffStat: string;
      failingPlanId?: string;
      partial?: boolean;
    })
  | (ResumeEligibilityIdentity & { eligible: false; reason: string; checkedPath?: string });

/** POST /api/recover/apply */
export interface ApplyRecoveryRequest {
  prdId: string;
}

/**
 * Response for POST /api/recover/apply.
 *
 * The route applies the recovery verdict synchronously in-process and returns
 * the outcome directly. Replaces the old `{ sessionId, pid }` shape (v16) which
 * returned a detached worker's identifiers before the mutation completed.
 */
export interface ApplyRecoveryResponse {
  /** The verdict that was applied. */
  verdict: 'retry' | 'split' | 'abandon' | 'manual';
  /** SHA of the commit produced by the apply operation. Absent for `manual` (no-op). */
  commitSha?: string;
  /** ID of the successor PRD enqueued by a `split` verdict. */
  successorPrdId?: string;
  /** True when the verdict was `manual` and no git changes were made. */
  noAction?: boolean;
  // --- eforge:region plan-01-durable-recovery-applied-state ---
  /**
   * Apply idempotency status. `applied` on first successful apply;
   * `already-applied` when a durable applied marker or a live successor scan
   * shows the verdict was applied previously. Absent for verdicts that do not
   * yet record a durable marker.
   */
  status?: 'applied' | 'already-applied';
  /** Human-readable detail about the apply outcome (e.g. idempotency notice). */
  detail?: string;
  // --- eforge:endregion plan-01-durable-recovery-applied-state ---
}
