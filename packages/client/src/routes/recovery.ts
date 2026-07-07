import { FormatRegistry, Type } from '@sinclair/typebox';
import type { Static } from '@sinclair/typebox';
import {
  CompileScopeContextFailureKindSchema,
  CompileScopeContextSourceSchema,
  DecompositionFailureEvidenceSchema,
  type CompileScopeContextFailure,
  type RecoveryVerdict,
} from '../events.js';

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
 * is idempotent (no duplicate queue mutation, no repeated Console prompt).
 *
 * The base recovery actions use an `appliedAt` marker. The `accepted-success`
 * action uses its own rich `AcceptSuccessAppliedSummary` shape (keyed by
 * `acceptedAt`), which is unioned in below. The union stays forward compatible
 * with later recovery actions.
 */
interface RecoveryAppliedMetadataBase {
  /** ISO timestamp when the action was applied. */
  appliedAt: string;
  /** Commit SHA produced by the apply, when one was created. */
  commitSha?: string;
}

/** Applied marker for recovery actions that mutate queue state. */
export interface RecoveryActionAppliedMetadata extends RecoveryAppliedMetadataBase {
  action: 'retry' | 'continue-repair' | 'abandon';
}

/**
 * Durable applied marker union. `accepted-success` is the rich
 * `AcceptSuccessAppliedSummary` (keyed by `acceptedAt`, carrying reason / cleanup
 * / landing / dependents); the other actions use the `appliedAt`-based shape.
 */
export type RecoveryAppliedMetadata =
  | RecoveryActionAppliedMetadata
  | AcceptSuccessAppliedSummary;

export interface RecoverySidecarReport {
  operatorSummary: string;
  recommendedAction: string;
  rootFailure?: {
    planId?: string;
    scope?: string;
    stage?: string;
    message?: string;
  };
  keyEvidence: string[];
  completedWork: string[];
  remainingWork: string[];
  risks: string[];
  evidenceOmissions?: string[];
}

export interface RecoverySidecarBoundedEvidence {
  identity: {
    prdId: string;
    setName: string;
    featureBranch: string;
    baseBranch: string;
    failedAt: string;
    partial?: boolean;
  };
  plans: Array<{ planId: string; status: string; error?: string; terminalSubtype?: string; commitSha?: string }>;
  failingPlan: { planId: string; errorMessage?: string; terminalSubtype?: string };
  failingPlans?: Array<{ planId: string; errorMessage?: string; terminalSubtype?: string }>;
  landedCommits: Array<{ sha: string; subject: string; author: string; date: string }>;
  modelsUsed: string[];
  terminalFailure?: Record<string, string | boolean | number | undefined>;
  acceptanceValidation?: {
    passed: boolean;
    total: number;
    pass: number;
    fail: number;
    unknown: number;
    verdicts: Array<{ criterion: string; verdict: 'pass' | 'fail' | 'unknown'; evidence: string }>;
    omittedEvidenceCount?: number;
  };
  validationCommands?: Array<{ command: string; exitCode: number; outputPreview?: string; truncated?: boolean }>;
  landing?: { status: string; action?: string; reason?: string };
  reviewFailure?: unknown;
  diffStat?: string;
  evidenceOmissions?: string[];
}

export type RecoverySidecarSchemaVersion = 3 | 4 | 5;

export interface RecoverySidecarAutoResumeState {
  attempts?: number;
  lastFailureSignature?: string;
  lastProgressMarker?: string;
  lastAttemptAt?: string;
  stoppedReason?: string;
  stoppedAt?: string;
}

/**
 * JSON structure written by `eforge recover` into `<prdId>.recovery.json`.
 * Concise sidecar contract: top-level identity, verdict, operator report,
 * bounded evidence, generated timestamp, optional read-only continue-and-repair
 * fields (`continueRepairEligibility` and `recoveryOptions`), optional
 * durable `applied` marker, and optional daemon `autoResume` audit state.
 * Version 4 is used when compile-scope-context
 * recovery guidance is present; version 5 is required when that guidance
 * carries decomposition evidence. schemaVersion 3 sidecars must not contain
 * compile-scope-context recovery options.
 */
