/**
 * Hook handler and result types for eforge extensions.
 *
 * These types define the contracts for each registration method on
 * `EforgeExtensionAPI`. Runtime support varies by capability — see
 * `docs/extensions-api.md` for the runtime-support table.
 */

import type { EforgeEvent } from './events.js';
import type {
  EventHookContext,
  AgentRunContext,
  PolicyGateContext,
  QueueDispatchPolicyGateContext,
  PlanMergePolicyGateContext,
  FinalMergePolicyGateContext,
  AnyPolicyGateContext,
  ProfileRouterContext,
  InputTransformContext,
} from './context.js';
import type { ExtensionTool } from './tools.js';
import type { TObject } from '@sinclair/typebox';
import type { EventPattern } from './patterns.js';

// ---------------------------------------------------------------------------
// Event hook
// ---------------------------------------------------------------------------

/**
 * Handler for typed event hooks registered via `EforgeExtensionAPI.onEvent`.
 *
 * Event hooks are non-blocking — the return value (`void | Promise<void>`) is
 * awaited opportunistically and must not affect the build pipeline.
 *
 * @typeParam TType - The specific event type string being handled.
 */
export type EventHookHandler<TType extends EforgeEvent['type']> = (
  event: Extract<EforgeEvent, { type: TType }>,
  ctx: EventHookContext,
) => void | Promise<void>;

// ---------------------------------------------------------------------------
// Policy gate
// ---------------------------------------------------------------------------

/**
 * Discriminated union representing the outcome of a policy-gate evaluation.
 *
 * - `allow` — permit the operation to proceed.
 * - `block` — halt the operation with a human-readable `reason`.
 * - `require-approval` — halt and surface the `reason` as requiring manual
 *   approval; current engine integrations treat this as blocking until an
 *   approval workflow is added.
 *
 * Note: A `modify` variant (allowing the gate to mutate the operation payload)
 * is intentionally absent from this slice. It will be introduced only for hook
 * families that explicitly allow mutation, to avoid ambiguous mutation contracts.
 */
export type PolicyDecision =
  | { decision: 'allow' }
  | { decision: 'block'; reason: string }
  | { decision: 'require-approval'; reason: string };

/**
 * Handler for policy-gate hooks (e.g. `beforePlanMerge`).
 *
 * Policy gates return a `PolicyDecision` that determines whether the gated
 * operation is allowed, blocked, or held for approval.
 */
export type PolicyGateHandler<TContext extends AnyPolicyGateContext = PolicyGateContext> = (
  ctx: TContext,
) => PolicyDecision | Promise<PolicyDecision>;

/** Handler for `beforeQueueDispatch` policy gates. */
export type QueueDispatchPolicyGateHandler = PolicyGateHandler<QueueDispatchPolicyGateContext>;

/** Handler for `beforePlanMerge` policy gates. */
export type PlanMergePolicyGateHandler = PolicyGateHandler<PlanMergePolicyGateContext>;

/** Handler for `beforeFinalMerge` policy gates. */
export type FinalMergePolicyGateHandler = PolicyGateHandler<FinalMergePolicyGateContext>;

// ---------------------------------------------------------------------------
// Agent run hook
// ---------------------------------------------------------------------------

/**
 * Optional augmentation returned by an `onAgentRun` handler.
 *
 * All fields are optional. Unspecified fields leave the default agent run
 * configuration unchanged.
 *
 * Runtime applies `promptAppend`, per-run `tools`, and additive
 * `allowedTools`/`disallowedTools` availability tuning. Returned tools are
 * injected only for the run whose hook returned them; loader-time
 * `registerTool()` entries are provenance and validation metadata, not
 * automatic injection.
 */
