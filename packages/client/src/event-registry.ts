/**
 * Event metadata registry: one entry per EforgeEvent variant.
 *
 * Entries declare stream scope, persistence/replay behavior, optional summaries,
 * and optional daemon-state projectors. The _Exhaustive type check at the bottom
 * forces this registry to track every exported event variant.
 */
import type { EforgeEvent, StackLayerWire } from './events.js';
import { normalizeTerminalQueueItem, projectEnqueueComplete, projectQueuePrdDiscovered, projectSchedulerDependencyBlocked, projectQueueDependencyOverridden, projectQueuePrdDispatchFailed } from './event-projections/queue.js';
import type { RunInfo, QueueItem, AutoBuildState, FailedEnqueueInfo } from './types.js';
// Minimal state shape the project functions operate on; Console and daemon snapshots satisfy it structurally.
export interface ProjectableState {
  /** Runs sorted by startedAt DESC; runs[0] is the most-recent session. */
  runs: RunInfo[];
  /** Current queue snapshot (pending, running, failed items). */
  queue: QueueItem[];
  /** Auto-build state; null when the daemon does not support it. */
  autoBuild: AutoBuildState | null;
  /**
   * The most recently received daemon:heartbeat payload, or null if no
   * heartbeat has been received yet.
   */
  latestHeartbeat: {
    at: number;
    payload: {
      uptime: number;
      queueDepth: number;
      runningBuilds: number;
      autoBuild: {
        enabled: boolean;
        paused: boolean;
        desired?: AutoBuildState['desired'];
        mode?: AutoBuildState['mode'];
        scheduler?: AutoBuildState['scheduler'];
        lastTransition?: AutoBuildState['lastTransition'];
        reason?: string;
      };
      subscribers: number;
    };
  } | null;
  /** Stack layer records keyed by prdId, or empty array when none have been recorded. */
  stackLayers: StackLayerWire[];
  /** Durable failed-enqueue attention rows keyed by runId. */ failedEnqueues?: FailedEnqueueInfo[];
}
// EventMeta: per-variant metadata shape.
export type EventScope = 'daemon' | 'session';
export interface EventMeta<T extends EforgeEvent['type']> {
  /** Context this event belongs to. */
  scope: EventScope;
  /** Whether this event is persisted to the DB (and replayed on reconnect). */
  persist: boolean;
  /**
   * Optional human-readable one-line summary. Used by the MCP progress
   * notifications and Console activity feed.
   *
   * String: static description.
   * Function: computed from the event payload (e.g. includes planId, counts).
   *           May return undefined to suppress output for certain payloads.
   */
  summary?: string | ((event: Extract<EforgeEvent, { type: T }>) => string | undefined);
  /**
   * Optional state projection for daemon-scoped events.
   *
   * Receives the narrowed event and the current (readonly) projectable state.
   * Returns a partial delta to spread into the next state, or undefined when
   * the event causes no state change.
   */
  project?: (
    event: Extract<EforgeEvent, { type: T }>,
    state: Readonly<ProjectableState>,
  ) => Partial<ProjectableState> | undefined;
}
// ---------------------------------------------------------------------------
// Registry shape: every EforgeEvent type must have an entry
// ---------------------------------------------------------------------------
type EventRegistryShape = {
  [T in EforgeEvent['type']]: EventMeta<T>;
};

// ---------------------------------------------------------------------------
// Registry definition
// ---------------------------------------------------------------------------

