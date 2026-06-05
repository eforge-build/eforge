/**
 * Pure selector functions and dashboard view model types for the Now dashboard.
 *
 * No React imports. No DOM imports.
 * Imports wire types from @eforge-build/client/browser or src/lib/types only.
 * Does not redeclare QueueItem, RunInfo, SessionMetadata, AutoBuildState,
 * or StackLayerWire.
 */

import type {
  RunInfo, EforgeEvent,
  ExtensionEntry, ExtensionTrustState,
} from '@eforge-build/client/browser';
import { getEventSummary, isTransientTransportError } from '@eforge-build/client/browser';
import type { ConsoleProjectState } from '@/lib/project-state';
import type { ActiveSessionDetail } from '@/hooks/use-active-session-streams';
import type { ConnectionStatus, ConsoleActivityEntry } from '@/lib/types';
import { isTerminalStatus } from '@/lib/selectors/active-builds';
import { toConsolePath } from '@/lib/navigation';
import { selectPrdDisplayLabel } from '@/lib/selectors/labels';
import { selectPlanStatusCounts, getSummaryStats, selectMiniGanttRows, selectPlanLanes, selectPlanningLane } from '@/lib/run-state';
import type { RunState, PlanStatusCounts, MiniGanttRow, PlanLane, PlanningLane } from '@/lib/run-state';
import { queueItemLabelById, selectNowQueueStacks } from './queue-stacks';
import type { NowQueueStack } from './queue-stacks';
import { selectNowQueueSummary } from './queue-summary';
import type { NowQueueSummary } from './queue-summary';
import { extensionNeedsTrust, extensionTrustActionLabel } from './system';

export { selectNowQueueSummary } from './queue-summary';
export type { NowQueueItem, NowQueueSummary } from './queue-summary';
export { selectNowQueueStacks } from './queue-stacks';
export type { NowQueueStack, NowQueueStackItem } from './queue-stacks';
import { selectNowMetricsPanel } from './metrics';
import type { NowMetricsPanel } from './metrics';
export { selectNowMetricsPanel } from './metrics';
export type { NowMetricsPanel } from './metrics';
import { selectAllNowRunItems, selectAllNowBuildItems } from './build-history';
import type { NowRecentRunItem, NowBuildItem } from './build-history';
export { selectAllNowRunItems, selectAllNowBuildItems, classifyBuildStatus } from './build-history';
export type { NowRecentRunItem, NowBuildItem, BuildStatusClass } from './build-history';
import { selectNowEnqueueCards, ENQUEUE_COMMAND } from './enqueue-cards';
import type { NowEnqueueCard } from './enqueue-cards';
export { selectNowEnqueueCards } from './enqueue-cards';
export type { NowEnqueueCard } from './enqueue-cards';

// ---------------------------------------------------------------------------
// View model types
// ---------------------------------------------------------------------------

export type NowBannerKind = 'connecting' | 'disconnected' | 'stale' | 'partial-data';

export interface NowBanner {
  kind: NowBannerKind;
  message: string;
}

export type NowAttentionSeverity = 'critical' | 'warning' | 'info';

export interface NowAttentionItem {
  id: string;
  severity: NowAttentionSeverity;
  message: string;
  detail?: string;
  /**
   * Present on actionable failed-PRD items. Carries everything the host needs to
   * open the recovery dialog, so the attention strip — not the Queue card — owns
   * the Recover action for failures.
   */
  recovery?: {
    prdId: string;
    prdTitle: string;
    verdict?: string;
    confidence?: string;
  };
  /** Trust action payload for an extension-trust attention item (Now strip owns Trust/Re-trust). */
  extensionTrust?: { name: string; path: string; trustState?: ExtensionTrustState; actionLabel: 'Trust' | 'Re-trust' };
}

export type NowBuildLifecyclePhase =
  | 'prd'
  | 'plans'
  | 'prd-validation'
  | 'gap-close'
  | 'final-validation'
  | 'landing'
  | 'idle';

export interface NowBuildLifecycle {
  phase: NowBuildLifecyclePhase;
  prdValidationComplete: boolean;
  gapCloseComplete: boolean;
  finalValidationComplete: boolean;
  gapCloseObserved: boolean;
}

