import { withProjectionStore } from './store.js';
import { listLifecycleEvidenceForItems, listProjectionPlanningTaskItems, listProjectionQueueBuildLinks, listProjectionSessionItems, type ProjectionLifecycleEvidenceRow } from '../sqlite/repositories/projections/lifecycle.js';
import { getAssociatedPlanBuildLinksForItemsFromStore } from './links.js';
import { isLiveQueuePrdStatus } from '../planning-state-policy.js';
import { blockersFromLifecycleInput, isTerminalProjectionStatus, reasonForEvidence } from './lifecycle.js';
import type { EforgePlanStore } from '../sqlite/index.js';
import type { CoverageEntry, CoverageResult } from './types.js';

function queueBuildEvidenceForItems(store: EforgePlanStore, itemIds: readonly string[], sessionItems: ReturnType<typeof listProjectionSessionItems>): ProjectionLifecycleEvidenceRow[] {
  const sessionItemIds = new Map<string, Set<string>>();
  for (const row of sessionItems) {
    const itemId = row.itemId ?? row.itemRef;
    if (!itemIds.includes(itemId)) continue;
    const ids = sessionItemIds.get(row.session) ?? new Set<string>();
    ids.add(itemId);
    sessionItemIds.set(row.session, ids);
  }
  return listProjectionQueueBuildLinks(store).flatMap((row): ProjectionLifecycleEvidenceRow[] => {
    // --- eforge:region plan-02-eforge-plan-cleanup ---
    if (row.kind === 'queue-prd' && !isLiveQueuePrdStatus(row.status)) return [];
    // --- eforge:endregion plan-02-eforge-plan-cleanup ---
    const status = row.status?.toLowerCase();
    const state = row.kind === 'landing'
      ? status === 'shipped' ? 'shipped' : status === 'merged' ? 'merged' : status && !isTerminalProjectionStatus(status) ? 'pr-open' : undefined
      : status === 'failed' ? 'failed' : isTerminalProjectionStatus(status) ? undefined : row.kind === 'queue-prd' ? 'queued' : 'build';
    if (state === undefined) return [];
    const linkedIds = row.itemId ? [row.itemId] : [...(sessionItemIds.get(row.session ?? '') ?? [])];
    return linkedIds.filter((itemId) => itemIds.includes(itemId)).map((itemId) => ({
      evidenceKey: `queue-build:${row.kind}:${row.id}:${itemId}`,
      itemId,
      itemRef: itemId,
      lifecycleState: state,
      reasonCode: state === 'shipped' ? 'shipped' : state === 'merged' ? 'merged' : state === 'failed' ? 'failed' : row.kind === 'queue-prd' ? 'queued-trace' : row.kind === 'build-session' ? 'active-build-session-trace' : state === 'pr-open' ? 'pr-open' : 'building-trace',
      status: row.status,
      session: row.session,
      queuePrdId: row.queuePrdId,
      runId: row.runId,
      buildSessionId: row.buildSessionId,
      landingId: row.kind === 'landing' ? row.id : undefined,
      occurredAt: row.timestamp,
      isCurrent: true,
      isTerminal: state === 'shipped' || state === 'merged' || state === 'failed',
    }));
  });
}

export interface NonterminalCoverageInput { itemIds: string[]; includeTerminalReasons?: boolean; includePlanningTasks?: boolean; excludePlanningTaskIds?: string[] }

export function findNonterminalCoverageFromStore(store: EforgePlanStore, input: NonterminalCoverageInput): CoverageResult {
  const itemIds = [...new Set(input.itemIds)];
  const excludedTaskIds = new Set(input.excludePlanningTaskIds ?? []);
  const sessionItems = listProjectionSessionItems(store);
  const taskItems = input.includePlanningTasks === false ? [] : listProjectionPlanningTaskItems(store).filter((task) => !excludedTaskIds.has(task.taskId));
  const evidenceRows = [...listLifecycleEvidenceForItems(store, itemIds), ...queueBuildEvidenceForItems(store, itemIds, sessionItems)];
  const entries: CoverageEntry[] = [];
  for (const itemId of itemIds) {
    const links = getAssociatedPlanBuildLinksForItemsFromStore(store, [itemId]);
    const blockers = blockersFromLifecycleInput({
      itemId,
      links,
      evidence: evidenceRows.filter((e) => e.itemId === itemId || e.itemRef === itemId),
      sessionItems: sessionItems.filter((s) => (s.itemId ?? s.itemRef) === itemId),
      taskItems: taskItems.filter((t) => (t.itemId ?? t.itemRef) === itemId),
    });
    entries.push(...blockers.filter((entry) => input.includeTerminalReasons === true || entry.terminal || entry.reasonCode !== 'candidate-no-evidence').map((entry) => ({ itemId, reasonCode: entry.reasonCode, lifecycleState: entry.lifecycleState, associatedLinks: entry.associatedLinks, terminal: entry.terminal })));
    if (input.includeTerminalReasons === true) {
      const terminalEvidence: ProjectionLifecycleEvidenceRow[] = evidenceRows.filter((row) => (row.itemId === itemId || row.itemRef === itemId) && row.isTerminal);
      for (const evidence of terminalEvidence) {
        const reasonCode = reasonForEvidence(evidence);
        if (!blockers.some((blocker) => blocker.reasonCode === reasonCode)) entries.push({ itemId, reasonCode, lifecycleState: evidence.lifecycleState, associatedLinks: links, terminal: true });
      }
    }
  }
  const unique = [...new Map(entries.map((entry) => [`${entry.itemId}:${entry.reasonCode}:${entry.lifecycleState}`, entry])).values()];
  return { schemaVersion: 1 as const, ok: unique.length === 0, entries: unique, coveredItemIds: [...new Set(unique.map((entry) => entry.itemId))].sort() };
}

export async function findNonterminalCoverage(cwd: string, input: NonterminalCoverageInput): Promise<CoverageResult> {
  return withProjectionStore(cwd, (store) => findNonterminalCoverageFromStore(store, input), () => ({ schemaVersion: 1 as const, ok: true, entries: [], coveredItemIds: [] }));
}