export interface AgentRunAugmentation {
  /**
   * Additional text appended to the agent's prompt, wrapped in a named
   * provenance section identifying the contributing extension.
   *
   * Extension fragments are appended after any config-level `promptAppend`
   * already resolved by the engine. Use sparingly — large appended text can
   * degrade agent performance.
   */
  promptAppend?: string;
  /**
   * Additional `ExtensionTool` instances made available to the agent for this run.
   *
   * Existing engine custom tools keep precedence. Extension tools are appended
   * only when their bare name does not duplicate an existing custom tool or an
   * earlier accepted extension tool. A returned tool is skipped when it is
   * denied by the final denylist.
   */
  tools?: ExtensionTool<TObject>[];
  /**
   * Tool names explicitly allowed for this agent run.
   *
   * Values are merged additively with the run's base allowlist. When an
   * allowlist is active, the runtime also preserves harness-effective names for
   * engine custom tools and accepted extension tools.
   */
  allowedTools?: string[];
  /**
   * Tool names explicitly disallowed for this agent run.
   *
   * Values are merged additively with the run's base denylist. Deny wins: a
   * returned extension tool whose bare or harness-effective name is denied is
   * not injected into the run.
   */
  disallowedTools?: string[];
}

/**
 * Handler invoked before an agent run starts, allowing augmentation of the run.
 *
 * Return `undefined` or an empty `AgentRunAugmentation` to leave the run unchanged.
 */
export type AgentRunHandler = (
  ctx: AgentRunContext,
) => AgentRunAugmentation | undefined | void | Promise<AgentRunAugmentation | undefined | void>;

// ---------------------------------------------------------------------------
// Profile router
// ---------------------------------------------------------------------------

/**
 * Result returned by a profile router, indicating which profile to activate
 * for the current plan build.
 */
export interface ProfileRouterResult {
  /** The resolved profile name. */
  profile: string;
  /**
   * Optional human-readable explanation of why this profile was selected.
   * Flows into the `queue:profile:selected` wire event so users can see
   * the router's reasoning in the monitor UI and event log.
   */
  reason?: string;
  /**
   * Optional confidence level for this selection.
   * Flows into the `queue:profile:selected` wire event.
   */
  confidence?: 'low' | 'medium' | 'high';
}

/**
 * Specification for a profile router registered via `registerProfileRouter`.
 *
 * The canonical method is `selectBuildProfile`, which receives a
 * `ProfileRouterContext` with full build/queue context (PRD id, title, body,
 * priority, dependencies, available profiles, and usage statistics).
 *
 * The `resolve` method is deprecated. If only `resolve` is provided the
 * engine will use it as a fallback, but new routers should implement
 * `selectBuildProfile` instead.
 *
 * At least one of `selectBuildProfile` or `resolve` must be provided.
 */
export interface ProfileRouterSpec {
  /** Unique name for this router (used for logging and conflict detection). */
  name: string;
  /**
   * Select the active profile for the given build/queue context.
   *
   * Return `null` or `undefined` to defer to the next registered router
   * (or the default profile if no router selects one).
   *
   * This is the canonical method for profile routers. Implement this in
   * preference to the deprecated `resolve` method.
   */
  selectBuildProfile?: (
    ctx: ProfileRouterContext,
  ) => ProfileRouterResult | null | undefined | Promise<ProfileRouterResult | null | undefined>;
  /**
   * @deprecated Use `selectBuildProfile` instead.
   *
   * Resolve the active profile for a given agent run context.
   * Return `null` or `undefined` to defer to the next registered router.
   *
   * This method receives `AgentRunContext` rather than the richer
   * `ProfileRouterContext`, so it lacks PRD-level context. Prefer
   * `selectBuildProfile` for new routers.
   */
  resolve?: (
    ctx: AgentRunContext,
  ) => ProfileRouterResult | null | undefined | Promise<ProfileRouterResult | null | undefined>;
}

// Re-export ProfileRouterContext for convenience in API signatures
export type { ProfileRouterContext };

// ---------------------------------------------------------------------------
// Input source
// ---------------------------------------------------------------------------

/**
 * Structured result returned by an input source adapter `fetch` call.
 *
 * Returning an object allows the adapter to provide additional metadata
 * beyond the raw content (e.g. a human-readable title for the fetched item).
 * Return `null` to signal that the identifier was not found.
 */
export interface InputSourceResult {
  /** The raw build-input artifact content. */
  content: string;
  /** Optional human-readable title for the fetched item. */
  title?: string;
}

/**
 * Adapter for a custom input source registered via `registerInputSource`.
 *
 * Input sources allow extensions to supply PRD/build-source artifacts from
 * external systems (e.g. issue trackers, internal wikis) without manual file
 * placement.
 *
 * The `fetch` method accepts an optional second argument (`InputTransformContext`)
 * for context-aware adapters. Existing one-argument adapters remain type-compatible.
 */