const eventRegistry = {
  // -------------------------------------------------------------------------
  // Session lifecycle
  // -------------------------------------------------------------------------

  'session:start': {
    scope: 'daemon',
    persist: true,
    summary: 'Session started',
    // daemon:run:upsert is now the authoritative source for DaemonState.runs.
    // The old run-synthesis branch is removed — it produced untitled/unknown
    // run rows during enqueue-only sessions that had no phase:start.
    project: () => undefined,
  },

  'session:end': {
    scope: 'daemon',
    persist: true,
    summary: (e) => `Session ended: ${e.result.status}`,
    // Run termination is now reflected via daemon:run:upsert emitted by the
    // recorder when session:end triggers updateRunStatus for enqueue failures.
    project: () => undefined,
  },

  'session:profile': { scope: 'session', persist: false },

  // -------------------------------------------------------------------------
  // Phase lifecycle
  // -------------------------------------------------------------------------

  'phase:start': {
    scope: 'session',
    persist: false,
    summary: (e) => `Phase: ${e.command} starting`,
  },

  'phase:end': {
    scope: 'session',
    persist: false,
    summary: (e) => `Phase complete: ${e.result.status}`,
  },

  // -------------------------------------------------------------------------
  // Config and plan warnings
  // -------------------------------------------------------------------------

  'config:warning': {
    scope: 'session',
    persist: false,
    summary: (e) => `Config warning: ${e.message}`,
  },

  'planning:warning': {
    scope: 'session',
    persist: false,
    summary: (e) =>
      e.planId ? `Plan warning (${e.planId}): ${e.message}` : `Plan warning: ${e.message}`,
  },

  'planning:module:build-config:invalid': {
    scope: 'session',
    persist: false,
    summary: (e) =>
      `Module ${e.moduleId} emitted invalid <build-config> (${e.reason}): ${e.errors.join('; ')}`,
  },

  'extension:event-handler:failed': {
    scope: 'session',
    persist: false,
    summary: (e) =>
      `Extension ${e.extensionName} event hook failed (${e.pattern} on ${e.triggeringEventType}): ${e.message}`,
  },

  'extension:event-handler:timeout': {
    scope: 'session',
    persist: false,
    summary: (e) =>
      `Extension ${e.extensionName} event hook timed out after ${e.timeoutMs}ms (${e.pattern} on ${e.triggeringEventType})`,
  },

  'extension:action:start': { scope: 'daemon', persist: true, summary: (e) => `Extension action ${e.actionId} started for ${e.extensionName}` },
  'extension:action:complete': { scope: 'daemon', persist: true, summary: (e) => `Extension action ${e.actionId} completed for ${e.extensionName}` },
  'extension:action:failed': { scope: 'daemon', persist: true, summary: (e) => `Extension action ${e.actionId} failed for ${e.extensionName}: ${e.errorCode}` },
  'extension:action:timeout': { scope: 'daemon', persist: true, summary: (e) => `Extension action ${e.actionId} timed out for ${e.extensionName} after ${e.timeoutMs}ms` },

  // --- eforge:region extension-agent-task-contracts ---
  'extension:agent-task:start': { scope: 'daemon', persist: true, summary: (e) => `Extension agent task ${e.taskId} started (${e.taskKind})` },
  'extension:agent-task:progress': { scope: 'daemon', persist: true, summary: (e) => `Extension agent task ${e.taskId} progress: ${e.message}` },
  'extension:agent-task:complete': { scope: 'daemon', persist: true, summary: (e) => `Extension agent task ${e.taskId} completed (${e.taskKind})` },
  'extension:agent-task:failed': { scope: 'daemon', persist: true, summary: (e) => `Extension agent task ${e.taskId} failed (${e.errorCode}): ${e.message}` },
  'extension:agent-task:cancelled': { scope: 'daemon', persist: true, summary: (e) => `Extension agent task ${e.taskId} cancelled${e.reason ? `: ${e.reason}` : ''}` },
  // --- eforge:endregion extension-agent-task-contracts ---

  'extension:agent-context:applied': {
    scope: 'session',
    persist: false,
    summary: (e) =>
      `Extension ${e.extensionName} appended ${e.promptCharCount} chars to ${e.role}${e.tier ? ` (${e.tier})` : ''}`,
  },

  'extension:agent-context:failed': {
    scope: 'session',
    persist: false,
    summary: (e) =>
      `Extension ${e.extensionName} agent-context hook failed for ${e.role}: ${e.message}`,
  },

  'extension:agent-context:timeout': {
    scope: 'session',
    persist: false,
    summary: (e) =>
      `Extension ${e.extensionName} agent-context hook timed out after ${e.timeoutMs}ms for ${e.role}`,
  },

  'extension:agent-context:unsupported': {
    scope: 'session',
    persist: false,
    summary: (e) =>
      `Extension ${e.extensionName} returned unsupported fields for ${e.role}: ${e.fields.join(', ')} (deferred to EXTEND_08B)`,
  },

  'extension:agent-tools:applied': {
    scope: 'session',
    persist: false,
    summary: (e) =>
      `Extension ${e.extensionName} applied tools for ${e.role}: ${e.toolCount} accepted, ${e.excludedToolCount} excluded`,
  },

  'queue:profile:selected': {
    scope: 'session',
    persist: false,
    summary: (e) =>
      `Queue routed ${e.prdId} to profile "${e.profile}" via ${e.extensionName}:${e.routerName}${e.reason ? ` (${e.reason})` : ''}`,
  },

  'queue:profile:router-failed': {
    scope: 'session',
    persist: false,
    summary: (e) =>
      `Profile router "${e.routerName}" (${e.extensionName}) failed for ${e.prdId}: ${e.message}`,
  },

  'queue:profile:router-timeout': {
    scope: 'session',
    persist: false,
    summary: (e) =>
      `Profile router "${e.routerName}" (${e.extensionName}) timed out after ${e.timeoutMs}ms for ${e.prdId}`,
  },

  'queue:profile:invalid-selection': {
    scope: 'session',
    persist: false,
    summary: (e) =>
      `Profile router "${e.routerName}" (${e.extensionName}) returned unknown profile "${e.requestedProfile}" for ${e.prdId}: ${e.message}`,
  },

  'extension:policy:decision': {
    scope: 'session',
    persist: false,
    summary: (e) =>
      `Policy gate ${e.method} (${e.extensionName}) returned ${e.decision}${e.reason ? `: ${e.reason}` : ''}`,
  },

  'extension:policy:failed': {
    scope: 'session',
    persist: false,
    summary: (e) =>
      `Policy gate ${e.method} (${e.extensionName}) failed under ${e.failurePolicy}: ${e.message}`,
  },

  'extension:policy:timeout': {
    scope: 'session',
    persist: false,
    summary: (e) =>
      `Policy gate ${e.method} (${e.extensionName}) timed out after ${e.timeoutMs}ms under ${e.failurePolicy}`,
  },

  'extension:input-source:fetched': {
    scope: 'session',
    persist: false,
    summary: (e) =>
      `Extension ${e.extensionName} input source "${e.adapterName}" fetched "${e.sourceId}" (${e.contentLength} chars)`,
  },

  'extension:input-source:failed': {
    scope: 'session',
    persist: false,
    summary: (e) =>
      `Extension ${e.extensionName} input source "${e.adapterName}" failed for "${e.sourceId}" (${e.reason}): ${e.message}`,
  },

  'extension:prd-enricher:applied': {
    scope: 'session',
    persist: false,
    summary: (e) =>
      `Extension ${e.extensionName} PRD enricher "${e.enricherName}" applied to "${e.sourceId}" (changed: ${e.changed})`,
  },

  'extension:prd-enricher:failed': {
    scope: 'session',
    persist: false,
    summary: (e) =>
      `Extension ${e.extensionName} PRD enricher "${e.enricherName}" failed for "${e.sourceId}" (${e.reason}): ${e.message}`,
  },

  'extension:reviewer-perspective:applied': {
    scope: 'session',
    persist: false,
    summary: (e) =>
      `Extension ${e.extensionName} reviewer perspective "${e.perspectiveKey}" applied${e.planId ? ` (plan: ${e.planId})` : ''}`,
  },

  'extension:reviewer-perspective:skipped': {
    scope: 'session',
    persist: false,
    summary: (e) => {
      const source = e.extensionName ? `Extension ${e.extensionName} reviewer perspective` : 'Reviewer perspective';
      return `${source} "${e.perspectiveKey}" skipped (${e.reason})${e.message ? `: ${e.message}` : ''}`;
    },
  },

  'extension:validation-provider:start': {
    scope: 'session',
    persist: false,
    summary: (e) =>
      `Extension ${e.extensionName} validation provider "${e.providerName}" started (${e.kind}${e.commandCount !== undefined ? `, ${e.commandCount} command(s)` : ''})`,
  },

  'extension:validation-provider:complete': {
    scope: 'session',
    persist: false,
    summary: (e) =>
      `Extension ${e.extensionName} validation provider "${e.providerName}" ${e.status}${e.message ? `: ${e.message}` : ''}`,
  },

  'extension:validation-provider:error': {
    scope: 'session',
    persist: false,
    summary: (e) =>
      `Extension ${e.extensionName} validation provider "${e.providerName}" failed${e.command ? ` (command: ${e.command})` : ''}: ${e.message}`,
  },

  'extension:validation-provider:timeout': {
    scope: 'session',
    persist: false,
    summary: (e) =>
      `Extension ${e.extensionName} validation provider "${e.providerName}" timed out after ${e.timeoutMs}ms${e.command ? ` (command: ${e.command})` : ''}`,
  },

  // -------------------------------------------------------------------------
  // Planning
  // -------------------------------------------------------------------------

  'planning:start': {
    scope: 'session',
    persist: false,
    summary: (e) => `Planning from ${e.label ?? e.source}`,
  },

  'planning:preflight': {
    scope: 'session',
    persist: false,
    summary: (e) => `Compile preflight: ${e.risk.level}; ${e.risk.sourceBytes} source bytes; recovery ${e.risk.recommendation.action}`,
  },

  'planning:inspection-summary': {
    scope: 'session', persist: true,
    summary: (e) => `Planner compact inspection summary: ${e.summary.relevantFiles.length} file(s), ${e.summary.observedFacts.length} fact(s), ${e.summary.importantFindings.length} finding(s)`,
  },

  'planning:skip': {
    scope: 'session',
    persist: false,
    summary: (e) => `Planning skipped: ${e.reason}`,
  },

  'planning:submission': {
    scope: 'session',
    persist: false,
    summary: (e) => `Planning submitted ${e.planCount} plan(s)`,
  },

  'planning:error': {
    scope: 'session',
    persist: false,
    summary: (e) => `Planning error: ${e.reason}`,
  },

  'planning:scope-context:failure': { scope: 'session', persist: true, summary: (e) => `Compile scope/context failure: ${e.failure.failureKind} from ${e.failure.source}; recovery ${e.failure.recovery.action}` },

  'planning:decomposition:start': { scope: 'session', persist: true, summary: (e) => `Context-managed planning: ${e.unitCount} unit(s), ${e.edgeCount} edge(s), parallelism ${e.limits.parallelism}${e.riskEvidence ? `, ${e.riskEvidence.acceptanceCriteriaCount} criteria` : ''}` }, 'planning:decomposition:unit:queued': { scope: 'session', persist: true, summary: (e) => `Planning unit queued: ${e.unit.unitId}${e.unit.subsystemHints.length ? ` (${e.unit.subsystemHints.join(', ')})` : ''}` }, 'planning:decomposition:unit:running': { scope: 'session', persist: true, summary: (e) => `Planning unit running: ${e.unitId}` }, 'planning:decomposition:unit:progress': { scope: 'session', persist: false, summary: (e) => `Planning unit ${e.unitId}: ${e.message}` }, 'planning:decomposition:unit:completed': { scope: 'session', persist: true, summary: (e) => `Planning unit completed: ${e.unit.unitId} (${e.unit.coverage.coveredCriteria.length} criteria)` }, 'planning:decomposition:unit:skipped': { scope: 'session', persist: true, summary: (e) => `Planning unit skipped: ${e.unitId} — ${e.reason}` }, 'planning:decomposition:unit:failed': { scope: 'session', persist: true, summary: (e) => `Planning unit failed: ${e.unitId} — ${e.reason || e.evidence.observed.triggeredLimitKeys.join(', ')}` }, 'planning:decomposition:schedule': { scope: 'session', persist: true, summary: (e) => `Planning schedule: running [${e.decision.runningUnitIds.join(', ')}]; waiting ${e.decision.waitingUnitIds.length}; selected [${e.decision.selectedBatchUnitIds.join(', ')}]` }, 'planning:decomposition:budget': { scope: 'session', persist: true, summary: (e) => `Planning budget: ${e.unitId} ${e.observed?.triggeredLimitKeys.length ? `triggered ${e.observed.triggeredLimitKeys.join(', ')}` : 'within limits'}` }, 'planning:decomposition:compact-handoff': { scope: 'session', persist: true, summary: (e) => `Planning unit handoff: ${e.unitId ?? 'unknown'} → ${e.artifactPath ?? 'artifact'} (${e.byteLength} B)` }, 'planning:decomposition:synthesis:complete': { scope: 'session', persist: true, summary: (e) => `Context-managed synthesis complete: ${e.artifactPaths.length} artifact(s), ${e.completedUnitCount}/${e.failedUnitCount}/${e.skippedUnitCount} units` },

  'planning:clarification': {
    scope: 'session',
    persist: false,
    summary: (e) => `Planning clarification needed (${e.questions.length} question(s))`,
  },

  'planning:clarification:answer': {
    scope: 'session',
    persist: false,
    summary: 'Clarification answered, resuming planning',
  },

  'planning:progress': {
    scope: 'session',
    persist: false,
  },

  'planning:continuation': {
    scope: 'session',
    persist: false,
    summary: (e) => `Planning continuation attempt ${e.attempt}/${e.maxContinuations}${e.reason ? ` (${e.reason})` : ''}`,
  },

  'planning:pipeline': {
    scope: 'session',
    persist: false,
    summary: (e) => `Pipeline: ${e.scope}`,
  },

  'planning:complete': {
    scope: 'session',
    persist: false,
    summary: (e) =>
      e.plans.length === 0
        ? 'Planning complete: nothing to plan'
        : `Planning complete: ${e.plans.length} plan(s) created`,
  },

  // -------------------------------------------------------------------------
  // Planning review
  // -------------------------------------------------------------------------

  'planning:review:start': {
    scope: 'session',
    persist: false,
    summary: 'Reviewing plan files',
  },

  'planning:review:complete': {
    scope: 'session',
    persist: false,
    summary: (e) =>
      e.issues.length === 0
        ? 'Plan review complete: no issues'
        : `Plan review: ${e.issues.length} issue(s)`,
  },

  'planning:evaluate:start': {
    scope: 'session',
    persist: false,
    summary: 'Evaluating plan review fixes',
  },

  'planning:evaluate:continuation': {
    scope: 'session',
    persist: false,
    summary: (e) => `Plan evaluation continuation attempt ${e.attempt}/${e.maxContinuations}`,
  },

  'planning:evaluate:complete': {
    scope: 'session',
    persist: false,
    summary: (e) => `Plan evaluation: ${e.accepted} accepted, ${e.rejected} rejected`,
  },

  // -------------------------------------------------------------------------
  // Architecture review
  // -------------------------------------------------------------------------

  'planning:architecture:review:start': {
    scope: 'session',
    persist: false,
    summary: 'Reviewing architecture',
  },

  'planning:architecture:review:complete': {
    scope: 'session',
    persist: false,
    summary: (e) =>
      e.issues.length === 0
        ? 'Architecture review complete: no issues'
        : `Architecture review: ${e.issues.length} issue(s)`,
  },

  'planning:architecture:evaluate:start': {
    scope: 'session',
    persist: false,
    summary: 'Evaluating architecture review fixes',
  },

  'planning:architecture:evaluate:continuation': {
    scope: 'session',
    persist: false,
    summary: (e) =>
      `Architecture evaluation continuation attempt ${e.attempt}/${e.maxContinuations}`,
  },

  'planning:architecture:evaluate:complete': {
    scope: 'session',
    persist: false,
    summary: (e) => `Architecture evaluation: ${e.accepted} accepted, ${e.rejected} rejected`,
  },

  // -------------------------------------------------------------------------
  // Cohesion review
  // -------------------------------------------------------------------------

  'planning:cohesion:start': {
    scope: 'session',
    persist: false,
    summary: 'Reviewing cross-module cohesion',
  },

  'planning:cohesion:complete': {
    scope: 'session',
    persist: false,
    summary: (e) =>
      e.issues.length === 0
        ? 'Cohesion review complete: no issues'
        : `Cohesion review: ${e.issues.length} issue(s)`,
  },

  'planning:cohesion:evaluate:start': {
    scope: 'session',
    persist: false,
    summary: 'Evaluating cohesion review fixes',
  },

  'planning:cohesion:evaluate:continuation': {
    scope: 'session',
    persist: false,
    summary: (e) =>
      `Cohesion evaluation continuation attempt ${e.attempt}/${e.maxContinuations}`,
  },

  'planning:cohesion:evaluate:complete': {
    scope: 'session',
    persist: false,
    summary: (e) => `Cohesion evaluation: ${e.accepted} accepted, ${e.rejected} rejected`,
  },

  // -------------------------------------------------------------------------
  // Building (per-plan)
  // -------------------------------------------------------------------------

  'plan:build:start': {
    scope: 'session',
    persist: false,
    summary: (e) => `Plan ${e.planId}: starting`,
  },

  'plan:build:implement:start': {
    scope: 'session',
    persist: false,
    summary: (e) => `Plan ${e.planId}: implementing`,
  },

  'plan:build:implement:progress': {
    scope: 'session',
    persist: false,
  },

  'plan:build:implement:continuation': {
    scope: 'session',
    persist: false,
    summary: (e) =>
      `Plan ${e.planId}: implementation continuation attempt ${e.attempt}/${e.maxContinuations}`,
  },

  'plan:build:implement:complete': {
    scope: 'session',
    persist: false,
    summary: (e) => `Plan ${e.planId}: implementation complete`,
  },

  'plan:build:files_changed': {
    scope: 'session',
    persist: false,
    summary: (e) => `Plan ${e.planId}: ${e.files.length} file(s) changed`,
  },

  'plan:build:review:start': {
    scope: 'session',
    persist: false,
    summary: (e) => `Plan ${e.planId}: reviewing`,
  },

  'plan:build:review:complete': {
    scope: 'session',
    persist: false,
    summary: (e) =>
      e.issues.length === 0
        ? `Plan ${e.planId}: review complete, no issues`
        : `Plan ${e.planId}: review complete, ${e.issues.length} issue(s)`,
  },

  'plan:build:review:parallel:start': {
    scope: 'session',
    persist: false,
    summary: (e) => `Plan ${e.planId}: parallel review (${e.perspectives.join(', ')})`,
  },

  'plan:build:review:parallel:perspective:start': {
    scope: 'session',
    persist: false,
  },

  'plan:build:review:parallel:perspective:complete': {
    scope: 'session',
    persist: false,
    summary: (e) =>
      e.issues.length > 0
        ? `Plan ${e.planId}: ${e.perspective} review, ${e.issues.length} issue(s)`
        : undefined,
  },

  'plan:build:review:parallel:perspective:error': {
    scope: 'session',
    persist: false,
    summary: (e) => `Plan ${e.planId}: ${e.perspective} review failed: ${e.error}`,
  },

  'plan:build:review:fix:start': {
    scope: 'session',
    persist: false,
    summary: (e) => `Plan ${e.planId}: applying ${e.issueCount} fix(es)`,
  },

  'plan:build:review:fix:complete': {
    scope: 'session',
    persist: false,
    summary: (e) => `Plan ${e.planId}: fixes applied`,
  },

  'plan:build:review:fix:continuation': {
    scope: 'session',
    persist: false,
    summary: (e) => `Plan ${e.planId}: review-fixer continuation attempt ${e.attempt}/${e.maxContinuations}`,
  },

  'plan:build:evaluate:start': {
    scope: 'session',
    persist: false,
    summary: (e) => `Plan ${e.planId}: evaluating fixes`,
  },

  'plan:build:evaluate:continuation': {
    scope: 'session',
    persist: false,
    summary: (e) =>
      `Plan ${e.planId}: evaluation continuation attempt ${e.attempt}/${e.maxContinuations}`,
  },

  'plan:build:evaluate:complete': {
    scope: 'session',
    persist: false,
    summary: (e) =>
      `Plan ${e.planId}: evaluation complete, ${e.accepted} accepted, ${e.rejected} rejected`,
  },

  'plan:build:doc-author:start': {
    scope: 'session',
    persist: false,
    summary: (e) => `Plan ${e.planId}: authoring docs`,
  },

  'plan:build:doc-author:complete': {
    scope: 'session',
    persist: false,
    summary: (e) =>
      e.docsAuthored > 0 ? `Plan ${e.planId}: ${e.docsAuthored} doc(s) authored` : undefined,
  },

  'plan:build:doc-sync:start': {
    scope: 'session',
    persist: false,
    summary: (e) => `Plan ${e.planId}: syncing docs`,
  },

  'plan:build:doc-sync:complete': {
    scope: 'session',
    persist: false,
    summary: (e) =>
      e.docsSynced > 0 ? `Plan ${e.planId}: ${e.docsSynced} doc(s) synced` : undefined,
  },

  'plan:build:test:write:start': {
    scope: 'session',
    persist: false,
    summary: (e) => `Plan ${e.planId}: writing tests`,
  },

  'plan:build:test:write:complete': {
    scope: 'session',
    persist: false,
    summary: (e) =>
      e.testsWritten > 0 ? `Plan ${e.planId}: ${e.testsWritten} test file(s) written` : undefined,
  },

  'plan:build:test:start': {
    scope: 'session',
    persist: false,
    summary: (e) => `Plan ${e.planId}: running tests`,
  },

  'plan:build:test:complete': {
    scope: 'session',
    persist: false,
    summary: (e) => {
      const parts = [`${e.passed} passed`];
      if (e.failed > 0) parts.push(`${e.failed} failed`);
      if (e.testBugsFixed > 0) parts.push(`${e.testBugsFixed} test bugs fixed`);
      return `Plan ${e.planId}: tests ${parts.join(', ')}`;
    },
  },

  'plan:build:complete': {
    scope: 'session',
    persist: false,
    summary: (e) => `Plan ${e.planId}: complete`,
  },

  'plan:build:failed': {
    scope: 'session',
    persist: false,
    summary: (e) => `Plan ${e.planId}: failed — ${e.error}`,
  },

  'plan:build:progress': {
    scope: 'session',
    persist: false,
  },

  // -------------------------------------------------------------------------
  // Plan lifecycle state events
  // -------------------------------------------------------------------------

  'plan:status:change': {
    scope: 'session',
    persist: true,
    summary: (e) => `Plan ${e.planId}: status → ${e.status}`,
    // Projection is owned by the session reducer (handle-plan-lifecycle.ts);
    // DaemonState has no per-plan status field, so this is intentionally a no-op.
    project: () => undefined,
  },

  'plan:error:set': {
    scope: 'session',
    persist: true,
    summary: (e) => `Plan ${e.planId}: error set`,
    // Projection is owned by the session reducer (handle-plan-lifecycle.ts);
    // DaemonState has no per-plan status field, so this is intentionally a no-op.
    project: () => undefined,
  },

  'plan:error:clear': {
    scope: 'session',
    persist: true,
    summary: (e) => `Plan ${e.planId}: error cleared`,
    // Projection is owned by the session reducer (handle-plan-lifecycle.ts);
    // DaemonState has no per-plan status field, so this is intentionally a no-op.
    project: () => undefined,
  },

  // -------------------------------------------------------------------------
  // Orchestration
  // -------------------------------------------------------------------------

  'schedule:start': {
    scope: 'session',
    persist: false,
    summary: (e) => `Scheduling ${e.planIds.length} plan(s)`,
  },

  'plan:schedule:ready': {
    scope: 'session',
    persist: false,
    summary: (e) => `Plan ${e.planId} ready to schedule: ${e.reason}`,
  },

  'plan:merge:start': {
    scope: 'session',
    persist: false,
    summary: (e) => `Merging plan ${e.planId}`,
  },

  'plan:merge:complete': {
    scope: 'session',
    persist: false,
    summary: (e) => `Plan ${e.planId} merged`,
  },

  'plan:build:decision': {
    scope: 'session',
    persist: false,
    summary: (e) => `Plan ${e.planId}: decision (${e.decision.kind})`,
  },

  'planning:decision': {
    scope: 'session',
    persist: false,
    summary: (e) =>
      e.planId
        ? `Planning decision (${e.decision.kind}) for plan ${e.planId}`
        : `Planning decision (${e.decision.kind})`,
  },

  'plan:merge:resolve:start': {
    scope: 'session',
    persist: false,
    summary: (e) => `Resolving merge conflicts for plan ${e.planId}`,
  },

  'plan:merge:resolve:complete': {
    scope: 'session',
    persist: false,
    summary: (e) =>
      e.resolved
        ? `Merge conflicts resolved for plan ${e.planId}`
        : `Failed to resolve merge conflicts for plan ${e.planId}`,
  },

  'landing:start': {
    scope: 'session',
    persist: false,
    summary: (e) => `Landing (${e.action}): starting ${e.featureBranch} → ${e.baseBranch}`,
  },

  'landing:complete': {
    scope: 'session',
    persist: false,
    summary: (e) => {
      if (e.action === 'pr') {
        return e.prUrl
          ? `Landing (${e.action}): PR ${e.prUrl}`
          : `Landing (${e.action}): PR created for ${e.featureBranch}`;
      }
      if (e.action === 'merge') return `Landing (${e.action}): merged ${e.featureBranch} into ${e.baseBranch}`;
      if (e.action === 'leave') return `Landing (${e.action}): ${e.featureBranch} left for manual workflow`;
      return `Landing (${e.action}): completed`;
    },
  },

  'landing:skipped': {
    scope: 'session',
    persist: false,
    summary: (e) => `Landing (${e.action}) skipped: ${e.reason}`,
  },

  'landing:auto-merge:start': {
    scope: 'session',
    persist: false,
    summary: (e) => `PR auto-merge: enabling for ${e.prUrl}`,
  },

  'landing:auto-merge:complete': {
    scope: 'session',
    persist: false,
    summary: (e) => `PR auto-merge: enabled for ${e.prUrl}`,
  },

  'landing:auto-merge:skipped': {
    scope: 'session',
    persist: false,
    summary: (e) => `PR auto-merge skipped: ${e.reason}`,
  },

  'stack:layer:recorded': {
    scope: 'session',
    persist: true,
    summary: (e) => `Stack layer recorded: ${e.prdId} (${e.status}) on ${e.branch}`,
    project: (e, state) => {
      const existing = state.stackLayers.find((l) => l.prdId === e.prdId);
      if (existing) {
        return {
          stackLayers: state.stackLayers.map((l) =>
            l.prdId === e.prdId
              ? {
                  ...l,
                  stackId: e.stackId,
                  parentPrdId: e.parentPrdId,
                  provider: e.provider,
                  branch: e.branch,
                  baseBranch: e.baseBranch,
                  ...(e.artifact !== undefined && { artifact: e.artifact }),
                  ...(e.landingAction !== undefined && { landingAction: e.landingAction }),
                  status: e.status,
                  updatedAt: e.timestamp,
                }
              : l,
          ),
        };
      }
      return {
        stackLayers: [
          ...state.stackLayers,
          {
            prdId: e.prdId,
            stackId: e.stackId,
            parentPrdId: e.parentPrdId,
            provider: e.provider,
            branch: e.branch,
            baseBranch: e.baseBranch,
            ...(e.artifact !== undefined && { artifact: e.artifact }),
            ...(e.landingAction !== undefined && { landingAction: e.landingAction }),
            status: e.status,
            recordedAt: e.timestamp,
            updatedAt: e.timestamp,
          },
        ],
      };
    },
  },

  'stack:provider:command': {
    scope: 'session',
    persist: true,
    summary: (e) => {
      const argv = e.args ? [e.command, ...e.args].join(' ') : e.command;
      return `Stack provider (${e.provider}): ${argv} → exit ${e.exitCode}`;
    },
  },

  'stack:landing:update': {
    scope: 'session',
    persist: true,
    summary: (e) => {
      const base = `Stack landing: ${e.prdId} (${e.action}) ${e.status}`;
      const repair = e.baseRepairReason ? ` (base repaired: ${e.originalBaseBranch ?? '?'} → ${e.effectiveBaseBranch ?? '?'})` : '';
      if (e.prUrl) return `${base}${repair} — ${e.prUrl}`;
      if (e.reason) return `${base}${repair} — ${e.reason}`;
      return `${base}${repair}`;
    },
    project: (e, state) => {
      const existing = state.stackLayers.find((l) => l.prdId === e.prdId);
      if (!existing) return undefined;
      // Map landing event to layer status:
      //   complete + pr/leave   → 'landed'
      //   complete + merge      → 'merged'
      //   failed                → 'failed'
      //   skipped + merge       → 'merged'
      //   skipped + leave       → 'landed'
      //   skipped + pr          → 'failed' (pre-landing skip)
      //   started               → no change (preserve existing layer status)
      let layerStatus = existing.status;
      if (e.status === 'complete') {
        layerStatus = e.action === 'merge' ? 'merged' : 'landed';
      } else if (e.status === 'failed') {
        layerStatus = 'failed';
      } else if (e.status === 'skipped') {
        if (e.action === 'merge') {
          layerStatus = 'merged';
        } else if (e.action === 'leave') {
          layerStatus = 'landed';
        } else {
          // pr action skipped = pre-landing failure
          layerStatus = 'failed';
        }
      }
      return {
        stackLayers: state.stackLayers.map((l) =>
          l.prdId === e.prdId
            ? {
                ...l,
                status: layerStatus,
                landing: {
                  action: e.action,
                  status: e.status,
                  prUrl: e.prUrl,
                  reason: e.reason,
                  originalBaseBranch: e.originalBaseBranch,
                  effectiveBaseBranch: e.effectiveBaseBranch,
                  baseRepairReason: e.baseRepairReason,
                  startedAt: l.landing?.startedAt ?? e.timestamp,
                  completedAt:
                    e.status === 'complete' || e.status === 'failed' || e.status === 'skipped'
                      ? e.timestamp
                      : undefined,
                },
                updatedAt: e.timestamp,
              }
            : l,
        ),
      };
    },
  },

  'stack:landing:conflict:detected': {
    scope: 'session', persist: true,
    summary: (e) => `Stack landing conflict: ${e.prdId} ${e.operation} (${e.conflictedFiles.length} file(s))`,
  },
  'stack:landing:conflict:recovery:start': {
    scope: 'session', persist: true,
    summary: (e) => `Stack landing recovery attempt ${e.attempt}/${e.maxAttempts}: ${e.prdId}`,
  },
  'stack:landing:conflict:recovery:complete': {
    scope: 'session', persist: true,
    summary: (e) => `Stack landing recovery complete: ${e.prdId} after ${e.attempts} attempt(s)`,
  },
  'stack:landing:conflict:recovery:failed': {
    scope: 'session', persist: true,
    summary: (e) => `Stack landing recovery failed: ${e.prdId} — ${e.reason}`,
  },

  'merge:finalize:start': {
    scope: 'session',
    persist: false,
    summary: (e) => `Merging ${e.featureBranch} into ${e.baseBranch}`,
  },

  'merge:finalize:complete': {
    scope: 'session',
    persist: false,
    summary: (e) => `Merged ${e.featureBranch} into ${e.baseBranch}`,
  },

  'merge:finalize:skipped': {
    scope: 'session',
    persist: false,
    summary: (e) => `Feature branch merge skipped: ${e.reason}`,
  },

  'merge:worktree:set': {
    scope: 'session',
    persist: true,
    // Projection is owned by the session reducer (handle-plan-lifecycle.ts);
    // DaemonState has no per-plan status field, so this is intentionally a no-op.
    project: () => undefined,
  },

  'merge:worktree:clear': {
    scope: 'session',
    persist: true,
    // Projection is owned by the session reducer (handle-plan-lifecycle.ts);
    // DaemonState has no per-plan status field, so this is intentionally a no-op.
    project: () => undefined,
  },

  // -------------------------------------------------------------------------
  // Expedition planning phases
  // -------------------------------------------------------------------------

  'expedition:architecture:complete': {
    scope: 'session',
    persist: false,
    summary: (e) => `Architecture complete: ${e.modules.length} module(s) defined`,
  },

  'expedition:wave:start': {
    scope: 'session',
    persist: false,
    summary: (e) => `Wave ${e.wave} started: ${e.moduleIds.join(', ')}`,
  },

  'expedition:wave:complete': {
    scope: 'session',
    persist: false,
    summary: (e) => `Wave ${e.wave} complete`,
  },

  'expedition:module:start': {
    scope: 'session',
    persist: false,
    summary: (e) => `Planning module ${e.moduleId}`,
  },

  'expedition:module:complete': {
    scope: 'session',
    persist: false,
    summary: (e) => `Module ${e.moduleId} planned`,
  },

  'expedition:compile:start': {
    scope: 'session',
    persist: false,
    summary: 'Compiling plan files',
  },

  'expedition:compile:complete': {
    scope: 'session',
    persist: false,
    summary: (e) => `Compiled ${e.plans.length} plan file(s)`,
  },

  // -------------------------------------------------------------------------
  // Agent lifecycle
  // -------------------------------------------------------------------------

  'agent:start': {
    scope: 'session',
    persist: false,
    summary: (e) =>
      e.planId ? `Agent ${e.agent} started (plan ${e.planId})` : `Agent ${e.agent} started`,
  },

  'agent:warning': {
    scope: 'session',
    persist: false,
    summary: (e) => `Agent ${e.agent} warning: ${e.message}`,
  },

  'agent:stop': {
    scope: 'session',
    persist: false,
    summary: (e) =>
      e.error
        ? `Agent ${e.agent} stopped with error`
        : `Agent ${e.agent} stopped`,
  },

  'agent:usage': {
    scope: 'session',
    persist: false,
  },

  'agent:message': {
    scope: 'session',
    persist: false,
  },

  'agent:tool_use': {
    scope: 'session',
    persist: false,
  },

  'agent:tool_result': {
    scope: 'session',
    persist: false,
  },

  'agent:result': {
    scope: 'session',
    persist: false,
  },

  'agent:activity': {
    scope: 'session',
    persist: false,
    summary: (e) => `Agent ${e.agent} activity (${e.totals?.filesChanged ?? 0} files, ${e.attribution})`,
  },

  'agent:retry': {
    scope: 'session',
    persist: false,
    summary: (e) =>
      `Agent ${e.agent} retry attempt ${e.attempt}/${e.maxAttempts} (${e.subtype})`,
  },

  // -------------------------------------------------------------------------
  // Validation (post-merge)
  // -------------------------------------------------------------------------

  'validation:start': {
    scope: 'session',
    persist: false,
    summary: (e) => `Running post-merge validation (${e.commands.length} command(s))`,
  },

  'validation:command:start': {
    scope: 'session',
    persist: false,
    summary: (e) => `Running: ${e.command}`,
  },

  'validation:command:complete': {
    scope: 'session',
    persist: false,
    summary: (e) =>
      e.exitCode === 0 ? `${e.command} passed` : `${e.command} failed (exit ${e.exitCode})`,
  },

  'validation:command:timeout': {
    scope: 'session',
    persist: false,
    summary: (e) =>
      `${e.command} timed out after ${Math.round(e.timeoutMs / 1000)}s`,
  },

  'validation:complete': {
    scope: 'session',
    persist: false,
    summary: (e) => (e.passed ? 'All validation commands passed' : 'Validation failed'),
  },

  'validation:fix:start': {
    scope: 'session',
    persist: false,
    summary: (e) => `Validation fix attempt ${e.attempt}/${e.maxAttempts}`,
  },

  'validation:fix:complete': {
    scope: 'session',
    persist: false,
    summary: (e) => `Validation fix attempt ${e.attempt} complete`,
  },

  // -------------------------------------------------------------------------
  // PRD validation
  // -------------------------------------------------------------------------

  'prd_validation:start': {
    scope: 'session',
    persist: false,
    summary: 'PRD validation starting',
  },

  'prd_validation:complete': {
    scope: 'session',
    persist: false,
    summary: (e) =>
      e.passed
        ? 'PRD validation passed'
        : `PRD validation failed: ${e.gaps.length} gap(s)`,
  },

  // -------------------------------------------------------------------------
  // Gap closing
  // -------------------------------------------------------------------------

  'gap_close:start': {
    scope: 'session',
    persist: false,
    summary: (e) =>
      e.gapCount !== undefined ? `Closing ${e.gapCount} gap(s)` : 'Closing PRD validation gaps',
  },

  'gap_close:plan_ready': {
    scope: 'session',
    persist: false,
  },

  'gap_close:complete': {
    scope: 'session',
    persist: false,
    summary: (e) => e.passed ? 'Gap closing complete: all gaps resolved' : 'Gap closing complete: gaps remain',
  },

  'acceptance_validation:complete': {
    scope: 'session',
    persist: false,
    summary: (e) => {
      const counts = e.verdicts.reduce((acc, verdict) => {
        acc[verdict.verdict] += 1;
        return acc;
      }, { pass: 0, fail: 0, unknown: 0 });
      const conflicts = e.acceptanceConflicts?.length ?? 0;
      const suffix = conflicts > 0 ? ` (${conflicts} conflict(s) reported)` : '';
      if (e.passed) return `Acceptance validation passed: ${e.verdicts.length} criterion/criteria verified${suffix}`;
      if (counts.fail > 0) {
        const unknownPart = counts.unknown > 0 ? `, ${counts.unknown} unknown` : '';
        return `Acceptance validation failed: ${counts.fail} criterion/criteria failed${unknownPart}${suffix}`;
      }
      const allUnknown = counts.unknown === e.verdicts.length ? '; no criterion was verified' : '';
      return `Acceptance validation inconclusive: ${counts.unknown} criterion/criteria unknown${allUnknown}${suffix}`;
    },
  },

  // -------------------------------------------------------------------------
  // Reconciliation
  // -------------------------------------------------------------------------

  'reconciliation:start': {
    scope: 'session',
    persist: false,
    summary: 'Reconciling worktree state',
  },

  'reconciliation:complete': {
    scope: 'session',
    persist: false,
    summary: (e) => {
      const parts: string[] = [];
      if (e.report.valid.length > 0) parts.push(`${e.report.valid.length} valid`);
      if (e.report.missing.length > 0) parts.push(`${e.report.missing.length} missing`);
      if (e.report.corrupt.length > 0) parts.push(`${e.report.corrupt.length} corrupt`);
      return `Reconciliation complete: ${parts.join(', ')}`;
    },
  },

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  'cleanup:start': {
    scope: 'session',
    persist: false,
    summary: (e) => `Cleaning up plan files for ${e.planSet}`,
  },

  'cleanup:complete': {
    scope: 'session',
    persist: false,
    summary: (e) => `Plan files removed for ${e.planSet}`,
  },

  // -------------------------------------------------------------------------
  // User interaction
  // -------------------------------------------------------------------------

  'approval:needed': {
    scope: 'session',
    persist: false,
    summary: (e) => `Approval needed: ${e.action}`,
  },

  'approval:response': {
    scope: 'session',
    persist: false,
    summary: (e) => (e.approved ? 'Approved' : 'Denied'),
  },

  // -------------------------------------------------------------------------
  // Enqueue
  // -------------------------------------------------------------------------

  'enqueue:start': {
    scope: 'daemon',
    persist: true,
    summary: (e) => `Enqueueing from ${e.source}`,
    // daemon:run:upsert is now the single source of truth for DaemonState.runs;
    // the project function is intentionally absent. The activity-feed summary
    // is preserved for the ring buffer.
  },

  'enqueue:complete': {
    scope: 'daemon',
    persist: true,
    summary: (e) => `Enqueued: ${e.title}`,
    // daemon:run:upsert remains the single source of truth for DaemonState.runs.
    project: projectEnqueueComplete,
  },

  'enqueue:failed': {
    scope: 'daemon',
    persist: true,
    summary: (e) => `Enqueue failed: ${e.error}`,
    // daemon:run:upsert is now the single source of truth for DaemonState.runs;
    // the project function is intentionally absent.
  },

  'enqueue:commit-failed': {
    scope: 'daemon',
    persist: true,
    summary: (e) => `Enqueue commit failed: ${e.error}`,
  },

  // -------------------------------------------------------------------------
  // Recovery analysis
  // -------------------------------------------------------------------------

  'build:terminal-failure': {
    scope: 'session',
    persist: true,
    summary: (e) => `Build terminal failure (${e.failure.scope}): ${e.failure.message}`,
  },

  'build:resume:start': {
    scope: 'session',
    persist: true,
    summary: (e) => `Resuming compiled build for PRD ${e.prdId} on ${e.featureBranch}`,
  },
  'build:resume:state': {
    scope: 'session',
    persist: true,
    summary: (e) =>
      `Resume state seeded: ${e.seededMerged.length} merged, ${e.seededPending.length} pending on ${e.featureBranch}`,
  },
  'build:resume:ineligible': { scope: 'session', persist: true, summary: (e) => `Resume ineligible: ${e.reason}` },
  'build:resume:artifacts': { scope: 'session', persist: true, summary: (e) => `Recovered ${e.plans.length} compiled plan artifact(s) for PRD ${e.prdId}` },
  'build:resume:complete': { scope: 'session', persist: true, summary: (e) => `Build resume complete for PRD ${e.prdId}` },

  'recovery:start': {
    scope: 'session',
    persist: false,
    summary: (e) => `Analysing failed build for PRD ${e.prdId}`,
  },

  'recovery:summary': { scope: 'session', persist: false },

  'recovery:complete': {
    scope: 'session',
    persist: false,
    summary: (e) => `Recovery analysis complete: ${e.verdict.verdict.toUpperCase()}`,
  },

  'recovery:error': {
    scope: 'session',
    persist: false,
    summary: (e) => `Recovery parse failed: ${e.error}`,
  },

  'recovery:apply:start': { scope: 'session', persist: false },

  'recovery:apply:complete': {
    scope: 'session',
    persist: false,
    summary: (e) =>
      e.noAction
        ? 'Recovery verdict is manual — no changes made'
        : `Recovery applied: ${e.verdict.toUpperCase()}`,
  },

  'recovery:apply:error': {
    scope: 'session',
    persist: false,
    summary: (e) => `Recovery apply failed: ${e.message}`,
  },

  // -------------------------------------------------------------------------
  // Daemon run-state upsert
  // -------------------------------------------------------------------------

  /**
   * daemon:run:upsert is the authoritative source of truth for DaemonState.runs.
   * Emitted by the recorder immediately after every insertRun / updateRunStatus /
   * updateRunPlanSet call. The payload is a full RunInfo re-read from the DB,
   * so it is always equivalent to what db.getRuns() would return.
   *
   * Projection: finds the existing run by id and replaces it in-place (preserving
   * startedAt DESC ordering), or prepends the run if it is new.
   */
  'daemon:run:upsert': {
    scope: 'daemon',
    persist: true,
    summary: (e) => `Run ${e.run.id}: ${e.run.command} → ${e.run.status}`,
    project(event, state) {
      const idx = state.runs.findIndex((r) => r.id === event.run.id);
      if (idx !== -1) {
        const updated = [...state.runs];
        updated[idx] = event.run;
        return { runs: updated };
      }
      // Prepend new run — caller has already inserted it into the DB with
      // startedAt set, so it will be first in the startedAt DESC ordering.
      return { runs: [event.run, ...state.runs] };
    },
  },

  // -------------------------------------------------------------------------
  // Daemon internal
  // -------------------------------------------------------------------------

  'daemon:auto-build:paused': {
    scope: 'daemon',
    persist: true,
    summary: (e) => `Auto-build paused: ${e.reason}`,
    project(_event, state) {
      if (!state.autoBuild) return undefined;
      if (!state.autoBuild.enabled && state.autoBuild.desired !== 'enabled') return undefined;
      return {
        autoBuild: {
          ...state.autoBuild,
          enabled: true,
          desired: 'enabled',
          mode: 'paused',
          scheduler: { ...(state.autoBuild.scheduler ?? { alive: false }), paused: true },
        },
      };
    },
  },

  // -------------------------------------------------------------------------
  // Daemon lifecycle
  // -------------------------------------------------------------------------

  'daemon:lifecycle:starting': {
    scope: 'daemon',
    persist: true,
    summary: (e) => `Daemon starting (pid ${e.pid}, port ${e.port})`,
  },

  'daemon:lifecycle:ready': {
    scope: 'daemon',
    persist: true,
    summary: (e) => `Daemon ready (pid ${e.pid}, port ${e.port})`,
  },

  'daemon:lifecycle:shutdown:start': {
    scope: 'daemon',
    persist: true,
    summary: (e) => `Daemon shutting down (${e.signal}: ${e.reason})`,
  },

  'daemon:lifecycle:shutdown:complete': {
    scope: 'daemon',
    persist: true,
    summary: 'Daemon shutdown complete',
  },

  /**
   * daemon:heartbeat is daemon-scoped but LIVE-ONLY: it is pushed directly
   * to SSE subscribers without being persisted to the DB, and must never be
   * replayed from storage. persist: false prevents it from appearing in
   * DAEMON_EVENT_TYPES.
   *
   * In addition to updating `latestHeartbeat`, the projection merges
   * heartbeat auto-build detail fields (scheduler, mode, desired, etc.)
   * into the existing `state.autoBuild` snapshot so the Scheduler FSM card
   * stays current between REST fetches. The merge is additive — watcher
   * and other fields seeded by the initial snapshot are preserved.
   */
  'daemon:heartbeat': {
    scope: 'daemon',
    persist: false,
    project(event, state) {
      const latestHeartbeat = {
        at: Date.now(),
        payload: {
          uptime: event.uptime,
          queueDepth: event.queueDepth,
          runningBuilds: event.runningBuilds,
          autoBuild: event.autoBuild,
          subscribers: event.subscribers,
        },
      };

      // Merge heartbeat auto-build detail fields into state.autoBuild when present.
      if (state.autoBuild) {
        const merged: AutoBuildState = {
          ...state.autoBuild,
          enabled: event.autoBuild.enabled,
          ...(event.autoBuild.desired !== undefined && { desired: event.autoBuild.desired }),
          ...(event.autoBuild.mode !== undefined && { mode: event.autoBuild.mode }),
          ...(event.autoBuild.lastTransition !== undefined && { lastTransition: event.autoBuild.lastTransition }),
          ...(event.autoBuild.reason !== undefined && { reason: event.autoBuild.reason }),
          ...(event.autoBuild.scheduler !== undefined && {
            scheduler: {
              ...(state.autoBuild.scheduler ?? {}),
              ...event.autoBuild.scheduler,
            },
          }),
        };
        return { latestHeartbeat, autoBuild: merged };
      }

      return { latestHeartbeat };
    },
  },

  // -------------------------------------------------------------------------
  // Daemon scheduler
  // -------------------------------------------------------------------------

  'daemon:scheduler:dequeued': {
    scope: 'daemon',
    persist: true,
    summary: (e) => `Dequeued PRD ${e.prdId} (queue depth: ${e.queueDepth})`,
  },

  'daemon:scheduler:capacity-blocked': {
    scope: 'daemon',
    persist: true,
    summary: (e) => `Scheduler capacity blocked (${e.runningCount}/${e.limit} running)`,
  },

  'daemon:scheduler:dependency-blocked': {
    scope: 'daemon',
    persist: true,
    summary: (e) => `PRD ${e.prdId} blocked by: ${e.blockedBy.join(', ')}`,
    project: projectSchedulerDependencyBlocked,
  },

  'daemon:scheduler:paused': {
    scope: 'daemon',
    persist: true,
    summary: () => 'Scheduler paused: new PRD launches suspended',
  },

  'daemon:scheduler:resumed': {
    scope: 'daemon',
    persist: true,
    summary: () => 'Scheduler resumed: PRD launch discovery re-triggered',
  },

  // -------------------------------------------------------------------------
  // Daemon auto-build extensions
  // -------------------------------------------------------------------------

  'daemon:auto-build:enabled': {
    scope: 'daemon',
    persist: true,
    summary: 'Auto-build enabled',
    project(_event, state) {
      if (!state.autoBuild) return undefined;
      if (state.autoBuild.enabled) return undefined;
      return { autoBuild: { ...state.autoBuild, enabled: true } };
    },
  },

  'daemon:auto-build:disabled': {
    scope: 'daemon',
    persist: true,
    summary: 'Auto-build disabled',
    project(_event, state) {
      if (!state.autoBuild) return undefined;
      if (!state.autoBuild.enabled) return undefined;
      return { autoBuild: { ...state.autoBuild, enabled: false } };
    },
  },

  'daemon:auto-build:resumed': {
    scope: 'daemon',
    persist: true,
    summary: 'Auto-build resumed',
    project(_event, state) {
      if (!state.autoBuild) return undefined;
      if (state.autoBuild.enabled) return undefined;
      return { autoBuild: { ...state.autoBuild, enabled: true } };
    },
  },

  'daemon:auto-build:triggered': {
    scope: 'daemon',
    persist: true,
    summary: (e) => `Auto-build triggered: ${e.prdsEnqueued} PRD(s) enqueued`,
  },

  'daemon:auto-build:transition': {
    scope: 'daemon',
    persist: true,
    summary: (e) =>
      `Auto-build ${e.previousMode} → ${e.nextMode} (${e.desired})${e.reason ? `: ${e.reason}` : ''}`,
    project(event, state) {
      if (!state.autoBuild) return undefined;
      const enabled = event.desired === 'enabled';
      return {
        autoBuild: {
          ...state.autoBuild,
          enabled,
          desired: event.desired,
          mode: event.nextMode,
          ...(event.nextMode === 'paused' && {
            scheduler: { ...(state.autoBuild.scheduler ?? { alive: false }), paused: true },
          }),
          lastTransition: {
            at: event.timestamp,
            previousMode: event.previousMode,
            nextMode: event.nextMode,
            desired: event.desired,
            reason: event.reason,
            source: event.source,
          },
          reason: event.reason,
        },
      };
    },
  },

  // -------------------------------------------------------------------------
  // Daemon recovery
  // -------------------------------------------------------------------------

  'daemon:recovery:start': {
    scope: 'daemon',
    persist: true,
    summary: 'Daemon recovery started',
  },

  'daemon:recovery:run-marked-failed': {
    scope: 'daemon',
    persist: true,
    summary: (e) => `Run ${e.runId} marked failed: ${e.reason}`,
  },

  'daemon:recovery:lock-removed': {
    scope: 'daemon',
    persist: true,
    summary: (e) => `Stale lock removed: ${e.path} (pid ${e.pid})`,
  },

  'daemon:recovery:complete': {
    scope: 'daemon',
    persist: true,
    summary: (e) =>
      `Daemon recovery complete: ${e.runsFailed} failed, ${e.locksRemoved} lock(s) removed`,
  },

  // -------------------------------------------------------------------------
  // Daemon orphan reaping
  // -------------------------------------------------------------------------

  'daemon:orphan:reaped': {
    scope: 'daemon',
    persist: true,
    summary: (e) => `Orphaned build reaped: ${e.runId} (pid ${e.pid})`,
  },


  'daemon:failed-enqueue:upsert': { scope: 'daemon', persist: true, summary: (e) => `Failed enqueue ${e.failedEnqueue.runId}: ${e.failedEnqueue.failureReason}`, project(event, state) { const existing = state.failedEnqueues ?? []; const withoutCurrent = existing.filter((item) => item.runId !== event.failedEnqueue.runId); return { failedEnqueues: [event.failedEnqueue, ...withoutCurrent].sort((a, b) => b.failedAt.localeCompare(a.failedAt) || a.runId.localeCompare(b.runId)) }; } },
  'daemon:failed-enqueue:resolved': { scope: 'daemon', persist: true, summary: (e) => `Failed enqueue ${e.runId} resolved${e.spawnedSessionId ? ` as ${e.spawnedSessionId}` : ''}`, project(event, state) { const existing = state.failedEnqueues ?? []; const failedEnqueues = existing.filter((item) => item.runId !== event.runId); if (failedEnqueues.length === existing.length) return undefined; return { failedEnqueues }; } },

  // -------------------------------------------------------------------------
  // Daemon errors and warnings
  // -------------------------------------------------------------------------

  'daemon:warning': {
    scope: 'daemon',
    persist: true,
    summary: (e) => `Daemon warning [${e.source}]: ${e.message}`,
  },

  'daemon:error': {
    scope: 'daemon',
    persist: true,
    summary: (e) => `Daemon error [${e.source}]: ${e.message}`,
  },

  // -------------------------------------------------------------------------
  // Queue events
  // -------------------------------------------------------------------------

  'queue:start': {
    scope: 'daemon',
    persist: true,
    summary: (e) => `PRD queue started: ${e.prdCount} PRD(s) in ${e.dir}`,
  },

  'queue:prd:start': {
    scope: 'daemon',
    persist: true,
    summary: (e) => `Processing PRD: ${e.title} (${e.prdId})`,
    project(event, state) {
      const idx = state.queue.findIndex((item) => item.id === event.prdId);
      if (idx === -1) return undefined;
      const updated = [...state.queue];
      updated[idx] = { ...updated[idx], status: 'running' };
      return { queue: updated };
    },
  },

  'queue:prd:discovered': {
    scope: 'daemon',
    persist: true,
    summary: (e) => `Discovered PRD: ${e.title} (${e.prdId})`,
    project: projectQueuePrdDiscovered,
  },

  'queue:prd:dependency-overridden': {
    scope: 'daemon',
    persist: true,
    summary: (e) => `PRD ${e.prdId} dependency override: removed ${e.removedDependency}`,
    project: projectQueueDependencyOverridden,
  },

  'queue:prd:removed': { scope: 'daemon', persist: true, summary: (e) => `PRD ${e.prdId} removed from queue (was ${e.previousStatus})`, project: (event, state) => state.queue.some((item) => item.id === event.prdId) ? { queue: state.queue.filter((item) => item.id !== event.prdId) } : undefined },

  'queue:prd:stale': {
    scope: 'daemon',
    persist: true,
    summary: (e) => `PRD staleness (${e.prdId}): ${e.verdict} — ${e.justification}`,
    project(event, state) {
      // 'proceed' verdict: queue file remains pending — no state change needed.
      if (event.verdict === 'proceed') return undefined;
      // 'revise' or 'obsolete': file is moved/removed by the engine.
      // Remove the item from the live queue state to match loadQueueItemsSync.
      const filtered = state.queue.filter((item) => item.id !== event.prdId);
      if (filtered.length === state.queue.length) return undefined;
      return { queue: filtered };
    },
  },

  'queue:prd:skip': {
    scope: 'daemon',
    persist: true,
    summary: (e) => `PRD ${e.prdId} skipped: ${e.reason}`,
    project(event, state) {
      const filtered = state.queue.filter((item) => item.id !== event.prdId);
      if (filtered.length === state.queue.length) return undefined;
      return { queue: filtered };
    },
  },

  'queue:prd:dispatch-failed': { scope: 'daemon', persist: true, summary: (e) => `PRD ${e.prdId} dispatch failed (${e.stage}): ${e.reason}`, project: projectQueuePrdDispatchFailed },

  'queue:prd:commit-failed': {
    scope: 'daemon',
    persist: true,
    summary: (e) => `PRD ${e.prdId} commit failed: ${e.error}`,
    project(event, state) {
      const idx = state.queue.findIndex((item) => item.id === event.prdId);
      if (idx === -1) return undefined;
      const updated = [...state.queue];
      updated[idx] = normalizeTerminalQueueItem(updated[idx], 'failed');
      return { queue: updated };
    },
  },

  'queue:prd:complete': {
    scope: 'daemon',
    persist: true,
    summary: (e) => `PRD ${e.prdId} complete: ${e.status}`,
    project(event, state) {
      const idx = state.queue.findIndex((item) => item.id === event.prdId);
      if (idx === -1) return undefined;
      if (event.status === 'failed') {
        const updated = [...state.queue];
        updated[idx] = normalizeTerminalQueueItem(updated[idx], 'failed');
        return { queue: updated };
      }
      return { queue: state.queue.filter((item) => item.id !== event.prdId) };
    },
  },

  'queue:complete': {
    scope: 'daemon',
    persist: true,
    summary: (e) => `Queue complete: ${e.processed} processed, ${e.skipped} skipped`,
    project(_event, state) {
      const failed = state.queue.filter((item) => item.status === 'failed').map((item) => normalizeTerminalQueueItem(item, 'failed'));
      if (failed.length === state.queue.length && failed.every((item, idx) => item === state.queue[idx])) return undefined;
      return { queue: failed };
    },
  },

  // Stack sync lifecycle events are daemon-scoped and persisted so they appear
  // in the activity feed and can be correlated with other daemon events. The
  // project function returns undefined because stack sync status is loaded from
  // disk (sync-status.json) at snapshot time — no in-memory projection needed.

  'stack:sync:start': {
    scope: 'daemon',
    persist: true,
    summary: (e) =>
      e.trigger
        ? `Stack sync started (${e.trigger}, syncId: ${e.syncId})`
        : `Stack sync started (syncId: ${e.syncId})`,
  },

  'stack:sync:complete': {
    scope: 'daemon',
    persist: true,
    summary: (e) =>
      e.restackCandidates.length > 0
        ? `Stack sync complete: ${e.restackCandidates.length} branch(es) restacked`
        : `Stack sync complete (syncId: ${e.syncId})`,
  },

  'stack:sync:failed': {
    scope: 'daemon',
    persist: true,
    summary: (e) => `Stack sync ${e.outcome}: ${e.reason}`,
  },

  'stack:sync:deferred': {
    scope: 'daemon',
    persist: true,
    summary: (e) => `Stack sync deferred: ${e.reason}`,
  },

  'stack:sync:skipped': {
    scope: 'daemon',
    persist: true,
    summary: (e) => `Stack sync skipped: ${e.reason}`,
  },
} satisfies EventRegistryShape;

