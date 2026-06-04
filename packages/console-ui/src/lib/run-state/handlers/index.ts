/**
 * Flat handler registry keyed by `EforgeEvent['type']`.
 *
 * IGNORED_EVENT_TYPES lists variants the UI intentionally does not react to.
 * The _Exhaustive type assertion verifies at compile time that every
 * EforgeEvent['type'] is either a key in handlerRegistry or an element of
 * IGNORED_EVENT_TYPES. Adding a new engine event variant without updating
 * this file produces a TypeScript build error rather than a silent runtime no-op.
 *
 * Dispatch in reducer.ts uses:
 *   const handler = (handlerRegistry as Record<string, ...>)[event.type];
 *   const delta = handler ? handler(event as never, state) : undefined;
 *
 * Ported from packages/monitor-ui/src/lib/reducer/index.ts.
 * Dual-reducer constraint: keep this registry in sync with monitor-ui's
 * equivalent until monitor-ui is deleted (future PRD).
 */
import type { EforgeEvent } from '../types';

import { handleSessionStart, handleSessionEnd, handleSessionProfile, handlePhaseStart } from './handle-session';
import { handlePlanningComplete } from './handle-planning';
import {
  handlePlanBuildStart,
  handlePlanBuildImplementStart,
  handlePlanBuildDocAuthorStart,
  handlePlanBuildDocAuthorComplete,
  handlePlanBuildDocSyncStart,
  handlePlanBuildDocSyncComplete,
  handlePlanBuildImplementComplete,
  handlePlanBuildTestWriteStart,
  handlePlanBuildTestWriteComplete,
  handlePlanBuildTestStart,
  handlePlanBuildTestComplete,
  handlePlanBuildReviewStart,
  handlePlanBuildReviewFixStart,
  handlePlanBuildReviewComplete,
  handlePlanBuildEvaluateStart,
  handlePlanBuildComplete,
  handlePlanBuildFailed,
  handlePlanBuildFilesChanged,
  handlePlanBuildReviewPerspectiveError,
  handlePlanBuildReviewPerspectiveComplete,
  handlePlanMergeComplete,
} from './handle-plan-build';
import {
  handleAgentStart,
  handleAgentUsage,
  handleAgentResult,
  handleAgentStop,
  handleAgentActivity,
} from './handle-agent';
import {
  handleExpeditionArchitectureComplete,
  handleExpeditionModuleStart,
  handleExpeditionModuleComplete,
} from './handle-expedition';
import {
  handleEnqueueStart,
  handleEnqueueComplete,
  handleEnqueueFailed,
  handleEnqueueCommitFailed,
} from './handle-enqueue';
import { handleConfigWarning, handlePlanningWarning } from './handle-misc';
import { handleDaemonAutoBuildPaused, handleDaemonAutoBuildResumed } from './handle-daemon';
import { handleBuildResumeArtifacts, handleBuildResumeState } from './handle-resume';
import { handlePlanBuildDecision, handlePlanningDecision } from './handle-decisions';
import {
  handlePlanStatusChange,
  handlePlanErrorSet,
  handlePlanErrorClear,
  handleMergeWorktreeSet,
  handleMergeWorktreeClear,
} from './handle-plan-lifecycle';
import {
  handleValidationStart,
  handleValidationCommandStart,
  handleValidationCommandComplete,
  handleValidationCommandTimeout,
  handleValidationComplete,
} from './handle-validation';

// ---------------------------------------------------------------------------
// Handler registry
// ---------------------------------------------------------------------------

/**
 * Flat registry of all handled event types. Each entry is a typed handler
 * narrowed via the discriminated union — no casts, no `'in' event` guards.
 *
 * Per-group files exist for human readability only; dispatch is O(1) via
 * string-keyed object lookup.
 *
 * TypeScript infers the literal key types automatically. The exhaustiveness
 * check below verifies all EforgeEvent types are accounted for.
 */