export interface InputSourceAdapter {
  /** Unique adapter name (e.g. `my-ext:linear`). */
  name: string;
  /** Human-readable description of where this source retrieves input from. */
  description: string;
  /**
   * Fetch the build input for a given identifier.
   *
   * Returns the raw input artifact content (string), a structured
   * `InputSourceResult` object, or `null` if the identifier was not found.
   *
   * The optional second argument provides runtime context (cwd, source kind,
   * logger) for adapters that need it. Existing adapters that only accept `id`
   * remain type-compatible.
   */
  fetch: (id: string, ctx?: InputTransformContext) => Promise<string | InputSourceResult | null>;
}

// ---------------------------------------------------------------------------
// PRD enricher
// ---------------------------------------------------------------------------

/**
 * Input passed to a PRD enricher `enrich` call.
 */
export interface PrdEnrichmentInput {
  /** The PRD/build-source content to be enriched. */
  content: string;
  /** The source identifier (e.g. file path, issue id) for this PRD content. */
  sourceId: string;
  /** Runtime context providing cwd, logger, and source provenance. */
  ctx: InputTransformContext;
}

/**
 * Result returned by a PRD enricher `enrich` call.
 *
 * Return the mutated content to replace the input, or `null`/`undefined` to
 * signal that the enricher did not modify the content.
 */
export interface PrdEnrichmentResult {
  /** The enriched PRD/build-source content. */
  content: string;
}

/**
 * Specification for a PRD enricher registered via `registerPrdEnricher`.
 *
 * PRD enrichers mutate or augment PRD/build-source content before it is
 * written to the queue, allowing extensions to inject context, normalize
 * formatting, or resolve references.
 *
 * The runtime invokes enrichers in registration order. Each enricher receives
 * the output of the previous one as its input content.
 *
 * @remarks Runtime execution is wired in EXTEND_11. Typed contract only in
 * this slice; the engine records registrations for provenance and diagnostics.
 */
export interface PrdEnricher {
  /** Unique enricher name used for logging, duplicate detection, and provenance. */
  name: string;
  /** Human-readable description of what this enricher does. */
  description: string;
  /**
   * Enrich the given PRD content.
   *
   * Return a `PrdEnrichmentResult` to replace the content, or `null`/`undefined`
   * to pass the content through unchanged.
   */
  enrich: (input: PrdEnrichmentInput) => Promise<PrdEnrichmentResult | null | undefined> | PrdEnrichmentResult | null | undefined;
}

// Re-export InputTransformContext for use in API signatures
export type { InputTransformContext };

// ---------------------------------------------------------------------------
// Reviewer perspective
// ---------------------------------------------------------------------------

/**
 * Declarative applicability rules for a reviewer perspective.
 *
 * All specified rules are ANDed together — a perspective applies only when
 * every provided rule matches. Omitting a rule means "always applies" for
 * that dimension. An optional `fn` predicate provides escape-hatch evaluation
 * and is called only when all declarative rules pass.
 *
 * The engine evaluates applicability before each parallel review round. If
 * evaluation throws or times out the perspective is skipped for that round
 * and a diagnostic event is emitted.
 */
export interface ReviewerPerspectiveApplicability {
  /**
   * Glob patterns matched against changed file paths. At least one file must
   * match for the perspective to apply.
   *
   * @example ['src/**', '*.ts']
   */
  fileGlobs?: string[];
  /**
   * Path prefixes matched against changed file paths. At least one file must
   * start with one of these prefixes for the perspective to apply.
   *
   * @example ['packages/api/', 'packages/client/']
   */
  paths?: string[];
  /**
   * File extensions (with or without leading dot) that must appear in the
   * changed file list for the perspective to apply.
   *
   * @example ['.ts', 'tsx']
   */
  extensions?: string[];
  /**
   * Built-in file category names that must have at least one changed file.
   * Valid values: `'code'`, `'api'`, `'docs'`, `'config'`, `'deps'`, `'test'`.
   */
  categories?: Array<'code' | 'api' | 'docs' | 'config' | 'deps' | 'test'>;
  /**
   * Minimum number of changed files for the perspective to apply.
   * Must be a non-negative integer. When combined with other rules this is evaluated last.
   */
  minChangedFiles?: number;
  /**
   * Minimum number of changed lines for the perspective to apply.
   * Must be a non-negative integer. When combined with other rules this is evaluated last.
   */
  minChangedLines?: number;
  /**
   * Optional escape-hatch predicate. Called with the list of changed files and
   * the changed line count. Return `true` to apply, `false` to skip.
   *
   * Failures and timeouts in this function emit a diagnostic and cause the
   * perspective to be skipped for the current round.
   */
  fn?: (changedFiles: string[], changedLines: number) => boolean | Promise<boolean>;
}

