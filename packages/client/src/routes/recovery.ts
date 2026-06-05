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

/**
 * Durable record that a recovery verdict was applied to a failed PRD. Persisted
 * as the optional `applied` field on `<prdId>.recovery.json` so a repeated apply
 * is idempotent (no duplicate successor enqueue, no repeated Console prompt).
 *
 * Action-discriminated: a `split` marker requires `successorPrdId` (the apply
 * enqueues exactly one successor and idempotent Console UX needs the id);
 * `retry`/`abandon` do not carry one. The `accepted-success` action uses its own
 * rich `AcceptSuccessAppliedSummary` shape (keyed by `acceptedAt`), which is
 * unioned in below. The union stays forward compatible with later recovery
 * actions.
 */
interface RecoveryAppliedMetadataBase {
  /** ISO timestamp when the action was applied. */
  appliedAt: string;
  /** Commit SHA produced by the apply, when one was created. */
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
  action: 'retry' | 'abandon';
  /** Not used by non-split applies; retained for forward compatibility. */
  successorPrdId?: undefined;
}

/**
 * Durable applied marker union. `accepted-success` is the rich
 * `AcceptSuccessAppliedSummary` (keyed by `acceptedAt`, carrying reason / cleanup
 * / landing / dependents); the other actions use the `appliedAt`-based shapes.
 */
export type RecoveryAppliedMetadata =
  | RecoverySplitAppliedMetadata
  | RecoveryNonSplitAppliedMetadata
  | AcceptSuccessAppliedSummary;

/**
 * JSON structure written by `eforge recover` into `<prdId>.recovery.json`.
 * Mirrors the current engine sidecar shape produced by `writeRecoverySidecar`
 * (schemaVersion: 2), including the optional `applied` marker.
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
  /** Durable applied marker; absent on sidecars written before a verdict is applied. */
  applied?: RecoveryAppliedMetadata;
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
  /**
   * Apply idempotency status. `applied` on first successful apply;
   * `already-applied` when a durable applied marker or a live successor scan
   * shows the verdict was applied previously. Absent for verdicts that do not
   * yet record a durable marker.
   */
  status?: 'applied' | 'already-applied';
  /** Human-readable detail about the apply outcome (e.g. idempotency notice). */
  detail?: string;
}

/**
 * Accept-build-as-successful recovery action contracts.
 *
 * The accepted-success action is a focused human recovery path for failed PRDs
 * whose implementation and deterministic checks are acceptable but final PRD or
 * acceptance validation failed (bad/conflicting/externally-unverifiable
 * criterion). Preview is read-only; apply mutates only after explicit user
 * confirmation and reuses the durable sidecar `applied` marker for idempotency.
 */

/** Reason category required when accepting a failed build as successful. */
export type AcceptSuccessReasonCategory =
  | 'bad_acceptance_criterion'
  | 'manual_verification_passed'
  | 'external_or_inconclusive_criterion_waived'
  | 'other';

/** Canonical, ordered list of accepted-success reason categories. */
export const ACCEPT_SUCCESS_REASON_CATEGORIES: readonly AcceptSuccessReasonCategory[] = [
  'bad_acceptance_criterion',
  'manual_verification_passed',
  'external_or_inconclusive_criterion_waived',
  'other',
] as const;

/** Effective landing action applied to the accepted build. */
export type AcceptSuccessLandingAction = 'pr' | 'merge' | 'leave';

/** GET /api/recover/accept-success/preview query params. */
export interface AcceptSuccessPreviewRequest {
  prdId: string;
}

/** Cleanup effects that an accepted-success apply will produce. */
export interface AcceptSuccessCleanupEffect {
  /** Plan set name whose plan files would be cleaned up. */
  planSet: string;
  /** True when plan artifact files exist on the feature branch. */
  planArtifactsPresent: boolean;
  /** True when the PRD provenance artifact exists on the feature branch. */
  prdArtifactPresent: boolean;
  /** True when applying would create a cleanup commit (artifacts present). */
  willCommit: boolean;
}

/**
 * Preview/audit context fields surfaced for an accepted-success confirmation.
 * These are read from the retained recovery sidecar / build-failure summary to
 * provide confirmation and audit context; they are NOT part of the durable
 * `AcceptSuccessAppliedSummary` written by an apply (which records action,
 * acceptedAt, reason, cleanup, landing, and dependents).
 */
