/**
 * Core extension API — the `EforgeExtensionAPI` interface and the factory types
 * that define how an extension module's default export is structured.
 *
 * Extension authors write a default-export factory function that receives an
 * `EforgeExtensionAPI` instance and calls registration methods on it:
 *
 * ```ts
 * import type { EforgeExtensionAPI } from '@eforge-build/extension-sdk';
 *
 * export default function myExtension(eforge: EforgeExtensionAPI) {
 *   eforge.onEvent('plan:build:failed', async (event, ctx) => {
 *     ctx.logger.warn(`Plan failed: ${event.planId}`);
 *   });
 * }
 * ```
 *
 * The `defineEforgeExtension` helper is available for named-export or
 * inference-friendly usage.
 *
 * Directory-layout extensions may declare public capabilities and required or
 * optional dependencies in `package.json#eforge.extension`. The loader resolves
 * those declarations before importing dependent factories. Action handlers can
 * inspect immutable dependency and capability availability through
 * `ctx.dependencies` and `ctx.capabilities`; the lookup API reports state only
 * and does not invoke another extension.
 */

import type { EforgeEvent } from './events.js';
import type { EventHookContext } from './context.js';
import type {
  EventHookHandler,
  QueueDispatchPolicyGateHandler,
  PlanMergePolicyGateHandler,
  FinalMergePolicyGateHandler,
  AgentRunHandler,
  ProfileRouterSpec,
  RuntimeChoiceRouterHandler,
  RuntimeChoiceRouterSpec,
  InputSourceAdapter,
  PrdEnricher,
  ReviewerPerspectiveSpec,
  ValidationProviderSpec,
} from './hooks.js';
import type { EventPattern } from './patterns.js';
import type { ExtensionTool } from './tools.js';
import type {
  ConsoleContribution,
  ConsoleWorkstation,
  ExtensionAction,
  ExtensionDeepLink,
  IntegrationCommand,
} from './contributions.js';
import type { ExtensionAgentTaskContribution } from './agent-tasks.js';
import type { TObject, TSchema } from './schema.js';

/**
 * The API surface passed to an extension factory at load time.
 *
 * All registration methods are typed contracts. Runtime support for each
 * method is noted in `docs/extensions-api.md`.
 */
export interface EforgeExtensionAPI {
  /**
   * Register a typed event hook.
   *
   * The handler is called whenever an event matching `pattern` is emitted by
   * the eforge daemon. Handlers are non-blocking — the return value is awaited
   * opportunistically and must not affect the build pipeline.
   *
   * @param pattern - Glob pattern matching event type strings (e.g. `plan:build:*`).
   * @param handler - Async or sync handler invoked with the matched event and context.
   *
   * @remarks Runtime-supported. Matching events are dispatched to handlers;
   * failures and timeouts emit `extension:event-handler:*` diagnostics.
   *
   * @example
   * ```ts
   * eforge.onEvent('plan:build:failed', async (event, ctx) => {
   *   ctx.logger.warn(`Plan failed: ${event.planId}`);
   * });
   * ```
   */
  // Exact event-type overload — TypeScript infers `TType` from the literal
  // pattern, so the handler's `event` parameter is narrowed to that variant.
  onEvent<TType extends EforgeEvent['type']>(
    pattern: TType,
    handler: EventHookHandler<TType>,
  ): void;
  // Glob pattern overload — patterns containing `*` (or any non-literal event
  // type) receive the full `EforgeEvent` union in the handler.
  onEvent(
    pattern: EventPattern,
    handler: (event: EforgeEvent, ctx: EventHookContext) => void | Promise<void>,
  ): void;