export interface NowActiveBuildCard {
  sessionId: string;
  runId: string;
  planSet: string;
  command: string;
  status: string;
  startedAt: string;
  durationMs: number;
  cwd: string;
  profile: string | null;
  planCount: number | null;
  streamStatus: ConnectionStatus | 'connecting';
  currentPhase: string | null;
  latestAgent: string | null;
  latestProgress: string | null;
  /**
   * Terminal build failure message (from `plan:build:failed`), or null. Drives
   * the card's hard error styling. Transient backend-transport hiccups are NOT
   * reported here — see `transientNotice`.
   */
  latestError: string | null;
  /**
   * Soft, recoverable notice for an in-flight transient backend-transport retry
   * (e.g. a provider websocket dropped and the agent is reconnecting). Rendered
   * as a non-alarming chip; the build is still considered live. Null when the
   * build is progressing normally or has already recovered.
   */
  transientNotice: string | null;
  /** High-level build lifecycle derived from plan, PRD validation, and gap-close events. */
  lifecycle: NowBuildLifecycle;
  /** Plan status counts derived from reduced RunState. */
  planProgress: PlanStatusCounts;
  /** Total input tokens accumulated across all agent:result events (including live overlay). */
  tokens: number;
  /** Total cost in USD accumulated across all agent:result events (including live overlay). */
  cost: number;
  /** Cache hit percentage: cacheRead / tokensIn * 100, or 0 when no input usage. */
  cachePercent: number;
  href: string;
  /** Mini-Gantt rows derived from RunState for the pipeline strip. */
  miniGanttRows: MiniGanttRow[];
  /** Per-plan lanes (stage track + live agents) for the mini swimlane. */
  planLanes: PlanLane[];
  /** Planning-phase lane summary (global planner/plan-reviewer agents). */
  planning: PlanningLane;
  /** True when planning events exist in the run state (shows PRD row in pipeline strip). */
  hasPlanningRow: boolean;
}

export interface NowActivityPreviewItem {
  id: string;
  eventType: string;
  summary: string;
  receivedAt: number;
}

export interface NowStackSyncViewModel {
  lastOutcome: 'complete' | 'failed' | 'conflict' | 'deferred' | 'skipped' | null;
  lastTrigger: 'manual' | 'after-build' | 'scheduled' | 'retry-deferred' | null;
  lastCompletedAt: string | null;
  lastStartedAt: string | null;
  lastReason: string | null;
  lastError: string | null;
  lastDryRun: boolean;
  lastRestackCandidateCount: number;
  lastActiveBuildSkips: Array<{ branch: string; worktree?: string; reason: string }>;
  lastProviderCommands: Array<{
    command: string;
    args: string[];
    dryRun: boolean;
    ran: boolean;
    stdout?: string;
    stderr?: string;
    exitCode?: number;
  }>;
  inProgress: boolean;
}

export interface NowStatusSummary {
  connectionStatus: ConnectionStatus;
  isConnected: boolean;
  autoBuildEnabled: boolean | null;
  autoBuildMode: string | null;
  autoBuildDesired: string | null;
  schedulerRunningCount: number | null;
  schedulerLimit: number | null;
  queueDepth: number;
  activeBuildCount: number;
  runningBuilds: number | null;
  subscribers: number | null;
  uptimeMs: number | null;
  lastUpdateMsAgo: number | null;
}