/**
 * Read-only context passed to `ReviewerPerspectiveApplicability.fn`.
 * Provided for future extension; currently the positional parameters carry
 * the relevant data.
 */
export interface ReviewerPerspectiveApplicabilityContext {
  /** Changed file paths relative to the worktree root. */
  readonly changedFiles: string[];
  /** Total number of added + deleted lines in the changeset. */
  readonly changedLines: number;
}

/**
 * Specification for an additional reviewer perspective registered via
 * `registerReviewerPerspective`.
 *
 * Reviewer perspectives allow extensions to contribute domain-specific review
 * lenses (e.g. accessibility, i18n, performance) to the post-build review
 * stage.
 *
 * Extension perspectives are dispatched using the generic `reviewer` prompt
 * with the `promptFragment` appended as a provenance section. The perspective
 * `key` must be a lowercase slug (alphanumeric + hyphens, 1–64 chars, starting
 * with a letter) and must not conflict with a built-in perspective name
 * (`code`, `security`, `api`, `docs`, `test`, `verify`).
 *
 * Runtime limits:
 * - Applicability evaluation is bounded by `extensions.eventHookTimeoutMs`.
 * - Applicability exceptions and timeouts emit `extension:reviewer-perspective:skipped`
 *   diagnostics and skip the perspective for the current round.
 * - Unknown perspective keys in `review.perspectives` config emit a diagnostic and are
 *   skipped.
 */
export interface ReviewerPerspectiveSpec {
  /**
   * Unique perspective key used to identify this perspective in config and events.
   *
   * Must match the pattern `^[a-z][a-z0-9-]{0,63}$` and must not conflict
   * with a built-in perspective name (`code`, `security`, `api`, `docs`, `test`, `verify`).
   */
  key: string;
  /** Human-readable label shown in review output and monitor UI. */
  label: string;
  /**
   * Human-readable description of what this reviewer perspective checks.
   * Required — used for logging and provenance events.
   */
  description: string;
  /**
   * Prompt fragment injected into the reviewer agent's system prompt when this
   * perspective is active. The fragment is wrapped in a provenance section
   * identifying the contributing extension before being appended to the base
   * reviewer prompt.
   */
  promptFragment: string;
  /**
   * Optional applicability rules that determine when this perspective should
   * be active. When omitted the perspective is always considered applicable.
   *
   * Declarative rules (`fileGlobs`, `paths`, `extensions`, `categories`,
   * `minChangedFiles`, `minChangedLines`) are fast and evaluated synchronously.
   * The optional `fn` predicate provides escape-hatch async evaluation and is
   * invoked only when all declarative rules pass.
   */
  appliesTo?: ReviewerPerspectiveApplicability;
}

// ---------------------------------------------------------------------------
// Validation provider
// ---------------------------------------------------------------------------

/**
 * Structured result returned by a validation provider's `validate` function.
 *
 * Use this form when you need to report a status explicitly (including
 * `'skipped'`) or attach structured annotations to the build output.
 *
 * Structured `annotations` give recovery precise file/line repair targets.
 */
export type ValidationRepairClass = 'narrow' | 'structural' | 'manual' | 'followup';

export type ValidationJsonPrimitive = string | number | boolean | null;
export type ValidationJsonValue = ValidationJsonPrimitive | ValidationJsonValue[] | { [key: string]: ValidationJsonValue };
export type ValidationProviderMetadata = Record<string, ValidationJsonValue>;

