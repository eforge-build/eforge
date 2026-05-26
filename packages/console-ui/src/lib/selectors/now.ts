/**
 * Pure selector functions and dashboard view model types for the Now dashboard.
 *
 * No React imports. No DOM imports.
 * Imports wire types from @eforge-build/client/browser or src/lib/types only.
 * Does not redeclare QueueItem, RunInfo, SessionMetadata, AutoBuildState,
 * or StackLayerWire.
 */

import type {
  RunInfo,
  QueueItem,
  StackLayerWire,
  EforgeEvent,
} from '@eforge-build/client/browser';
import { getEventSummary } from '@eforge-build/client/browser';
import type { ConsoleProjectState } from '@/lib/project-state';
import type { ActiveSessionDetail } from '@/hooks/use-active-session-streams';
import type { ConnectionStatus, ConsoleActivityEntry } from '@/lib/types';
import { isTerminalStatus } from '@/lib/selectors/active-builds';
import { toConsolePath } from '@/lib/navigation';
import { selectPrdDisplayLabel } from '@/lib/selectors/labels';

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
  snapshotEventCount: number;
  liveEventCount: number;
  currentPhase: string | null;
  latestAgent: string | null;
  latestProgress: string | null;
  latestError: string | null;
  href: string;
}

export interface NowQueueItem {
  id: string;
  title: string;
  status: string;
  priority: number | undefined;
  created: string | undefined;
  dependsOn: string[] | undefined;
  recoveryVerdict: { verdict: string; confidence: string } | undefined;
}

export interface NowQueueSummary {
  total: number;
  byStatus: Record<string, number>;
  runningCount: number;
  pendingCount: number;
  failedCount: number;
  waitingCount: number;
  withDependenciesCount: number;
  withRecoveryVerdictCount: number;
  topItems: NowQueueItem[];
  hiddenCount: number;
}

export interface NowRecentRunItem {
  id: string;
  sessionId: string | undefined;
  planSet: string;
  command: string;
  status: string;
  startedAt: string;
  durationMs: number | null;
}

export interface NowStackRow {
  prdId: string;
  stackId: string;
  provider: string;
  branch: string;
  baseBranch: string | undefined;
  status: string;
  landingStatus: string | undefined;
}

export interface NowStackSummary {
  totalCount: number;
  byStatus: Record<string, number>;
  byStackId: Record<string, number>;
  topRows: NowStackRow[];
  hiddenCount: number;
}

export interface NowActivityPreviewItem {
  id: string;
  eventType: string;
  summary: string;
  receivedAt: number;
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
  queue: NowQueueSummary;
  recentRuns: NowRecentRunItem[];
  stack: NowStackSummary | null;
  activity: NowActivityPreviewItem[];
  activityHiddenCount: number;
  hasSnapshot: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STALE_THRESHOLD_MS = 30_000;
const MAX_ATTENTION_ITEMS = 5;
const MAX_QUEUE_ITEMS = 4;
const MAX_RECENT_RUNS = 4;
const MAX_STACK_ROWS = 6;
const MAX_ACTIVITY_ROWS = 6;

// Status attention ordering for queue items (lower index = higher priority)
const QUEUE_STATUS_ATTENTION_ORDER = ['failed', 'running', 'waiting', 'pending'];

function queueStatusOrder(status: string): number {
  const idx = QUEUE_STATUS_ATTENTION_ORDER.indexOf(status.toLowerCase());
  return idx === -1 ? QUEUE_STATUS_ATTENTION_ORDER.length : idx;
}

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

/**
 * Derive a stable deduplication key from a PRD or plan-set slug or display
 * title.  Strips timestamp prefixes and file extensions, lowercases, replaces
 * all non-alphanumeric characters (including whitespace) with hyphens,
 * collapses consecutive hyphens, and trims leading/trailing hyphens so that
 * title variants ("Feature X") and slug variants ("feature-x") resolve to the
 * same key.
 */
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

/** Internal candidate shape used during attention-item collection. */
interface AttentionCandidate {
  item: NowAttentionItem;
  /** Stable key; candidates sharing a key are merged (worst severity wins). */
  dedupKey: string;
}

// ---------------------------------------------------------------------------
// Freshness / stale detection
// ---------------------------------------------------------------------------

/**
 * Returns true if the last known heartbeat or event is older than the stale threshold.
 */
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
// Queue summary selector
// ---------------------------------------------------------------------------

export function selectNowQueueSummary(queue: QueueItem[]): NowQueueSummary {
  const byStatus: Record<string, number> = {};
  let runningCount = 0;
  let pendingCount = 0;
  let failedCount = 0;
  let waitingCount = 0;
  let withDependenciesCount = 0;
  let withRecoveryVerdictCount = 0;

  for (const item of queue) {
    const s = item.status.toLowerCase();
    byStatus[s] = (byStatus[s] ?? 0) + 1;
    if (s === 'running') runningCount++;
    if (s === 'pending') pendingCount++;
    if (s === 'failed') failedCount++;
    if (s === 'waiting') waitingCount++;
    if (item.dependsOn && item.dependsOn.length > 0) withDependenciesCount++;
    if (item.recoveryVerdict) withRecoveryVerdictCount++;
  }

  // Sort items by attention order
  const sorted = [...queue].sort((a, b) => {
    const orderDiff = queueStatusOrder(a.status) - queueStatusOrder(b.status);
    if (orderDiff !== 0) return orderDiff;
    // Tie-break: higher priority first (higher number = more urgent)
    const aPriority = a.priority ?? 0;
    const bPriority = b.priority ?? 0;
    if (bPriority !== aPriority) return bPriority - aPriority;
    // Then older created first
    const aCreated = a.created ?? '';
    const bCreated = b.created ?? '';
    if (aCreated !== bCreated) return aCreated < bCreated ? -1 : 1;
    // Finally by id
    return a.id < b.id ? -1 : 1;
  });

  const topItems: NowQueueItem[] = sorted.slice(0, MAX_QUEUE_ITEMS).map((item) => ({
    id: item.id,
    title: selectPrdDisplayLabel(item.title, item.id),
    status: item.status,
    priority: item.priority,
    created: item.created,
    dependsOn: item.dependsOn,
    recoveryVerdict: item.recoveryVerdict,
  }));

  return {
    total: queue.length,
    byStatus,
    runningCount,
    pendingCount,
    failedCount,
    waitingCount,
    withDependenciesCount,
    withRecoveryVerdictCount,
    topItems,
    hiddenCount: Math.max(0, queue.length - MAX_QUEUE_ITEMS),
  };
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
    (q) => q.status.toLowerCase() === 'failed' && q.recoveryVerdict != null,
  );
  for (const item of failedWithVerdict) {
    const rv = item.recoveryVerdict!;
    const label = selectPrdDisplayLabel(item.title, item.id);
    candidates.push({
      item: {
        id: `queue-failed-verdict-${item.id}`,
        severity: 'warning',
        message: `Failed: ${label}`,
        detail: `${rv.verdict} / ${rv.confidence}`,
      },
      dedupKey: `prd:${normalizePrdDedupKey(item.id)}`,
    });
  }