  /**
   * Register an agent-run hook invoked before each agent run starts.
   *
   * The handler receives an `AgentRunContext` describing the role, tier,
   * profile, phase, and stage of the run, and may return an
   * `AgentRunAugmentation` to contribute prompt context, per-run tools, and
   * additive tool allow/deny tuning.
   *
   * Prompt fragments returned via `promptAppend` are appended after any
   * config-level `promptAppend` already resolved by the engine, wrapped in a
   * named provenance section:
   *
   * ```
   * ## Native extension context
   *
   * ### <extension-name>
   * <fragment>
   * ```
   *
   * Multiple registered handlers are invoked sequentially in registration order.
   * Each runs with a per-handler timeout (configurable via
   * `extensions.agentContextHookTimeoutMs`; defaults to
   * `extensions.eventHookTimeoutMs`). A handler that throws or times out emits
   * a typed diagnostic event (`extension:agent-context:failed` or
   * `extension:agent-context:timeout`); that handler's prompt/tool changes are
   * skipped and the agent run continues.
   *
   * @remarks Runtime-supported. Tools are injected only when returned from a
   * successful handler for the current run. Use `ctx.effectiveToolName(name)`
   * when prompt text should mention the harness-visible tool name.
   *
   * @example
   * ```ts
   * eforge.onAgentRun(async (ctx) => {
   *   if (ctx.role !== 'builder') return;
   *   return {
   *     promptAppend: 'Check the design system before modifying UI components.',
   *   };
   * });
   * ```
   */
  onAgentRun(handler: AgentRunHandler): void;

  /**
   * Register a policy gate evaluated before a queued PRD is dispatched for build.
   *
   * Return `{ decision: 'allow' }` to permit dispatch, `{ decision: 'block', reason }`
   * to halt it, or `{ decision: 'require-approval', reason }` to halt it with an
   * approval-required reason. The current runtime treats `require-approval` as blocking
   * until approval workflow support is added.
   */
  beforeQueueDispatch(handler: QueueDispatchPolicyGateHandler): void;

  /**
   * Register a policy gate evaluated before a plan's changes are merged into
   * the integration branch.
   *
   * Return `{ decision: 'allow' }` to permit the merge, `{ decision: 'block', reason }` to
   * halt it, or `{ decision: 'require-approval', reason }` to halt it with an
   * approval-required reason. The current runtime treats `require-approval` as blocking
   * until approval workflow support is added.
   *
   * @example
   * ```ts
   * eforge.beforePlanMerge(async (ctx) => {
   *   const hasDangerousFiles = ctx.diff.files.some(f => f.path.startsWith('infra/'));
   *   return hasDangerousFiles
   *     ? { decision: 'require-approval', reason: 'Changes touch infra/ — manual review required' }
   *     : { decision: 'allow' };
   * });
   * ```
   */
  beforePlanMerge(handler: PlanMergePolicyGateHandler): void;

  /**
   * Register a policy gate evaluated before the feature branch is finally merged
   * into the base branch.
   *
   * Return `{ decision: 'allow' }` to permit the merge, `{ decision: 'block', reason }`
   * to halt it, or `{ decision: 'require-approval', reason }` to halt it with an
   * approval-required reason. The current runtime treats `require-approval` as blocking
   * until approval workflow support is added.
   */
  beforeFinalMerge(handler: FinalMergePolicyGateHandler): void;

  /**
   * Register a profile router that selects which agent runtime profile to use
   * for each build dispatched from the queue.
   *
   * Profile routers are invoked sequentially in registration order before each
   * plan's build phase begins. The first router to return a non-null result wins
   * (sequential first-valid-wins evaluation). If all routers return `null` or
   * `undefined`, the engine falls back to the base profile from configuration.
   * Explicit PRD frontmatter profile overrides take priority over all routers
   * and are applied before routers are invoked.
   *
   * **Fail-open semantics:** if a router throws, times out, or returns a profile
   * name that does not resolve via `loadProfile`, the engine emits a typed
   * diagnostic event (`queue:profile:router-failed`, `queue:profile:router-timeout`,
   * or `queue:profile:invalid-selection`) and continues with the next router.
   * Profile routers never block a build from starting.
   *
   * **Canonical method:** implement `selectBuildProfile(ctx: ProfileRouterContext)`
   * which receives rich build/queue context (PRD id, title, body, priority,
   * dependencies, available profiles, and usage statistics). The deprecated
   * `resolve(ctx: AgentRunContext)` method is accepted for backward compatibility
   * but receives limited context.
   *
   * At least one of `selectBuildProfile` or `resolve` must be provided.
   *
   * Diagnostic events emitted by the runtime:
   * - `queue:profile:selected` — a router successfully selected a profile.
   * - `queue:profile:router-failed` — a router threw an error.
   * - `queue:profile:router-timeout` — a router exceeded its timeout.
   * - `queue:profile:invalid-selection` — a router returned an unknown profile name.
   *
   * @remarks Pre-build runtime support is wired via the `queue:profile:*` event
   * family (EXTEND_09). Active-marker behavior is not affected by profile routers.
   *
   * @example
   * ```ts
   * eforge.registerProfileRouter({
   *   name: 'cost-aware-router',
   *   async selectBuildProfile(ctx) {
   *     const usage = ctx.usage.profile('premium');
   *     if (usage.nearLimit) {
   *       return { profile: 'standard', reason: 'premium profile near limit' };
   *     }
   *     return null; // defer to next router or default
   *   },
   * });
   * ```
   */
  registerProfileRouter(spec: ProfileRouterSpec): void;

