import type { UserStatus, LifecycleState } from '../sqlite/types.js';
import type { KanbanLane } from '../schema.js';
import type { ProjectionLifecycleEvidenceRow, ProjectionPlanningTaskItemRow, ProjectionSessionItemRow } from '../sqlite/repositories/projections/lifecycle.js';
import type { LifecycleReasonCode } from './types.js';

const PRIORITY: Record<string, number> = { shipped: 100, merged: 90, 'pr-open': 80, build: 70, queued: 60, submitted: 55, active: 50, planned: 40, partial: 30, failed: 20, none: 0 };
const ACTIVE_TASK = new Set(['queued', 'running', 'active', 'in-progress']);
const TERMINAL_RESULT_STATES = new Set(['shipped', 'merged', 'failed', 'partial']);
const TERMINAL_STATUSES = new Set(['abandoned', 'canceled', 'cancelled', 'complete', 'completed', 'deleted', 'done', 'failed', 'merged', 'shipped', 'superseded']);
const HIDDEN_SESSION_PLAN_STATUSES = new Set(['abandoned', 'canceled', 'cancelled', 'complete', 'completed', 'deleted', 'superseded']);

export function isTerminalLifecycleState(state: string | undefined): boolean { return state !== undefined && TERMINAL_RESULT_STATES.has(state); }
export function isTerminalProjectionStatus(status: string | undefined): boolean { return status !== undefined && TERMINAL_STATUSES.has(status.toLowerCase()); }
export function isActionableLifecycleEvidence(e: Pick<ProjectionLifecycleEvidenceRow, 'lifecycleState' | 'status'>): boolean { return isTerminalLifecycleState(e.lifecycleState) || !isTerminalProjectionStatus(e.status); }
export function isActionableSessionPlanStatus(status: string | undefined): boolean { return status === undefined || !HIDDEN_SESSION_PLAN_STATUSES.has(status.toLowerCase()); }

export interface LifecycleProjection { lifecycleState: LifecycleState; reasonCode: LifecycleReasonCode; reasons: string[]; closed: boolean; lane: KanbanLane; blocked: boolean; ready: boolean; reviewDue: boolean; evidence?: ProjectionLifecycleEvidenceRow }