  // 5. Failed queue items without recovery verdict
  const failedWithoutVerdict = state.queue.filter(
    (q) => q.status.toLowerCase() === 'failed' && q.recoveryVerdict == null,
  );
  for (const item of failedWithoutVerdict) {
    const label = selectPrdDisplayLabel(item.title, item.id);
    candidates.push({
      item: {
        id: `queue-failed-${item.id}`,
        severity: 'warning',
        message: `Failed: ${label}`,
        detail: 'recovery pending',
      },
      dedupKey: `prd:${normalizePrdDedupKey(item.id)}`,
    });
  }

  // 6. Recent failed runs, newest first
  const failedRuns = [...state.runs]
    .filter((r) => isTerminalStatus(r.status) && r.status.toLowerCase() !== 'completed' && r.status.toLowerCase() !== 'complete' && r.status.toLowerCase() !== 'success' && r.status.toLowerCase() !== 'succeeded')
    .sort((a, b) => {
      if (a.startedAt > b.startedAt) return -1;
      if (a.startedAt < b.startedAt) return 1;
      return 0;
    });
  for (const run of failedRuns.slice(0, 3)) {
    const label = selectPrdDisplayLabel(undefined, run.planSet);
    candidates.push({
      item: {
        id: `run-failed-${run.id}`,
        severity: 'info',
        message: `Run failed: ${label}`,
        detail: run.command,
      },
      dedupKey: `prd:${normalizePrdDedupKey(run.planSet)}`,
    });
  }

  // 7. Queue items blocked by dependencies
  const blocked = state.queue.filter(
    (q) => q.dependsOn && q.dependsOn.length > 0 && q.status.toLowerCase() !== 'failed' && q.status.toLowerCase() !== 'running',
  );
  for (const item of blocked) {
    const label = selectPrdDisplayLabel(item.title, item.id);
    candidates.push({
      item: {
        id: `queue-blocked-${item.id}`,
        severity: 'info',
        message: `Waiting on dependencies: ${label}`,
        detail: `depends on ${item.dependsOn!.length} item(s)`,
      },
      dedupKey: `prd:${normalizePrdDedupKey(item.id)}`,
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

  const deduped = Array.from(seen.values());
  const items = deduped.slice(0, MAX_ATTENTION_ITEMS);
  const hiddenCount = Math.max(0, deduped.length - MAX_ATTENTION_ITEMS);
  return { items, hiddenCount };
}

// ---------------------------------------------------------------------------
// Active build cards selector
// ---------------------------------------------------------------------------

function extractCurrentPhase(events: EforgeEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
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

function extractLatestAgent(events: EforgeEvent[]): string | null {
  const agentEventTypes = new Set(['agent:start', 'agent:activity', 'agent:result', 'agent:stop']);
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (agentEventTypes.has(e.type)) {
      const ae = e as { type: string; agent: string; planId?: string };
      return ae.agent ?? null;
    }
  }
  return null;
}

function extractLatestProgress(events: EforgeEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === 'plan:build:progress') {
      const pe = e as Extract<EforgeEvent, { type: 'plan:build:progress' }>;
      return pe.message;
    }
  }
  return null;
}

function extractLatestError(events: EforgeEvent[], detail: ActiveSessionDetail): string | null {
  // First check session detail error
  if (detail.error) return detail.error;
  // Then look for plan:build:failed in live events
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === 'plan:build:failed') {
      const pe = e as Extract<EforgeEvent, { type: 'plan:build:failed' }>;
      return pe.error;
    }
    if (e.type === 'agent:stop') {
      const ae = e as Extract<EforgeEvent, { type: 'agent:stop' }>;
      if (ae.error) return ae.error;
    }
  }
  return null;
}