export interface NowDashboardModel {
  connectionBanner: NowBanner | null;
  status: NowStatusSummary;
  attention: NowAttentionItem[];
  attentionHiddenCount: number;
  activeBuilds: NowActiveBuildCard[];
  /** Pre-build PRD formatting/validation runs, shown above active builds. */
  enqueueCards: NowEnqueueCard[];
  queue: NowQueueSummary;
  queueStacks: NowQueueStack[];
  recentRuns: NowRecentRunItem[];
  /** Per-build rollup (one row per session), newest first, for Build history. */
  builds: NowBuildItem[];
  stackSync: NowStackSyncViewModel | null;
  activity: NowActivityPreviewItem[];
  activityHiddenCount: number;
  /** At-a-glance build-health visuals from build run history. */
  metrics: NowMetricsPanel;
  hasSnapshot: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STALE_THRESHOLD_MS = 30_000;
const MAX_ATTENTION_ITEMS = 5;
const MAX_RECENT_RUNS = 4;
const MAX_ACTIVITY_ROWS = 6;

// ---------------------------------------------------------------------------
// Attention severity merge helpers
// ---------------------------------------------------------------------------

const SEVERITY_ORDER: Record<NowAttentionSeverity, number> = {
  critical: 3,
  warning: 2,
  info: 1,
};

/** Return the more-severe of two attention severities. */
export function mergeSeverity(
  a: NowAttentionSeverity,
  b: NowAttentionSeverity,
): NowAttentionSeverity {
  return SEVERITY_ORDER[a] >= SEVERITY_ORDER[b] ? a : b;
}

/** Stable normalized PRD key for deduplicating slug/title variants. */
function normalizePrdDedupKey(slug: string): string {
  if (!slug) return '';
  const trimmed = slug.trim();
  const withoutTimestamp = trimmed.replace(/^\d{4}[-_]\d{2}[-_]\d{2}[-_]|^\d{8}[-_]/, '');
  const withoutExtension = withoutTimestamp.replace(/\.(md|txt|yaml|yml|json)$/i, '');
  return withoutExtension
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

type QueueRecoveryApplied = NonNullable<ConsoleProjectState['queue'][number]['recoveryApplied']>;

// --- eforge:region plan-02-console-resolved-status ---
function isAcceptedSuccessComplete(item: { recoveryApplied?: QueueRecoveryApplied }): boolean {
  return item.recoveryApplied?.action === 'accepted-success' && item.recoveryApplied.landing.status === 'complete';
}
function formatAppliedRecoveryDetail(applied: QueueRecoveryApplied): string {
  if (applied.action === 'split') return `recovery applied: split → ${applied.successorPrdId}`;
  if (applied.action !== 'accepted-success') return `recovery applied: ${applied.action}`;
  const reason = applied.landing.reason?.trim();
  return `recovery applied: accepted-success landing ${applied.landing.status}${reason ? ` — ${reason}` : ''}`;
}
// --- eforge:endregion plan-02-console-resolved-status ---

interface AttentionCandidate {
  item: NowAttentionItem;
  dedupKey: string;
}

export function isLivenessStale(
  state: Pick<ConsoleProjectState, 'lastEventAt' | 'lastSnapshotAt' | 'latestHeartbeat' | 'liveness'>,
  now: number = Date.now(),
): boolean {
  const candidates: number[] = [];
  if (state.lastEventAt != null) candidates.push(state.lastEventAt);
  if (state.lastSnapshotAt != null) candidates.push(state.lastSnapshotAt);
  if (state.latestHeartbeat?.at != null) candidates.push(state.latestHeartbeat.at);
  if (state.liveness?.timestamp != null) {
    try {
      const ts = new Date(state.liveness.timestamp).getTime();
      if (!isNaN(ts)) candidates.push(ts);
    } catch {
      // ignore
    }
  }
  if (candidates.length === 0) return false;
  const latest = Math.max(...candidates);
  return now - latest > STALE_THRESHOLD_MS;
}

// ---------------------------------------------------------------------------
// Attention items selector
// ---------------------------------------------------------------------------

export function selectNowAttentionItems(
  state: Pick<
    ConsoleProjectState,
    'connectionStatus' | 'error' | 'queue' | 'runs' | 'lastEventAt' | 'lastSnapshotAt' | 'latestHeartbeat' | 'liveness'
  >,
  activeDetails: Record<string, ActiveSessionDetail>,
  now: number = Date.now(),
  /** Project-team extension entries (REST-loaded on Now); untrusted/changed surface as trust warnings. */
  extensions: ExtensionEntry[] = [],
  /** Keep predicate run on deduped candidates BEFORE the cap (excluded items never displace kept ones; hiddenCount stays accurate). */ keep: (i: NowAttentionItem) => boolean = () => true,
): { items: NowAttentionItem[]; hiddenCount: number } {
  const candidates: AttentionCandidate[] = [];

  // 1. Stream disconnected/error
  if (state.connectionStatus === 'disconnected' && state.error) {
    candidates.push({
      item: {
        id: 'stream-error',
        severity: 'critical',
        message: 'Daemon stream disconnected',
        detail: state.error,
      },
      dedupKey: 'system:stream-error',
    });
  }

  // 2. Stale heartbeat (only when connected)
  if (state.connectionStatus === 'connected' && isLivenessStale(state, now)) {
    const msAgo = now - (state.latestHeartbeat?.at ?? state.lastSnapshotAt ?? 0);
    const secs = Math.round(msAgo / 1_000);
    candidates.push({
      item: {
        id: 'stale-heartbeat',
        severity: 'warning',
        message: `No daemon heartbeat in ${secs}s`,
      },
      dedupKey: 'system:stale-heartbeat',
    });
  }

  // 3. Active session stream errors
  for (const detail of Object.values(activeDetails)) {
    if (detail.error) {
      candidates.push({
        item: {
          id: `session-error-${detail.sessionId}`,
          severity: 'warning',
          message: `Session stream error: ${detail.sessionId}`,
          detail: detail.error,
        },
        dedupKey: `session:${detail.sessionId}`,
      });
    }
  }

  // 4. Failed queue items with recovery verdict
  const failedWithVerdict = state.queue.filter(
    (q) => q.status.toLowerCase() === 'failed' && q.recoveryVerdict != null && !isAcceptedSuccessComplete(q),
  );
  for (const item of failedWithVerdict) {
    const rv = item.recoveryVerdict!;
    const label = selectPrdDisplayLabel(item.title, item.id);
    candidates.push({
      item: {
        id: `queue-failed-verdict-${item.id}`,
        severity: 'warning',
        message: `Failed: ${label}`,
        detail: item.recoveryApplied ? formatAppliedRecoveryDetail(item.recoveryApplied) : `${rv.verdict} / ${rv.confidence}`,
        ...(item.recoveryApplied ? {} : { recovery: { prdId: item.id, prdTitle: label, verdict: rv.verdict, confidence: rv.confidence } }),
      },
      dedupKey: `prd:${normalizePrdDedupKey(item.id)}`,
    });
  }

  // 5. Failed queue items without recovery verdict
  const failedWithoutVerdict = state.queue.filter(
    (q) => q.status.toLowerCase() === 'failed' && q.recoveryVerdict == null && !isAcceptedSuccessComplete(q),
  );
  for (const item of failedWithoutVerdict) {
    const label = selectPrdDisplayLabel(item.title, item.id);
    candidates.push({
      item: {
        id: `queue-failed-${item.id}`,
        severity: 'warning',
        message: `Failed: ${label}`,
        detail: item.recoveryApplied ? formatAppliedRecoveryDetail(item.recoveryApplied) : 'recovery pending',
        ...(item.recoveryApplied ? {} : { recovery: { prdId: item.id, prdTitle: label } }),
      },
      dedupKey: `prd:${normalizePrdDedupKey(item.id)}`,
    });
  }

  // 6. Skipped queue items need attention after terminal upstream cascades.
  const skippedItems = state.queue.filter((q) => q.status.toLowerCase() === 'skipped');
  for (const item of skippedItems) {
    const label = selectPrdDisplayLabel(item.title, item.id);
    candidates.push({
      item: {
        id: `queue-skipped-${item.id}`,
        severity: 'warning',
        message: `Skipped: ${label}`,
        detail: 'blocked by failed upstream cascade',
      },
      dedupKey: `prd:${normalizePrdDedupKey(item.id)}`,
    });
  }

  // 7. Queue items blocked by dependencies.  Collapse dependency-linked
  // stacks into one attention item so a three-plan stack reads as one system
  // state instead of several repetitive "waiting" rows.
  const queueStacks = selectNowQueueStacks(state.queue);
  const queueById = new Map(state.queue.map((q) => [q.id, q]));
  const stackedBlockedIds = new Set<string>();
  for (const stack of queueStacks) {
    const blockedCount = stack.items.filter(
      (item) => item.blockedBy.length > 0 && item.status.toLowerCase() !== 'running',
    ).length;
    if (blockedCount === 0) continue;
    for (const item of stack.items) stackedBlockedIds.add(item.id);
    const active = stack.items.find((item) => item.status.toLowerCase() === 'running') ?? stack.items[0];
    candidates.push({
      item: {
        id: `queue-stack-blocked-${stack.id}`,
        severity: 'info',
        message: `Build stack blocked behind ${active.title}`,
        detail: `${blockedCount} waiting plan${blockedCount !== 1 ? 's' : ''} across ${stack.totalItems} stacked plan${stack.totalItems !== 1 ? 's' : ''}`,
      },
      dedupKey: `queue-stack:${stack.id}`,
    });
  }

  const blocked = state.queue.filter((q) => {
    const status = q.status.toLowerCase();
    return q.dependsOn
      && q.dependsOn.length > 0
      && status !== 'failed'
      && status !== 'skipped'
      && status !== 'running'
      && !stackedBlockedIds.has(q.id);
  });
  for (const item of blocked) {
    const label = selectPrdDisplayLabel(item.title, item.id);
    const blockedBy = item.dependsOn!.map((depId) => queueItemLabelById(queueById, depId)).join(', ');
    candidates.push({
      item: {
        id: `queue-blocked-${item.id}`,
        severity: 'info',
        message: `Waiting on dependencies: ${label}`,
        detail: `blocked by ${blockedBy}`,
      },
      dedupKey: `prd:${normalizePrdDedupKey(item.id)}`,
    });
  }

  // 8. Project-team extensions needing trust. Reuses the System trust-needed
  // definition (extensionNeedsTrust) so System rows and Now alerts agree; the
  // strip owns Trust/Re-trust directly.
  for (const ext of extensions.filter(extensionNeedsTrust)) {
    const changed = ext.trustState === 'changed';
    candidates.push({
      item: {
        id: `extension-trust-${ext.path}`,
        severity: 'warning',
        message: `${changed ? 'Extension changed since trusted' : 'Untrusted extension'}: ${ext.name}`,
        detail: changed ? 'Re-trust to apply the updated project-team extension' : 'Trust this project-team extension to enable it',
        extensionTrust: { name: ext.name, path: ext.path, trustState: ext.trustState, actionLabel: extensionTrustActionLabel(ext) },
      },
      dedupKey: `extension-trust:${ext.path}`,
    });
  }

  // Deduplicate by dedupKey; when two candidates share a key the worst
  // severity wins (critical > warning > info). The first candidate's
  // message/detail is kept since it tends to carry the most context.
  const seen = new Map<string, NowAttentionItem>();
  for (const { item, dedupKey } of candidates) {
    const existing = seen.get(dedupKey);
    if (existing) {
      existing.severity = mergeSeverity(existing.severity, item.severity);
    } else {
      seen.set(dedupKey, { ...item });
    }
  }

  const deduped = Array.from(seen.values()).filter(keep);
  const items = deduped.slice(0, MAX_ATTENTION_ITEMS);
  const hiddenCount = Math.max(0, deduped.length - MAX_ATTENTION_ITEMS);
  return { items, hiddenCount };
}

// ---------------------------------------------------------------------------
// Active build cards selector
// ---------------------------------------------------------------------------

const EMPTY_PLAN_PROGRESS: PlanStatusCounts = { pending: 0, running: 0, complete: 0, failed: 0, total: 0 };
const EMPTY_PLANNING_LANE: PlanningLane = { agents: [], running: false };

function extractCurrentPhaseFromRunState(runState: RunState): string | null {
  for (let i = runState.events.length - 1; i >= 0; i--) {
    const e = runState.events[i].event;
    if (e.type === 'phase:start') {
      const pe = e as Extract<EforgeEvent, { type: 'phase:start' }>;
      return `${selectPrdDisplayLabel(undefined, pe.planSet)} / ${pe.command}`;
    }
    if (e.type === 'phase:end') {
      return null;
    }
  }
  return null;
}

function extractLatestAgentFromRunState(runState: RunState): string | null {
  // Prefer the last in-flight agent thread (no endedAt)
  for (let i = runState.agentThreads.length - 1; i >= 0; i--) {
    const thread = runState.agentThreads[i];
    if (!thread.endedAt) return thread.agent;
  }
  // Fall back to the last thread overall
  if (runState.agentThreads.length > 0) {
    return runState.agentThreads[runState.agentThreads.length - 1].agent;
  }
  return null;
}

function extractLatestProgressFromRunState(runState: RunState): string | null {
  for (let i = runState.events.length - 1; i >= 0; i--) {
    const e = runState.events[i].event;
    if (e.type === 'plan:build:progress') {
      const pe = e as Extract<EforgeEvent, { type: 'plan:build:progress' }>;
      return pe.message;
    }
  }
  return null;
}

/**
 * Terminal build failure, if any. Only a `plan:build:failed` event counts as a
 * hard error here. Trailing `agent:stop` errors are deliberately ignored: a
 * single agent hiccup (especially a transient backend-transport drop the engine
 * retries) is not a build failure, and surfacing it as one made recovered,
 * still-running builds look dead. Console-to-daemon stream disconnects are
 * surfaced through `streamStatus`, not here.
 */
function extractTerminalErrorFromRunState(runState: RunState): string | null {
  for (let i = runState.events.length - 1; i >= 0; i--) {
    const e = runState.events[i].event;
    if (e.type === 'plan:build:failed') {
      const pe = e as Extract<EforgeEvent, { type: 'plan:build:failed' }>;
      return pe.error;
    }
  }
  return null;
}

/**
 * Soft notice for an in-flight transient backend-transport retry. Decided by
 * the most recent *lifecycle-relevant* event: a transient-transport retry or an
 * agent stop carrying a transient-transport error means a reconnect is underway;
 * any later success/progress signal means the build already recovered and no
 * notice is shown.
 */
function extractTransientNotice(runState: RunState): string | null {
  for (let i = runState.events.length - 1; i >= 0; i--) {
    const e = runState.events[i].event;
    switch (e.type) {
      case 'agent:retry': {
        const re = e as Extract<EforgeEvent, { type: 'agent:retry' }>;
        if (re.subtype !== 'error_transient_transport') return null;
        return `Transport interrupted — retrying (attempt ${re.attempt}/${re.maxAttempts})`;
      }
      case 'agent:stop': {
        const ae = e as Extract<EforgeEvent, { type: 'agent:stop' }>;
        if (ae.error && isTransientTransportError(ae.error)) {
          return 'Transport interrupted — reconnecting';
        }
        return null;
      }
      // Any of these later than the hiccup means the build moved on.
      case 'agent:result':
      case 'plan:build:failed':
      case 'plan:build:progress':
        return null;
      // NOTE: `agent:start` is intentionally NOT a recovery terminator. The
      // retry sequence is `agent:stop` -> `agent:retry` -> `agent:start` ->
      // `result`/`progress`. The build is still mid-reconnect until the new
      // attempt produces forward progress, so the notice should persist across
      // `agent:start`. Do not add it here to "clear faster" — that breaks the
      // intended reconnecting/retrying UX.
      default:
        break;
    }
  }
  return null;
}

const EMPTY_LIFECYCLE: NowBuildLifecycle = {
  phase: 'idle',
  prdValidationComplete: false,
  gapCloseComplete: false,
  finalValidationComplete: false,
  gapCloseObserved: false,
};

function extractBuildLifecycle(runState: RunState): NowBuildLifecycle {
  let phase: NowBuildLifecyclePhase = 'idle';
  let prdValidationComplete = false;
  let gapCloseComplete = false;
  let finalValidationComplete = false;
  let gapCloseObserved = false;
  let afterGapClose = false;

  if (runState.earlyOrchestration || runState.events.some((e) => e.event.type.startsWith('planning:'))) {
    phase = 'prd';
  }

  if (Object.keys(runState.planStatuses).length > 0) {
    phase = 'plans';
  }

  for (const { event } of runState.events) {
    switch (event.type) {
      case 'prd_validation:start':
        phase = afterGapClose ? 'final-validation' : 'prd-validation';
        break;
      case 'prd_validation:complete':
        if (afterGapClose) {
          finalValidationComplete = true;
          phase = 'landing';
        } else {
          prdValidationComplete = true;
          phase = 'prd-validation';
        }
        break;
      case 'gap_close:start':
      case 'gap_close:plan_ready':
        gapCloseObserved = true;
        phase = 'gap-close';
        break;
      case 'gap_close:complete':
        gapCloseObserved = true;
        gapCloseComplete = true;
        afterGapClose = true;
        phase = 'final-validation';
        break;
      default:
        break;
    }
  }

  return {
    phase,
    prdValidationComplete,
    gapCloseComplete,
    finalValidationComplete,
    gapCloseObserved,
  };
}

export function selectNowActiveBuildCards(
  runs: RunInfo[],
  sessionMetadata: Record<string, { planCount: number | null; baseProfile: string | null }>,
  activeDetails: Record<string, ActiveSessionDetail>,
  now: number = Date.now(),
  /**
   * Optional map from PRD/plan-set id to its human-authored title, sourced from
   * the queue. When the running build's `planSet` slug resolves to a queue
   * item, its title is used so the card label matches Attention/Queue labeling
   * instead of a naively title-cased slug.
   */
  titleByPlanSet: Map<string, string> = new Map(),
): NowActiveBuildCard[] {
  // Filter to active *build* runs (no completedAt, non-terminal status). Enqueue
  // runs share a session with the build that follows but are pre-build PRD
  // formatting, not a build — they get their own lighter card via
  // selectNowEnqueueCards, so exclude them here.
  const activeRuns = runs.filter(
    (r) => !r.completedAt && r.sessionId && !isTerminalStatus(r.status) && r.command !== ENQUEUE_COMMAND,
  );

  // Group by sessionId, picking newest startedAt per session
  const bySession = new Map<string, RunInfo>();
  for (const run of activeRuns) {
    const sid = run.sessionId!;
    const existing = bySession.get(sid);
    if (!existing || run.startedAt > existing.startedAt) {
      bySession.set(sid, run);
    }
  }

  // Build cards, sorted newest session first
  const entries = Array.from(bySession.entries()).sort(([, a], [, b]) => {
    if (a.startedAt > b.startedAt) return -1;
    if (a.startedAt < b.startedAt) return 1;
    return 0;
  });

  return entries.map(([sessionId, run]) => {
    const meta = sessionMetadata[sessionId];
    const detail = activeDetails[sessionId];

    const startMs = new Date(run.startedAt).getTime();
    const durationMs = isNaN(startMs) ? 0 : now - startMs;

    let streamStatus: NowActiveBuildCard['streamStatus'] = 'connecting';
    let currentPhase: string | null = null;
    let latestAgent: string | null = null;
    let latestProgress: string | null = null;
    let latestError: string | null = null;
    let transientNotice: string | null = null;
    let lifecycle: NowBuildLifecycle = EMPTY_LIFECYCLE;
    let planProgress: PlanStatusCounts = EMPTY_PLAN_PROGRESS;
    let tokens = 0;
    let cost = 0;
    let cachePercent = 0;
    let miniGanttRows: MiniGanttRow[] = [];
    let planLanes: PlanLane[] = [];
    let planning: PlanningLane = EMPTY_PLANNING_LANE;
    let hasPlanningRow = false;

    if (detail) {
      streamStatus = detail.connectionStatus;
      const rs = detail.runState;
      currentPhase = extractCurrentPhaseFromRunState(rs);
      latestAgent = extractLatestAgentFromRunState(rs);
      latestProgress = extractLatestProgressFromRunState(rs);
      latestError = extractTerminalErrorFromRunState(rs);
      transientNotice = latestError ? null : extractTransientNotice(rs);
      lifecycle = extractBuildLifecycle(rs);
      planProgress = selectPlanStatusCounts(rs);
      const stats = getSummaryStats(rs);
      tokens = stats.tokensIn;
      cost = stats.totalCost;
      cachePercent = stats.tokensIn > 0 ? (stats.cacheRead / stats.tokensIn) * 100 : 0;
      miniGanttRows = selectMiniGanttRows(rs);
      planLanes = selectPlanLanes(rs);
      planning = selectPlanningLane(rs);
      hasPlanningRow =
        rs.earlyOrchestration != null ||
        rs.events.some((e) => e.event.type.startsWith('planning:'));
    }

    return {
      sessionId,
      runId: run.id,
      planSet: selectPrdDisplayLabel(titleByPlanSet.get(run.planSet), run.planSet),
      command: run.command,
      status: run.status,
      startedAt: run.startedAt,
      durationMs,
      cwd: run.cwd,
      profile: meta?.baseProfile ?? null,
      planCount: meta?.planCount ?? null,
      streamStatus,
      currentPhase,
      latestAgent,
      latestProgress,
      latestError,
      transientNotice,
      lifecycle,
      planProgress,
      tokens,
      cost,
      cachePercent,
      href: toConsolePath({ id: 'buildDetail', detailId: sessionId }),
      miniGanttRows,
      planLanes,
      planning,
      hasPlanningRow,
    };
  });
}

// ---------------------------------------------------------------------------
// Status summary selector
// ---------------------------------------------------------------------------

export function selectNowStatusSummary(
  state: Pick<
    ConsoleProjectState,
    | 'connectionStatus'
    | 'autoBuild'
    | 'liveness'
    | 'latestHeartbeat'
    | 'queue'
    | 'runs'
    | 'lastEventAt'
    | 'lastSnapshotAt'
  >,
  activeDetails: Record<string, ActiveSessionDetail>,
  now: number = Date.now(),
): NowStatusSummary {
  const hb = state.latestHeartbeat;
  const ab = state.autoBuild;

  // Determine queue depth: prefer heartbeat, fallback to queue array
  const queueDepth = hb?.payload.queueDepth ?? state.queue.length;

  // Active build count from active cards
  const activeRuns = state.runs.filter(
    (r) => !r.completedAt && r.sessionId && !isTerminalStatus(r.status),
  );
  const activeBuildCount = new Set(activeRuns.map((r) => r.sessionId)).size;

  // Running builds from heartbeat
  const runningBuilds = hb?.payload.runningBuilds ?? null;

  // Scheduler info
  const scheduler = hb?.payload.autoBuild?.scheduler ?? ab?.scheduler ?? null;
  const schedulerRunningCount = scheduler?.runningCount ?? null;
  const schedulerLimit = scheduler?.limit ?? null;

  // Auto-build
  const autoBuildEnabled = ab != null ? ab.enabled : null;
  const autoBuildMode = ab?.mode ?? null;
  const autoBuildDesired = ab?.desired ?? null;

  // Subscribers and uptime
  // The monitor server emits uptime as milliseconds (Date.now() - instanceStartedAt).
  const subscribers = hb?.payload.subscribers ?? state.liveness?.subscribers ?? null;
  const uptimeMs = hb?.payload.uptime ?? state.liveness?.uptime ?? null;

  // Last update — use the newest non-null timestamp across event and snapshot
  const lastUpdateTs =
    state.lastEventAt != null || state.lastSnapshotAt != null
      ? Math.max(state.lastEventAt ?? 0, state.lastSnapshotAt ?? 0)
      : null;
  const lastUpdateMsAgo = lastUpdateTs != null ? now - lastUpdateTs : null;

  return {
    connectionStatus: state.connectionStatus,
    isConnected: state.connectionStatus === 'connected',
    autoBuildEnabled,
    autoBuildMode,
    autoBuildDesired,
    schedulerRunningCount,
    schedulerLimit,
    queueDepth,
    activeBuildCount,
    runningBuilds,
    subscribers,
    uptimeMs,
    lastUpdateMsAgo,
  };
}

// ---------------------------------------------------------------------------
// Recent activity selector
// ---------------------------------------------------------------------------

export function selectNowRecentActivity(
  recentActivity: ConsoleActivityEntry[],
): { items: NowActivityPreviewItem[]; hiddenCount: number } {
  // Filter out heartbeat events
  const filtered = recentActivity.filter((a) => a.event.type !== 'daemon:heartbeat');

  // Sort newest first (by id numeric sort, then receivedAt)
  const sorted = [...filtered].sort((a, b) => {
    // Try numeric id comparison
    const aNum = parseInt(a.id, 10);
    const bNum = parseInt(b.id, 10);
    if (!isNaN(aNum) && !isNaN(bNum)) return bNum - aNum;
    // Fall back to receivedAt
    return b.receivedAt - a.receivedAt;
  });

  const top = sorted.slice(0, MAX_ACTIVITY_ROWS);
  const items: NowActivityPreviewItem[] = top.map((a) => {
    const rawSummary = getEventSummary(a.event);
    const summary = rawSummary ?? a.event.type;
    return {
      id: a.id,
      eventType: a.event.type,
      summary,
      receivedAt: a.receivedAt,
    };
  });

  return {
    items,
    hiddenCount: Math.max(0, filtered.length - MAX_ACTIVITY_ROWS),
  };
}

// ---------------------------------------------------------------------------
// Connection banner selector
// ---------------------------------------------------------------------------

export function selectNowConnectionBanner(
  state: Pick<
    ConsoleProjectState,
    'connectionStatus' | 'error' | 'lastEventAt' | 'lastSnapshotAt' | 'latestHeartbeat' | 'liveness' | 'lastSnapshotAt'
  >,
  now: number = Date.now(),
): NowBanner | null {
  if (state.connectionStatus === 'connecting') {
    return { kind: 'connecting', message: 'Connecting to daemon stream' };
  }
  if (state.connectionStatus === 'disconnected') {
    const errMsg = state.error ? `: ${state.error}` : '';
    return {
      kind: 'disconnected',
      message: `Daemon stream disconnected${errMsg}`,
    };
  }
  if (state.connectionStatus === 'connected' && isLivenessStale(state, now)) {
    const latest = Math.max(
      state.latestHeartbeat?.at ?? 0,
      state.lastEventAt ?? 0,
      state.lastSnapshotAt ?? 0,
    );
    const secs = Math.round((now - latest) / 1_000);
    return {
      kind: 'stale',
      message: `Daemon heartbeat stale — no activity in ${secs}s`,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Recent runs selector
// ---------------------------------------------------------------------------

export function selectNowRecentRuns(runs: RunInfo[], now: number = Date.now()): NowRecentRunItem[] {
  const sorted = [...runs].sort((a, b) => {
    if (a.startedAt > b.startedAt) return -1;
    if (a.startedAt < b.startedAt) return 1;
    return 0;
  });
  return sorted.slice(0, MAX_RECENT_RUNS).map((run) => {
    let durationMs: number | null = null;
    if (run.completedAt) {
      const start = new Date(run.startedAt).getTime();
      const end = new Date(run.completedAt).getTime();
      if (!isNaN(start) && !isNaN(end)) durationMs = end - start;
    } else {
      const start = new Date(run.startedAt).getTime();
      if (!isNaN(start)) durationMs = now - start;
    }
    return {
      id: run.id,
      sessionId: run.sessionId,
      planSet: selectPrdDisplayLabel(undefined, run.planSet),
      command: run.command,
      status: run.status,
      startedAt: run.startedAt,
      durationMs,
    };
  });
}

// ---------------------------------------------------------------------------
// Stack sync status selector
// ---------------------------------------------------------------------------

export function selectNowStackSyncStatus(
  stackSync: ConsoleProjectState['stackSync'],
): NowStackSyncViewModel | null {
  if (stackSync == null) return null;
  const { last, current } = stackSync;
  // Return null when there is no last record and no in-progress sync
  if (!last && !current) return null;
  return {
    lastOutcome: last?.outcome ?? null,
    lastTrigger: last?.trigger ?? null,
    lastCompletedAt: last?.completedAt ?? null,
    lastStartedAt: last?.startedAt ?? null,
    lastReason: last?.reason ?? null,
    lastError: last?.error ?? null,
    lastDryRun: last?.dryRun ?? false,
    lastRestackCandidateCount: last?.restackCandidates?.length ?? 0,
    lastActiveBuildSkips: last?.activeBuildSkips ?? [],
    lastProviderCommands: last?.providerCommands ?? [],
    inProgress: current != null,
  };
}

// ---------------------------------------------------------------------------
// Main dashboard model selector
// ---------------------------------------------------------------------------

export function selectNowDashboardModel(
  state: ConsoleProjectState,
  activeSessions: { sessions: Record<string, ActiveSessionDetail> },
  now: number = Date.now(),
  extensions: ExtensionEntry[] = [],
): NowDashboardModel {
  const hasSnapshot = state.lastSnapshotAt != null;
  const connectionBanner = selectNowConnectionBanner(state, now);
  const status = selectNowStatusSummary(state, activeSessions.sessions, now);
  const { items: attention, hiddenCount: attentionHiddenCount } = selectNowAttentionItems(
    state,
    activeSessions.sessions,
    now,
    extensions,
  );
  // Resolve human-authored PRD titles from the queue so active build cards
  // label the running plan-set identically to the Queue/Attention surfaces.
  const titleByPlanSet = new Map(state.queue.map((q) => [q.id, q.title]));
  const activeBuilds = selectNowActiveBuildCards(
    state.runs,
    state.sessionMetadata,
    activeSessions.sessions,
    now,
    titleByPlanSet,
  );
  const enqueueCards = selectNowEnqueueCards(state.runs, activeSessions.sessions, now);
  const queue = selectNowQueueSummary(state.queue);
  const queueStacks = selectNowQueueStacks(state.queue);
  const recentRuns = selectNowRecentRuns(state.runs, now);
  const allRuns = selectAllNowRunItems(state.runs, now);
  const builds = selectAllNowBuildItems(state.runs, now);
  const stackSync = selectNowStackSyncStatus(state.stackSync);
  const { items: activity, hiddenCount: activityHiddenCount } = selectNowRecentActivity(
    state.recentActivity,
  );
  const metrics = selectNowMetricsPanel(allRuns);

  return {
    connectionBanner,
    status,
    attention,
    attentionHiddenCount,
    activeBuilds,
    enqueueCards,
    queue,
    queueStacks,
    recentRuns,
    builds,
    stackSync,
    activity,
    activityHiddenCount,
    metrics,
    hasSnapshot,
  };
}