export function reasonForEvidence(e: Pick<ProjectionLifecycleEvidenceRow, 'lifecycleState' | 'reasonCode' | 'runId' | 'buildSessionId' | 'queuePrdId' | 'landingId'>): LifecycleReasonCode {
  if (e.reasonCode) return mapReasonCode(e.reasonCode);
  if (e.lifecycleState === 'shipped') return 'shipped-result';
  if (e.lifecycleState === 'merged') return 'merged-result';
  if (e.lifecycleState === 'pr-open') return 'open-pr';
  if (e.lifecycleState === 'build') return e.buildSessionId && !e.runId ? 'active-build-session' : 'running-build';
  if (e.lifecycleState === 'queued') return 'queued-build';
  if (e.lifecycleState === 'submitted') return 'submitted-session-plan';
  if (e.lifecycleState === 'planned') return 'planned-session-plan';
  if (e.lifecycleState === 'failed') return 'failed-result';
  if (e.lifecycleState === 'partial') return 'partial-plan';
  return 'candidate-no-evidence';
}
export function mapReasonCode(code: string): LifecycleReasonCode { return ({ 'queued-trace': 'queued-build', 'building-trace': 'running-build', 'active-build': 'running-build', 'active-build-session-trace': 'active-build-session', 'open-pr-trace': 'open-pr', 'pr-open': 'open-pr', shipped: 'shipped-result', merged: 'merged-result', failed: 'failed-result', partial: 'partial-plan' } as Record<string, LifecycleReasonCode>)[code] ?? code as LifecycleReasonCode; }
export function publicLifecycleState(state: LifecycleState): LifecycleState { return (state === 'queued' || state === 'submitted' ? 'queue' : state === 'active' ? 'planned' : state) as LifecycleState; }
export function computeEffectiveLifecycle(input: { userStatus: UserStatus; evidence: ProjectionLifecycleEvidenceRow[]; sessionItems: ProjectionSessionItemRow[]; taskItems: ProjectionPlanningTaskItemRow[]; hasUnresolvedDependency: boolean }): LifecycleProjection {
  const actionableEvidence = input.evidence.filter(isActionableLifecycleEvidence);
  const failed = actionableEvidence.filter((e) => e.lifecycleState === 'failed').sort((a, b) => (b.occurredAt ?? '').localeCompare(a.occurredAt ?? ''))[0];
  const failedIsCurrent = failed && !actionableEvidence.some((e) => e.lifecycleState !== 'failed' && (e.occurredAt ?? '') > (failed.occurredAt ?? ''));
  const evidence = failedIsCurrent ? failed : [...actionableEvidence].filter((e) => e.lifecycleState !== 'failed').sort((a, b) => (PRIORITY[b.lifecycleState] ?? 0) - (PRIORITY[a.lifecycleState] ?? 0) || (b.occurredAt ?? '').localeCompare(a.occurredAt ?? ''))[0];
  let lifecycleState: LifecycleState | undefined = evidence?.lifecycleState;
  let reasonCode: LifecycleReasonCode | undefined = evidence ? reasonForEvidence(evidence) : undefined;
  if (input.userStatus === 'shipped' && lifecycleState !== 'shipped') { lifecycleState = 'shipped'; reasonCode = 'explicit-shipped-status'; }
  if (input.userStatus === 'stale' || input.userStatus === 'superseded') { lifecycleState = 'none'; reasonCode = 'explicit-archive-status'; }
  if (!lifecycleState) {
    const activeTask = input.taskItems.find((t) => ACTIVE_TASK.has(t.status ?? ''));
    if (activeTask) { lifecycleState = 'active'; reasonCode = 'active-planning-task'; }
  }
  if (!lifecycleState) {
    const actionableSessionItems = input.sessionItems.filter((s) => isActionableSessionPlanStatus(s.status));
    const submitted = actionableSessionItems.find((s) => s.status === 'submitted');
    const planned = actionableSessionItems[0];
    if (submitted) { lifecycleState = 'submitted'; reasonCode = 'submitted-session-plan'; }
    else if (planned) { lifecycleState = 'planned'; reasonCode = 'planned-session-plan'; }
  }
  if (!lifecycleState) {
    // 'shipped'/'stale'/'superseded' are already resolved unconditionally above, so they can't reach this fallback.
    if (input.userStatus === 'active') { lifecycleState = 'active'; reasonCode = 'explicit-active-status'; }
    else if (input.userStatus === 'planned') { lifecycleState = 'planned'; reasonCode = 'explicit-planned-status'; }
    else { lifecycleState = 'none'; reasonCode = input.hasUnresolvedDependency ? 'unresolved-dependency' : 'candidate-no-evidence'; }
  }
  if (input.hasUnresolvedDependency && reasonCode === 'candidate-no-evidence') reasonCode = 'unresolved-dependency';
  const closed = lifecycleState === 'shipped' || lifecycleState === 'merged' || reasonCode === 'explicit-shipped-status' || reasonCode === 'explicit-archive-status';
  const blocked = input.hasUnresolvedDependency || lifecycleState === 'failed' || lifecycleState === 'partial';
  const lane: KanbanLane = (input.userStatus === 'stale' || input.userStatus === 'superseded') && (reasonCode === 'explicit-archive-status') ? 'archive' : blocked ? 'blocked' : lifecycleState === 'shipped' || lifecycleState === 'merged' ? 'done' : lifecycleState === 'build' || lifecycleState === 'queued' || lifecycleState === 'submitted' || lifecycleState === 'pr-open' || lifecycleState === 'active' ? 'in-progress' : lifecycleState === 'planned' ? 'ready' : 'inbox';
  const selectedState = lifecycleState ?? 'none';
  const selectedReason = reasonCode ?? 'candidate-no-evidence';
  return { lifecycleState: publicLifecycleState(selectedState), reasonCode: selectedReason, reasons: [selectedReason], closed, lane, blocked, ready: lane === 'ready', reviewDue: false, evidence };
}