  /** Register a fail-open per-invocation runtime choice router. */
  registerRuntimeChoiceRouter(name: string, handler: RuntimeChoiceRouterHandler): void;
  registerRuntimeChoiceRouter(spec: RuntimeChoiceRouterSpec): void;

  /**
   * Register a custom input source adapter that fetches build input artifacts
   * from an external system (e.g. an issue tracker or internal wiki).
   *
   * The adapter's `fetch` method is called at enqueue time when a source
   * reference matching this adapter's name is provided. It may accept an
   * optional `InputTransformContext` as a second argument for context-aware
   * fetching; existing one-argument adapters remain type-compatible.
   *
   * @remarks Runtime-supported for input source fetching (EXTEND_11).
   */
  registerInputSource(adapter: InputSourceAdapter): void;

  /**
   * Register a PRD content enricher that mutates or augments PRD/build-source
   * content before it is written to the queue.
   *
   * Enrichers are invoked in registration order. Each enricher receives the
   * output of the previous one as its input. Return a `PrdEnrichmentResult` to
   * replace the content, or `null`/`undefined` to pass the content through unchanged.
   *
   * @remarks Runtime-supported for PRD enrichment (EXTEND_11). Registrations
   * are recorded for provenance and diagnostics; the engine invokes `enrich`
   * at enqueue time.
   *
   * @example
   * ```ts
   * eforge.registerPrdEnricher({
   *   name: 'my-ext:context-injector',
   *   description: 'Injects project context into PRD content',
   *   async enrich({ content, ctx }) {
   *     // During enqueue preprocessing, ctx.exec.run is unavailable.
   *     return { content: content + `\n\nSource kind: ${ctx.sourceKind}` };
   *   },
   * });
   * ```
   */
  registerPrdEnricher(enricher: PrdEnricher): void;

  /**
   * Register an additional reviewer perspective contributed to the post-build
   * review stage.
   *
   * Extension perspectives are dispatched using the generic `reviewer` prompt
   * with `spec.promptFragment` appended as a named provenance section. The
   * perspective is included in parallel review when its `appliesTo` rules match
   * the current changeset. When `appliesTo` is omitted the perspective is always
   * applicable.
   *
   * The `key` must be a lowercase slug (`^[a-z][a-z0-9-]{0,63}$`) and must not
   * conflict with a built-in perspective name (`code`, `security`, `api`, `docs`,
   * `test`, `verify`).
   *
   * Runtime limits:
   * - Applicability evaluation is bounded by `extensions.eventHookTimeoutMs`.
   * - Evaluation failures and timeouts emit `extension:reviewer-perspective:skipped`
   *   diagnostics and skip the perspective for the current round.
   * - Unknown perspective keys in `review.perspectives` config emit a diagnostic
   *   and are skipped rather than failing the build.
   *
   * @remarks Runtime-supported. Extension perspectives participate in parallel
   * review rounds and adaptive review-cycle perspective selection.
   */
  registerReviewerPerspective(spec: ReviewerPerspectiveSpec): void;