export const handlerRegistry = {
  // Session lifecycle
  'session:start': handleSessionStart,
  'session:end': handleSessionEnd,
  'session:profile': handleSessionProfile,

  // Phase lifecycle
  'phase:start': handlePhaseStart,

  // Config/planning warnings
  'config:warning': handleConfigWarning,
  'planning:warning': handlePlanningWarning,

  // Planning
  'planning:complete': handlePlanningComplete,

  // Building
  'plan:build:start': handlePlanBuildStart,
  'plan:build:implement:start': handlePlanBuildImplementStart,
  'plan:build:doc-author:start': handlePlanBuildDocAuthorStart,
  'plan:build:doc-author:complete': handlePlanBuildDocAuthorComplete,
  'plan:build:doc-sync:start': handlePlanBuildDocSyncStart,
  'plan:build:doc-sync:complete': handlePlanBuildDocSyncComplete,
  'plan:build:implement:complete': handlePlanBuildImplementComplete,
  'plan:build:test:write:start': handlePlanBuildTestWriteStart,
  'plan:build:test:write:complete': handlePlanBuildTestWriteComplete,
  'plan:build:test:start': handlePlanBuildTestStart,
  'plan:build:test:complete': handlePlanBuildTestComplete,
  'plan:build:review:start': handlePlanBuildReviewStart,
  'plan:build:review:fix:start': handlePlanBuildReviewFixStart,
  'plan:build:review:complete': handlePlanBuildReviewComplete,
  'plan:build:evaluate:start': handlePlanBuildEvaluateStart,
  'plan:build:complete': handlePlanBuildComplete,
  'plan:build:failed': handlePlanBuildFailed,
  'plan:build:files_changed': handlePlanBuildFilesChanged,
  'plan:build:review:parallel:perspective:error': handlePlanBuildReviewPerspectiveError,
  'plan:build:review:parallel:perspective:complete': handlePlanBuildReviewPerspectiveComplete,
  'plan:merge:complete': handlePlanMergeComplete,

  // Build-phase decision events
  'plan:build:decision': handlePlanBuildDecision,

  // Plan-phase decision events
  'planning:decision': handlePlanningDecision,

  // Agent lifecycle
  'agent:start': handleAgentStart,
  'agent:usage': handleAgentUsage,
  'agent:result': handleAgentResult,
  'agent:stop': handleAgentStop,
  'agent:activity': handleAgentActivity,

  // Expedition planning
  'expedition:architecture:complete': handleExpeditionArchitectureComplete,
  'expedition:module:start': handleExpeditionModuleStart,
  'expedition:module:complete': handleExpeditionModuleComplete,

  // Enqueue
  'enqueue:start': handleEnqueueStart,
  'enqueue:complete': handleEnqueueComplete,
  'enqueue:failed': handleEnqueueFailed,
  'enqueue:commit-failed': handleEnqueueCommitFailed,

  // Daemon internal
  'daemon:auto-build:paused': handleDaemonAutoBuildPaused,
  'daemon:auto-build:resumed': handleDaemonAutoBuildResumed,

  // Plan lifecycle state events
  'plan:status:change': handlePlanStatusChange,
  'plan:error:set': handlePlanErrorSet,
  'plan:error:clear': handlePlanErrorClear,
  'merge:worktree:set': handleMergeWorktreeSet,
  'merge:worktree:clear': handleMergeWorktreeClear,

  'build:resume:state': handleBuildResumeState,
  'build:resume:artifacts': handleBuildResumeArtifacts,

  // Validation lifecycle
  'validation:start': handleValidationStart,
  'validation:command:start': handleValidationCommandStart,
  'validation:command:complete': handleValidationCommandComplete,
  'validation:command:timeout': handleValidationCommandTimeout,
  'validation:complete': handleValidationComplete,
};

// ---------------------------------------------------------------------------
// Events intentionally ignored (no state effect)
// ---------------------------------------------------------------------------

/**
 * Event types the UI deliberately does not react to. These are known variants
 * that carry no state-relevant data for the run-state reducer.
 *
 * Maintaining this explicit list (vs. a catch-all) ensures that new engine
 * variants are not silently dropped — the _Exhaustive check below forces a
 * compiler error until the new type is either handled or explicitly ignored.
 */