// ---------------------------------------------------------------------------
// Compile-time exhaustiveness check
// ---------------------------------------------------------------------------

/**
 * Verifies every EforgeEvent['type'] has an entry in the registry.
 * TypeScript will produce a type error on the assignment below if any type
 * is missing or misspelled — fix it by adding the missing entry.
 */
type _MissingTypes = Exclude<EforgeEvent['type'], keyof typeof eventRegistry>;
type _Exhaustive = [_MissingTypes] extends [never]
  ? true
  : { error: 'Not all EforgeEvent types are registered in event-registry.ts'; missing: _MissingTypes };
const _exhaustiveCheck: _Exhaustive = true;
void _exhaustiveCheck;

// ---------------------------------------------------------------------------
// DAEMON_EVENT_TYPES: derived from daemon-scoped entries with persist:true
// ---------------------------------------------------------------------------

/**
 * Allowlist of daemon-owned event types persisted to the DB and surfaced via
 * GET /api/daemon-events. Derived from registry entries with scope:'daemon'
 * and persist:true.
 *
 * Note: daemon:heartbeat is intentionally absent — it is LIVE-ONLY, pushed
 * directly to SSE subscribers without being persisted to the DB, and must
 * never be replayed from storage (persist:false in the registry). Session-
 * scoped persisted events are also absent because they belong to per-session
 * event history, not daemon-wide event queries.
 */
