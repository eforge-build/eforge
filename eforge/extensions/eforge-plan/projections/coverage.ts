import { withProjectionStore } from './store.js';
import { listLifecycleEvidenceForItems, listProjectionPlanningTaskItems, listProjectionQueueBuildLinks, listProjectionSessionItems } from '../sqlite/repositories/projections/lifecycle.js';
import { getAssociatedPlanBuildLinksForItemsFromStore } from './links.js';
import { isActionableLifecycleEvidence, isActionableSessionPlanStatus, isTerminalLifecycleState, isTerminalProjectionStatus, mapReasonCode, reasonForEvidence } from './lifecycle.js';
import type { CoverageResult } from './types.js';

const ACTIVE_TASK = new Set(['queued', 'running', 'active', 'in-progress']);
function queueBuildCoverage(row: ReturnType<typeof listProjectionQueueBuildLinks>[number]) {
  const status = row.status?.toLowerCase();
  if (row.kind === 'landing') return status === 'shipped' ? { lifecycleState: 'shipped' as const, reasonCode: 'shipped-result' as const } : status === 'merged' ? { lifecycleState: 'merged' as const, reasonCode: 'merged-result' as const } : status && !isTerminalProjectionStatus(status) ? { lifecycleState: 'pr-open' as const, reasonCode: 'open-pr' as const } : undefined;
  if (status === 'failed') return { lifecycleState: 'failed' as const, reasonCode: 'failed-result' as const };
  if (isTerminalProjectionStatus(status)) return undefined;
  if (row.kind === 'queue-prd') return { lifecycleState: 'queued' as const, reasonCode: 'queued-build' as const };
  return { lifecycleState: 'build' as const, reasonCode: row.kind === 'build-session' ? 'active-build-session' as const : 'running-build' as const };
}
export async function findNonterminalCoverage(cwd: string, input: { itemIds: string[]; includeTerminalReasons?: boolean }): Promise<CoverageResult> { return withProjectionStore(cwd, (store) => { const entries = []; const linksByItem = new Map(input.itemIds.map((id) => [id, getAssociatedPlanBuildLinksForItemsFromStore(store, [id])])); for (const e of listLifecycleEvidenceForItems(store, input.itemIds).filter(isActionableLifecycleEvidence)) { const terminal = isTerminalLifecycleState(e.lifecycleState); if (!terminal || input.includeTerminalReasons) entries.push({ itemId: e.itemId, reasonCode: reasonForEvidence(e), lifecycleState: e.lifecycleState, associatedLinks: linksByItem.get(e.itemId) ?? [], terminal }); }
for (const s of listProjectionSessionItems(store).filter((s) => input.itemIds.includes(s.itemId ?? s.itemRef) && isActionableSessionPlanStatus(s.status))) entries.push({ itemId: s.itemId ?? s.itemRef, reasonCode: mapReasonCode(s.status === 'submitted' ? 'submitted-session-plan' : 'planned-session-plan'), lifecycleState: s.status === 'submitted' ? 'submitted' as const : 'planned' as const, associatedLinks: linksByItem.get(s.itemId ?? s.itemRef) ?? [], terminal: false });
for (const t of listProjectionPlanningTaskItems(store).filter((t) => input.itemIds.includes(t.itemId ?? t.itemRef) && ACTIVE_TASK.has(t.status ?? ''))) entries.push({ itemId: t.itemId ?? t.itemRef, reasonCode: 'active-planning-task' as const, lifecycleState: 'active' as const, associatedLinks: linksByItem.get(t.itemId ?? t.itemRef) ?? [], terminal: false });
const sessionItemIds = new Map<string, Set<string>>();
for (const s of listProjectionSessionItems(store)) { const id = s.itemId ?? s.itemRef; if (!input.itemIds.includes(id)) continue; const current = sessionItemIds.get(s.session) ?? new Set<string>(); current.add(id); sessionItemIds.set(s.session, current); }
for (const q of listProjectionQueueBuildLinks(store)) { const mapped = queueBuildCoverage(q); if (!mapped) continue; const linkedIds = q.itemId ? [q.itemId] : [...(sessionItemIds.get(q.session ?? '') ?? [])]; for (const itemId of linkedIds.filter((id) => input.itemIds.includes(id))) { const terminal = isTerminalLifecycleState(mapped.lifecycleState); if (!terminal || input.includeTerminalReasons) entries.push({ itemId, reasonCode: mapped.reasonCode, lifecycleState: mapped.lifecycleState, associatedLinks: linksByItem.get(itemId) ?? [], terminal }); } }
const unique = [...new Map(entries.map((e) => [`${e.itemId}:${e.reasonCode}`, e])).values()]; return { schemaVersion: 1 as const, ok: unique.length === 0, entries: unique, coveredItemIds: [...new Set(unique.map((e) => e.itemId))].sort() }; }, () => ({ schemaVersion: 1 as const, ok: true, entries: [], coveredItemIds: [] })); }