export const IGNORED_EVENT_TYPES = [
  'phase:end',
  'planning:module:build-config:invalid',
  'extension:event-handler:failed',
  'extension:event-handler:timeout',
  // --- eforge:region plan-03-daemon-action-routes ---
  'extension:action:start',
  'extension:action:complete',
  'extension:action:failed',
  'extension:action:timeout',
  // --- eforge:endregion plan-03-daemon-action-routes ---
  'extension:agent-context:applied',
  'extension:agent-context:failed',
  'extension:agent-context:timeout',
  'extension:agent-context:unsupported',
  'extension:agent-tools:applied',
  'extension:policy:decision',
  'extension:policy:failed',
  'extension:policy:timeout',
  'planning:start',
  'planning:skip',
  'planning:submission',
  'planning:error',
  'planning:clarification',
  'planning:clarification:answer',
  'planning:progress',
  'planning:continuation',
  'planning:pipeline',
  'planning:review:start',
  'planning:review:complete',
  'planning:evaluate:start',
  'planning:evaluate:continuation',
  'planning:evaluate:complete',
  'planning:architecture:review:start',
  'planning:architecture:review:complete',
  'planning:architecture:evaluate:start',
  'planning:architecture:evaluate:continuation',
  'planning:architecture:evaluate:complete',
  'planning:cohesion:start',
  'planning:cohesion:complete',
  'planning:cohesion:evaluate:start',
  'planning:cohesion:evaluate:continuation',
  'planning:cohesion:evaluate:complete',
  'plan:build:implement:progress',
  'plan:build:implement:continuation',
  'plan:build:review:parallel:start',
  'plan:build:review:parallel:perspective:start',
  'plan:build:review:fix:complete',
  'plan:build:review:fix:continuation',
  'plan:build:evaluate:continuation',
  'plan:build:evaluate:complete',
  'plan:build:progress',
  'schedule:start',
  'plan:schedule:ready',
  'plan:merge:start',
  'plan:merge:resolve:start',
  'plan:merge:resolve:complete',
  'merge:finalize:start',
  'merge:finalize:complete',
  'merge:finalize:skipped',
  'expedition:wave:start',
  'expedition:wave:complete',
  'expedition:compile:start',
  'expedition:compile:complete',
  'agent:warning',
  'agent:message',
  'agent:tool_use',
  'agent:tool_result',
  'agent:retry',
  'validation:fix:start',
  'validation:fix:complete',
  'prd_validation:start',
  'prd_validation:complete',
  'gap_close:start',
  'gap_close:plan_ready',
  'gap_close:complete',
  'acceptance_validation:complete',
  'reconciliation:start',
  'reconciliation:complete',
  'cleanup:start',
  'cleanup:complete',
  'approval:needed',
  'approval:response',
  'recovery:start',
  'recovery:summary',
  'recovery:complete',
  'recovery:error',
  'recovery:apply:start',
  'recovery:apply:complete',
  'recovery:apply:error',
  'queue:start',
  'queue:prd:start',
  'queue:prd:discovered',
  'queue:prd:stale',
  'queue:prd:skip',
  'queue:prd:commit-failed',
  'queue:prd:complete',
  'queue:complete',
  'queue:profile:selected',
  'queue:profile:router-failed',
  'queue:profile:router-timeout',
  'queue:profile:invalid-selection',
  'daemon:lifecycle:starting',
  'daemon:lifecycle:ready',
  'daemon:lifecycle:shutdown:start',
  'daemon:lifecycle:shutdown:complete',
  'daemon:heartbeat',
  'daemon:scheduler:dequeued',
  'daemon:scheduler:capacity-blocked',
  'daemon:scheduler:dependency-blocked',
  'daemon:scheduler:paused',
  'daemon:scheduler:resumed',
  'daemon:auto-build:enabled',
  'daemon:auto-build:disabled',
  'daemon:auto-build:triggered',
  'daemon:auto-build:transition',
  'daemon:recovery:start',
  'daemon:recovery:run-marked-failed',
  'daemon:recovery:lock-removed',
  'daemon:recovery:complete',
  'daemon:orphan:reaped',
  'daemon:warning',
  'daemon:error',
  'daemon:run:upsert',
  'extension:input-source:fetched',
  'extension:input-source:failed',
  'extension:prd-enricher:applied',
  'extension:prd-enricher:failed',
  'extension:reviewer-perspective:applied',
  'extension:reviewer-perspective:skipped',
  'extension:validation-provider:start',
  'extension:validation-provider:complete',
  'extension:validation-provider:error',
  'extension:validation-provider:timeout',
  'landing:start',
  'landing:complete',
  'landing:skipped',
  'stack:layer:recorded',
  'stack:provider:command',
  'stack:landing:update',
  'stack:landing:conflict:detected',
  'stack:landing:conflict:recovery:start',
  'stack:landing:conflict:recovery:complete',
  'stack:landing:conflict:recovery:failed',
  'stack:sync:start',
  'stack:sync:complete',
  'stack:sync:failed',
  'stack:sync:deferred',
  'stack:sync:skipped',
  'landing:auto-merge:start',
  'landing:auto-merge:complete',
  'landing:auto-merge:skipped',
  // build:terminal-failure — run-level authoritative terminal failure event.
  // Monitor UI rendering is future work; session reducer does not handle it.
  'build:terminal-failure',
  // build:resume:* — lifecycle-only resume events. Recovered artifacts and
  // seed-state are handled above.
  'build:resume:start',
  'build:resume:ineligible',
  'build:resume:complete',
] as const;

// ---------------------------------------------------------------------------
// Compile-time exhaustiveness check
// ---------------------------------------------------------------------------

/**
 * _Exhaustive resolves to `true` when every EforgeEvent['type'] is either
 * a key in handlerRegistry or an element of IGNORED_EVENT_TYPES.
 *
 * When a new engine event variant is added without updating this file, this
 * type resolves to `{ error: ...; missing: 'new:event:type' }`, making the
 * const assignment below a type error with a legible message.
 */
type _MissingTypes = Exclude<
  EforgeEvent['type'],
  keyof typeof handlerRegistry | (typeof IGNORED_EVENT_TYPES)[number]
>;

type _Exhaustive = [_MissingTypes] extends [never]
  ? true
  : { error: 'Not all EforgeEvent types are handled or ignored'; missing: _MissingTypes };

// If this line produces a type error, a new EforgeEvent variant needs to be
// added to handlerRegistry or IGNORED_EVENT_TYPES.
const _exhaustiveCheck: _Exhaustive = true;

// Suppress unused-variable warning — the check is purely compile-time.
void _exhaustiveCheck;