export interface ValidationProviderAnnotation {
  severity: 'info' | 'warning' | 'error';
  message: string;
  file?: string;
  line?: number;
  details?: string;
  fix?: string;
  retryGuidance?: string;
  /** Provider-authored domain failure signature. Runtime failures use a separate classification. */
  failureKind?: string;
  repairClass?: ValidationRepairClass;
  metadata?: ValidationProviderMetadata;
}

export interface ValidationProviderResult {
  /** Validation outcome. */
  status: 'passed' | 'failed' | 'skipped';
  /** Optional human-readable message describing the outcome. */
  message?: string;
  /** Optional extended details (e.g. full command output). */
  details?: string;
  /** Optional structured annotations for individual files. */
  annotations?: ValidationProviderAnnotation[];
}

/**
 * Rich read-only context passed to validation provider `validate` functions.
 */
export interface ValidationProviderContext {
  /** The plan ID being validated. */
  planId: string;
  /** Absolute path to the worktree root for the plan. */
  planOutputDir: string;
  /** Same as `planOutputDir` — the worktree root path. */
  worktreePath: string;
  /** Structured logger routed through the eforge daemon's log pipeline. */
  logger: import('./context.js').ExtensionLogger;
  /** Shell-exec API for running subprocesses from a validation provider. */
  exec: import('./context.js').ExtensionExecApi;
  /** AbortSignal for the current build, if available. */
  signal?: AbortSignal;
  /** Files changed in the plan worktree, if available. */
  changedFiles?: string[];
}

type ValidationProviderReturn =
  | Promise<null | undefined | ValidationProviderResult>
  | null | undefined | ValidationProviderResult;

/**
 * Specification for a custom validation provider registered via
 * `registerValidationProvider`.
 *
 * Validation providers run after a plan's build stage completes, before the
 * review stage, allowing extensions to enforce project-specific quality gates.
 *
 * A provider is a **fail-closed quality gate**. Normal failures (`status: 'failed'`
 * or command-form non-zero exits) enter bounded recovery before terminal failure.
 * Hard failures (throws/rejections, timeouts, non-empty strings, unexpected shapes)
 * bypass recovery. Structured annotations improve recovery precision.
 *
 * @remarks Runtime-supported. Providers execute inside the built-in `validate`
 * build stage, bounded by `extensions.validationProviderTimeoutMs` (falls back
 * to `eventHookTimeoutMs`).
 *
 * @example Function form (for pure-JS validation logic):
 * ```ts
 * eforge.registerValidationProvider({
 *   name: 'no-debugger-statements',
 *   description: 'Rejects debugger statements',
 *   validate: async (_dir, ctx) => ({
 *     status: 'failed',
 *     message: 'Debugger statement found',
 *     annotations: [{ severity: 'error', message: 'Remove debugger statement', file: ctx?.changedFiles?.[0], repairClass: 'narrow' }],
 *   }),
 * });
 * ```
 *
 * For running shell commands (lint, type-check, tests, etc.), prefer the
 * command form below — it spawns subprocesses properly with timeout and exit-code
 * handling built in.
 *
 * @example Command form:
 * ```ts
 * eforge.registerValidationProvider({
 *   name: 'type-check',
 *   description: 'Runs TypeScript type checking',
 *   commands: ['pnpm type-check'],
 * });
 * ```
 */
export interface ValidationProviderSpec {
  /** Unique provider name. */
  name: string;
  /** Human-readable description of what this provider validates. */
  description: string;
  /**
   * Run validation for the given plan output directory.
   * Return `null`/`undefined` to pass or a structured `ValidationProviderResult`.
   * Throws/rejections, timeouts, non-empty strings, and unexpected shapes bypass recovery.
   * Mutually exclusive with `commands`. Provide exactly one.
   */
  validate?: (
    planOutputDir: string,
    context?: ValidationProviderContext,
  ) => ValidationProviderReturn;
  /**
   * Shell commands to run in the plan worktree, one per entry. Each command is
   * split on whitespace into `[executable, ...args]` and run via `execFile`
   * (no shell interpretation — quoted args, env-var expansion, redirects, and
   * pipes are not supported). A non-zero exit code is a recoverable normal
   * failure using stderr (or stdout if stderr is empty) as the message.
   *
   * Mutually exclusive with `validate`. Provide exactly one.
   */
  commands?: string[];
}

// Re-export EventPattern for use in API signatures
export type { EventPattern };