export const DAEMON_EVENT_TYPES: readonly string[] = (
  Object.keys(eventRegistry) as Array<EforgeEvent['type']>
).filter((type) => {
  const meta = eventRegistry[type] as EventMeta<typeof type>;
  return meta.scope === 'daemon' && meta.persist;
});

/**
 * Returns true when `type` is an event type that is persisted to the DB and
 * replayed via GET /api/daemon-events. Backed by `DAEMON_EVENT_TYPES`.
 *
 * Use this predicate in the recorder and daemon write paths to decide whether
 * an event should be stored as a daemon-owned row (no run correlation).
 *
 * Intentionally excludes `daemon:heartbeat` (persist:false, LIVE-ONLY) so it
 * is never stored and never replayed from storage.
 */
export function isPersistedDaemonEventType(type: string): type is EforgeEvent['type'] {
  return DAEMON_EVENT_TYPES.includes(type);
}

// ---------------------------------------------------------------------------
// Public exports
// ---------------------------------------------------------------------------

export { eventRegistry };
export type { EventRegistryShape };

/**
 * Compute the human-readable summary for an event using the registry.
 * Returns undefined when no summary is defined for the event type.
 */
export function getEventSummary(event: EforgeEvent): string | undefined {
  const meta = (eventRegistry as Record<string, EventMeta<EforgeEvent['type']>>)[event.type];
  if (!meta?.summary) return undefined;
  if (typeof meta.summary === 'string') return meta.summary;
  return (meta.summary as (e: EforgeEvent) => string | undefined)(event) ?? undefined;
}