export interface AcceptSuccessAuditFields {
  setName: string;
  featureBranch: string;
  baseBranch: string;
  landedCommitCount: number;
}

/** A direct skipped dependent candidate that may be unblocked on apply. */
export interface AcceptSuccessDependentCandidate {
  prdId: string;
  title: string;
  /** Remaining `depends_on` after removing the accepted PRD id. */
  remainingDependencies: string[];
  /** True when every remaining dependency is already satisfied. */
  unblockable: boolean;
  /** Remaining dependency ids that still block this dependent. */
  blockedBy: string[];
}

/** Result of the cleanup step of an accepted-success apply. */
export interface AcceptSuccessCleanupResult {
  status: 'committed' | 'noop';
  /** Cleanup commit SHA when `status === 'committed'`. */
  commitSha?: string;
}

export type AcceptSuccessAutoMergeResult =
  | { status: 'complete' }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; reason: string };

/** Result of the landing step of an accepted-success apply. */
export interface AcceptSuccessLandingResult {
  action: AcceptSuccessLandingAction;
  status: 'complete' | 'skipped' | 'failed';
  /** PR URL when `action === 'pr'` and a PR was opened. */
  prUrl?: string;
  /** Merge commit SHA when `action === 'merge'` and the merge completed. */
  mergeCommitSha?: string;
  /** Feature branch name (always reported for `leave`, best-effort otherwise). */
  branch?: string;
  /** Failure/skipped reason when `status` is `failed` or `skipped`. */
  reason?: string;
  /** Auto-merge audit result for accepted-success PR landing. */
  autoMerge?: AcceptSuccessAutoMergeResult;
}

/** Result of moving selected skipped dependents back to the queue root. */
export interface AcceptSuccessDependentResult {
  /** Dependent ids moved from `skipped/` to the queue root. */
  unblocked: string[];
  /** Selected dependent ids that remained blocked by other dependencies. */
  remainedBlocked: string[];
  /** Selected ids that were not direct skipped dependents of the accepted PRD. */
  notFound: string[];
}

/** Durable accepted-success applied metadata recorded on the recovery sidecar. */
export interface AcceptSuccessAppliedSummary {
  action: 'accepted-success';
  /** ISO timestamp when the build was accepted as successful. */
  acceptedAt: string;
  reasonCategory: AcceptSuccessReasonCategory;
  reason: string;
  cleanup: AcceptSuccessCleanupResult;
  landing: AcceptSuccessLandingResult;
  dependents: AcceptSuccessDependentResult;
}

/** Response for GET /api/recover/accept-success/preview. */
export interface AcceptSuccessPreviewResponse {
  prdId: string;
  status: 'eligible' | 'ineligible' | 'already-applied';
  /** Present when `status === 'ineligible'`: human-readable reason. */
  reason?: string;
  /** Effective landing action resolved from failed PRD frontmatter or project configuration. */
  landingAction: AcceptSuccessLandingAction;
  /** Per-run PR auto-merge intent from failed PRD frontmatter, when present. */
  landingAutoMerge?: boolean;
  /** Effective PR auto-merge outcome after applying landing.pr.autoMerge policy; only present for PR landing. */
  effectiveLandingAutoMerge?: boolean;
  cleanup: AcceptSuccessCleanupEffect;
  audit: AcceptSuccessAuditFields;
  dependentCandidates: AcceptSuccessDependentCandidate[];
  /** Present when `status === 'already-applied'`: the recorded apply metadata. */
  applied?: AcceptSuccessAppliedSummary;
}

/** POST /api/recover/accept-success request body. */
export interface AcceptSuccessRequest {
  prdId: string;
  reasonCategory: AcceptSuccessReasonCategory;
  reason: string;
  /** Selected direct skipped dependent ids to unblock. */
  unblockDependentIds: string[];
}

/** Response for POST /api/recover/accept-success. */
export interface AcceptSuccessResponse {
  prdId: string;
  status: 'applied' | 'already-applied';
  applied: AcceptSuccessAppliedSummary;
}