export interface RecoveryVerdictSidecar {
  schemaVersion: RecoverySidecarSchemaVersion;
  generatedAt: string;
  prdId: string;
  setName: string;
  verdict: RecoveryVerdict;
  report: RecoverySidecarReport;
  boundedEvidence: RecoverySidecarBoundedEvidence;
  /** Read-only continue-and-repair eligibility captured when the sidecar was generated. */
  continueRepairEligibility?: RecoverySidecarContinueRepairEligibility;
  /** Optional recovery options that point operators to routes outside apply-recovery. */
  recoveryOptions?: RecoverySidecarRecoveryOption[];
  /** Durable applied marker; absent on sidecars written before a verdict is applied. */
  applied?: RecoveryAppliedMetadata;
  /** Bounded automatic recovery audit state written by daemon auto-resume. */
  autoResume?: RecoverySidecarAutoResumeState;
}

/** Response for GET /api/recovery/sidecar */
export interface ReadSidecarResponse {
  markdown: string;
  json: RecoveryVerdictSidecar;
}

/** POST /api/recover/continue-repair */
export interface ContinueRepairRequest {
  prdId: string;
  /** Override set name; when omitted, resolved from the recovery sidecar or prdId. */ setName?: string;
  /** Override active profile for this continued build (validated before requeue). */ profile?: string;
}

/** Response for POST /api/recover/continue-repair */
export interface ContinueRepairResponse {
  kind: 'queued'; prdId: string; setName: string;
  featureBranch: string; baseBranch: string;
  movedDescendantIds: string[]; /** Effective queued PRD profile frontmatter, when one is present. */ profile?: string;
  /** Queue mutation status; `already-queued` makes the operation idempotent. */ status: 'queued' | 'already-queued'; detail?: string;
}

/**
 * Query params for GET /api/recover/continue-repair/eligibility. When `setName`
 * is omitted the daemon resolves it from the recovery sidecar (`setName`), else
 * `prdId`.
 */
export interface ContinueRepairEligibilityRequest {
  prdId: string;
  setName?: string;
}

export type ContinueRepairArtifactAvailability = 'merge-worktree' | 'feature-branch' | 'branch-history';

export type RecoverySidecarContinueRepairEligibilitySource = 'continueRepairEligibility' | 'inspection-error';

export type RecoverySidecarContinueRepairEligibility =
  | {
      source: RecoverySidecarContinueRepairEligibilitySource;
      eligible: true;
      featureBranch: string;
      artifactAvailability: ContinueRepairArtifactAvailability;
      artifactCommit?: string;
      landedCommitCount: number;
      diffStat: string;
      failingPlanId?: string;
      partial?: boolean;
    }
  | {
      source: RecoverySidecarContinueRepairEligibilitySource;
      eligible: false;
      featureBranch: string;
      reason: string;
      checkedPath?: string;
    };

export const RECOVERY_SIDECAR_COMPILE_SCOPE_CONTEXT_ACTIONS = ['bounded-decomposition', 'manual-reduce-scope'] as const;
export const RECOVERY_SIDECAR_COMPILE_SCOPE_CONTEXT_REASON_MAX_BYTES = 1_000;

const RECOVERY_SIDECAR_COMPILE_SCOPE_CONTEXT_REASON_FORMAT = 'eforge-recovery-sidecar-compile-scope-context-reason-bytes';

FormatRegistry.Set(
  RECOVERY_SIDECAR_COMPILE_SCOPE_CONTEXT_REASON_FORMAT,
  (value) => new TextEncoder().encode(value).length <= RECOVERY_SIDECAR_COMPILE_SCOPE_CONTEXT_REASON_MAX_BYTES,
);

const NonNegativeIntegerSchema = Type.Integer({ minimum: 0 });
const PositiveIntegerSchema = Type.Integer({ minimum: 1 });

export const RecoverySidecarContinueRepairOptionSchema = Type.Object({
  kind: Type.Literal('continue-repair'),
  action: Type.Literal('continue-repair'),
  recommended: Type.Boolean(),
  reason: Type.String(),
});

export const RecoverySidecarCompileScopeContextActionSchema = Type.Union([
  Type.Literal('bounded-decomposition'),
  Type.Literal('manual-reduce-scope'),
]);

const RecoverySidecarCompileScopeContextOptionBaseSchema = Type.Object({
  kind: Type.Literal('compile-scope-context'),
  action: RecoverySidecarCompileScopeContextActionSchema,
  recommended: Type.Boolean(),
  eligible: Type.Boolean(),
  reason: Type.String({
    minLength: 1,
    maxLength: RECOVERY_SIDECAR_COMPILE_SCOPE_CONTEXT_REASON_MAX_BYTES,
    format: RECOVERY_SIDECAR_COMPILE_SCOPE_CONTEXT_REASON_FORMAT,
  }),
  attempted: Type.Boolean(),
  attempt: NonNegativeIntegerSchema,
  maxAttempts: PositiveIntegerSchema,
  source: CompileScopeContextSourceSchema,
  failureKind: CompileScopeContextFailureKindSchema,
  decompositionEvidence: Type.Optional(DecompositionFailureEvidenceSchema),
});