  /**
   * Register a custom validation provider that runs after the build stage
   * completes, before review.
   *
   * Providers are **fail-closed quality gates**. Normal validation failures — a
   * {@link ValidationProviderResult} with `status: 'failed'` or a command-form
   * non-zero exit — enter bounded in-plan recovery before terminal failure.
   * Recovery is limited by the `review.maxRounds` budget. Narrow or unspecified
   * structured failures use the review-fixer path first; structural failures use
   * the validation-fixer path. Every automated validation repair is evaluator-gated,
   * and after each recovery attempt eforge reruns the provider suite from the first provider.
   * Unresolved recoverable failures still emit `plan:build:failed` and halt the
   * current plan.
   *
   * Hard provider failures bypass recovery and fail the current plan immediately:
   * thrown errors/rejections, provider timeouts, non-empty string returns, and unexpected return shapes.
   * The daemon process is never crashed.
   *
   * Prefer structured annotations on failed results when possible. File/line,
   * fix, retry guidance, repair class, provider failure kind, and JSON-safe
   * metadata give the recovery agent precise repair targets and routing hints without parsing prose.
   *
   * Each provider spec must supply exactly one of:
   * - `validate`: an async function receiving `(planOutputDir, ctx?)` — return
   *   `null`/`undefined` to pass or a {@link ValidationProviderResult} for
   *   structured outcomes. Non-empty strings are unexpected return shapes.
   * - `commands`: an array of shell command strings executed in the plan
   *   worktree; any non-zero exit code is a recoverable generic subprocess failure.
   *
   * @remarks Runtime-supported. Providers run inside the built-in `validate`
   * build stage, bounded by `extensions.validationProviderTimeoutMs`.
   *
   * @see {@link ValidationProviderSpec} for the full type.
   * @see {@link ValidationProviderResult} for the structured result shape.
   * @see {@link ValidationProviderContext} for the rich context object.
   */
  registerValidationProvider(spec: ValidationProviderSpec): void;

  /**
   * Register a custom agent tool contributed by this extension.
   *
   * @remarks Loader-time provenance and validation metadata. Registration does
   * not inject the tool into every run; return the tool from `onAgentRun()` for
   * the specific runs that should receive it.
   */
  registerTool(tool: ExtensionTool): void;

  /**
   * Register a prompt-backed agent task contribution owned by this extension.
   *
   * Prompt sources are declared by trusted extension code and projected only as
   * safe metadata. Callers start tasks by contribution reference; they do not
   * supply prompt asset paths or raw prompt text.
   */
  registerAgentTask<TInput extends TObject, TOutput extends TSchema | undefined = undefined>(
    task: ExtensionAgentTaskContribution<TInput, TOutput>,
  ): void;
  registerAction<TInput extends TObject, TOutput extends TSchema | undefined = undefined>(
    action: ExtensionAction<TInput, TOutput>,
  ): void;
  registerConsoleContribution(contribution: ConsoleContribution): void;
  registerConsoleWorkstation(workstation: ConsoleWorkstation): void;
  registerIntegrationCommand(command: IntegrationCommand): void;
  registerDeepLink(deepLink: ExtensionDeepLink): void;
}

/**
 * The type of a default-export extension factory function.
 *
 * An extension module must export a function matching this signature as its
 * default export. The runtime loader will call it once at extension load time,
 * passing a live `EforgeExtensionAPI` instance.
 */
export type EforgeExtensionFactory = (api: EforgeExtensionAPI) => void | Promise<void>;

/**
 * Identity helper for defining an extension factory with correct type inference.
 *
 * Wrap your factory with `defineEforgeExtension` to get parameter inference
 * and IDE autocomplete on the `EforgeExtensionAPI` argument without needing
 * an explicit type annotation.
 *
 * @example
 * ```ts
 * import { defineEforgeExtension } from '@eforge-build/extension-sdk';
 *
 * export default defineEforgeExtension((eforge) => {
 *   eforge.onEvent('plan:build:failed', async (event, ctx) => {
 *     ctx.logger.warn(`Plan failed: ${event.planId}`);
 *   });
 * });
 * ```
 */
export function defineEforgeExtension(factory: EforgeExtensionFactory): EforgeExtensionFactory {
  return factory;
}