export function selectNowActiveBuildCards(
  runs: RunInfo[],
  sessionMetadata: Record<string, { planCount: number | null; baseProfile: string | null }>,
  activeDetails: Record<string, ActiveSessionDetail>,
  now: number = Date.now(),
): NowActiveBuildCard[] {
  // Filter to active runs (no completedAt, non-terminal status)
  const activeRuns = runs.filter(
    (r) => !r.completedAt && r.sessionId && !isTerminalStatus(r.status),
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
    let snapshotEventCount = 0;
    let liveEventCount = 0;
    let currentPhase: string | null = null;
    let latestAgent: string | null = null;
    let latestProgress: string | null = null;
    let latestError: string | null = null;

    if (detail) {
      streamStatus = detail.connectionStatus;
      snapshotEventCount = detail.snapshotEvents.length;
      liveEventCount = detail.liveEvents.length;
      // Phase/agent/progress/error are extracted from live events only.
      // Snapshot events are raw {id, data} strings used only for counting.
      currentPhase = extractCurrentPhase(detail.liveEvents);
      latestAgent = extractLatestAgent(detail.liveEvents);
      latestProgress = extractLatestProgress(detail.liveEvents);
      latestError = extractLatestError(detail.liveEvents, detail);
    }

    return {
      sessionId,
      runId: run.id,
      planSet: selectPrdDisplayLabel(undefined, run.planSet),
      command: run.command,
      status: run.status,
      startedAt: run.startedAt,
      durationMs,
      cwd: run.cwd,
      profile: meta?.baseProfile ?? null,
      planCount: meta?.planCount ?? null,
      streamStatus,
      snapshotEventCount,
      liveEventCount,
      currentPhase,
      latestAgent,
      latestProgress,
      latestError,
      href: toConsolePath('runs'),
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
// Stack summary selector
// ---------------------------------------------------------------------------

export function selectNowStackSummary(stackLayers: StackLayerWire[]): NowStackSummary | null {
  if (stackLayers.length === 0) return null;

  const byStatus: Record<string, number> = {};
  const byStackId: Record<string, number> = {};

  for (const layer of stackLayers) {
    const s = layer.status;
    byStatus[s] = (byStatus[s] ?? 0) + 1;
    byStackId[layer.stackId] = (byStackId[layer.stackId] ?? 0) + 1;
  }

  const topRows: NowStackRow[] = stackLayers.slice(0, MAX_STACK_ROWS).map((layer) => ({
    prdId: selectPrdDisplayLabel(undefined, layer.prdId),
    stackId: layer.stackId,
    provider: layer.provider,
    branch: layer.branch,
    baseBranch: layer.baseBranch,
    status: layer.status,
    landingStatus: layer.landing?.status,
  }));

  return {
    totalCount: stackLayers.length,
    byStatus,
    byStackId,
    topRows,
    hiddenCount: Math.max(0, stackLayers.length - MAX_STACK_ROWS),
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
// Main dashboard model selector
// ---------------------------------------------------------------------------

export function selectNowDashboardModel(
  state: ConsoleProjectState,
  activeSessions: { sessions: Record<string, ActiveSessionDetail> },
  now: number = Date.now(),
): NowDashboardModel {
  const hasSnapshot = state.lastSnapshotAt != null;
  const connectionBanner = selectNowConnectionBanner(state, now);
  const status = selectNowStatusSummary(state, activeSessions.sessions, now);
  const { items: attention, hiddenCount: attentionHiddenCount } = selectNowAttentionItems(
    state,
    activeSessions.sessions,
    now,
  );
  const activeBuilds = selectNowActiveBuildCards(
    state.runs,
    state.sessionMetadata,
    activeSessions.sessions,
    now,
  );
  const queue = selectNowQueueSummary(state.queue);
  const recentRuns = selectNowRecentRuns(state.runs, now);
  const stack = selectNowStackSummary(state.stackLayers);
  const { items: activity, hiddenCount: activityHiddenCount } = selectNowRecentActivity(
    state.recentActivity,
  );

  return {
    connectionBanner,
    status,
    attention,
    attentionHiddenCount,
    activeBuilds,
    queue,
    recentRuns,
    stack,
    activity,
    activityHiddenCount,
    hasSnapshot,
  };
}