const NonDecompositionCompileScopeContextSourceSchema = Type.Union([
  Type.Literal('preflight'),
  Type.Literal('live-context-guard'),
  Type.Literal('provider'),
]);

const NonExhaustedCompileScopeContextFailureKindSchema = Type.Union([
  Type.Literal('context-budget'),
  Type.Literal('context-window'),
  Type.Literal('context-length'),
  Type.Literal('scope-too-broad'),
]);

export const RecoverySidecarCompileScopeContextOptionSchema: typeof RecoverySidecarCompileScopeContextOptionBaseSchema = Type.Intersect([
  RecoverySidecarCompileScopeContextOptionBaseSchema,
  Type.Union([
    Type.Object({ source: Type.Literal('decomposition'), failureKind: Type.Literal('decomposition-exhausted'), decompositionEvidence: DecompositionFailureEvidenceSchema }),
    Type.Object({ source: NonDecompositionCompileScopeContextSourceSchema, failureKind: NonExhaustedCompileScopeContextFailureKindSchema, decompositionEvidence: Type.Optional(Type.Never()) }),
  ]),
]) as unknown as typeof RecoverySidecarCompileScopeContextOptionBaseSchema;

Object.assign(RecoverySidecarCompileScopeContextOptionSchema, { properties: RecoverySidecarCompileScopeContextOptionBaseSchema.properties });

export const RecoverySidecarRecoveryOptionSchema = Type.Union([
  RecoverySidecarContinueRepairOptionSchema,
  RecoverySidecarCompileScopeContextOptionSchema,
]);

export type RecoverySidecarContinueRepairOption = Static<typeof RecoverySidecarContinueRepairOptionSchema>;
export type RecoverySidecarCompileScopeContextAction = typeof RECOVERY_SIDECAR_COMPILE_SCOPE_CONTEXT_ACTIONS[number];
type RecoverySidecarCompileScopeContextOptionBase = Static<typeof RecoverySidecarCompileScopeContextOptionBaseSchema>;
export type RecoverySidecarCompileScopeContextOption =
  | (Omit<RecoverySidecarCompileScopeContextOptionBase, 'source' | 'failureKind' | 'decompositionEvidence'> & {
      source: 'decomposition';
      failureKind: 'decomposition-exhausted';
      decompositionEvidence: NonNullable<CompileScopeContextFailure['decompositionEvidence']>;
    })
  | (Omit<RecoverySidecarCompileScopeContextOptionBase, 'source' | 'failureKind' | 'decompositionEvidence'> & {
      source: Static<typeof NonDecompositionCompileScopeContextSourceSchema>;
      failureKind: Static<typeof NonExhaustedCompileScopeContextFailureKindSchema>;
      decompositionEvidence?: never;
    });
export type RecoverySidecarRecoveryOption = RecoverySidecarContinueRepairOption | RecoverySidecarCompileScopeContextOption;

interface ContinueRepairEligibilityIdentity {
  prdId: string;
  setName: string;
  featureBranch: string;
}

/** Response for GET /api/recover/continue-repair/eligibility — a read-only preflight. */
export type ContinueRepairEligibilityResponse =
  | (ContinueRepairEligibilityIdentity & {
      eligible: true;
      artifactAvailability: ContinueRepairArtifactAvailability;
      artifactCommit?: string;
      landedCommitCount: number;
      diffStat: string;
      failingPlanId?: string;
      partial?: boolean;
    })
  | (ContinueRepairEligibilityIdentity & { eligible: false; reason: string; checkedPath?: string });

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
  verdict: 'retry' | 'continue-repair' | 'abandon' | 'manual';
  /** Optional commit SHA, present and meaningful only when the apply action creates a commit. */
  commitSha?: string;
  /** True when the verdict was `manual` and no git changes were made. */
  noAction?: boolean;
  /**
   * Apply idempotency status. `applied` on first successful apply;
   * `already-applied` when a durable applied marker or queue preflight shows the
   * verdict was applied previously. Absent for verdicts that do not record a
   * durable marker.
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
