import type { UserStatus, LifecycleState } from '../sqlite/types.js';
import type { KanbanLane } from '../schema.js';
import type { ProjectionLifecycleEvidenceRow, ProjectionPlanningTaskItemRow, ProjectionSessionItemRow } from '../sqlite/repositories/projections/lifecycle.js';
import { isActivePlanningTaskStatus, isCurrentResultLifecycleState, isLiveSessionPlanStatus, isStalePlannedSessionPlanEvidence, isTerminalSessionPlanStatus, isTerminalBuildStatus, planEligibilityFromBlockers, resultReasonCode, liveSessionPlanLifecycleState, liveSessionPlanReasonCode, type PlanEligibilityProjection, type PlanningBlocker } from '../planning-state-policy.js';
import type { LifecycleReasonCode } from './types.js';

const PRIORITY: Record<string, number> = { shipped: 100, merged: 90, 'pr-open': 80, build: 70, queued: 60, submitted: 55, active: 50, planned: 40, partial: 30, failed: 20, none: 0 };
const TERMINAL_RESULT_STATES = new Set(['shipped', 'merged', 'failed', 'partial']);
const TERMINAL_STATUSES = new Set(['abandoned', 'canceled', 'cancelled', 'complete', 'completed', 'deleted', 'done', 'failed', 'merged', 'shipped', 'superseded']);

export function isTerminalLifecycleState(state: string | undefined): boolean { return state !== undefined && TERMINAL_RESULT_STATES.has(state); }
export function isTerminalProjectionStatus(status: string | undefined): boolean { return status !== undefined && TERMINAL_STATUSES.has(status.toLowerCase()); }
export function isActionableLifecycleEvidence(e: Pick<ProjectionLifecycleEvidenceRow, 'lifecycleState' | 'status' | 'reasonCode' | 'evidenceKind' | 'session'>): boolean { return !isStalePlannedSessionPlanEvidence(e) && (isTerminalLifecycleState(e.lifecycleState) || !isTerminalProjectionStatus(e.status)); }
export function isActionableSessionPlanStatus(status: string | undefined): boolean { return isLiveSessionPlanStatus(status); }

export interface LifecycleProjection extends PlanEligibilityProjection { lifecycleState: LifecycleState; reasonCode: LifecycleReasonCode; reasons: string[]; closed: boolean; lane: KanbanLane; blocked: boolean; ready: boolean; reviewDue: boolean; evidence?: ProjectionLifecycleEvidenceRow }

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

export function blockersFromLifecycleInput(input: { itemId: string; evidence: ProjectionLifecycleEvidenceRow[]; sessionItems: ProjectionSessionItemRow[]; taskItems: ProjectionPlanningTaskItemRow[]; links?: import('./types.js').AssociatedPlanBuildLink[] }): PlanningBlocker[] {
  const links = input.links ?? [];
  const blockers: PlanningBlocker[] = [];
  for (const evidence of input.evidence) {
    if (isStalePlannedSessionPlanEvidence(evidence)) continue;
    if (isCurrentResultLifecycleState(evidence.lifecycleState)) blockers.push({ reasonCode: reasonForEvidence(evidence), lifecycleState: evidence.lifecycleState, associatedLinks: links, terminal: true });
    else if (['submitted', 'queued', 'build', 'pr-open'].includes(evidence.lifecycleState) && !isTerminalBuildStatus(evidence.status)) blockers.push({ reasonCode: reasonForEvidence(evidence), lifecycleState: evidence.lifecycleState, associatedLinks: links, terminal: false });
  }
  for (const session of input.sessionItems) {
    if (!isLiveSessionPlanStatus(session.status)) continue;
    blockers.push({ reasonCode: liveSessionPlanReasonCode(session.status), lifecycleState: liveSessionPlanLifecycleState(session.status), associatedLinks: links, terminal: false });
  }
  for (const task of input.taskItems) {
    if (!isActivePlanningTaskStatus(task.status)) continue;
    blockers.push({ reasonCode: 'active-planning-task', lifecycleState: 'active', associatedLinks: links, terminal: false });
  }
  return blockers;
}

export function computeEffectiveLifecycle(input: { userStatus: UserStatus; evidence: ProjectionLifecycleEvidenceRow[]; sessionItems: ProjectionSessionItemRow[]; taskItems: ProjectionPlanningTaskItemRow[]; hasUnresolvedDependency: boolean; itemId?: string; links?: import('./types.js').AssociatedPlanBuildLink[] }): LifecycleProjection {
  const actionableEvidence = input.evidence.filter(isActionableLifecycleEvidence);
  const failed = actionableEvidence.filter((e) => e.lifecycleState === 'failed').sort((a, b) => (b.occurredAt ?? '').localeCompare(a.occurredAt ?? ''))[0];
  const failedIsCurrent = failed && !actionableEvidence.some((e) => e.lifecycleState !== 'failed' && (e.occurredAt ?? '') > (failed.occurredAt ?? ''));
  const evidence = failedIsCurrent ? failed : [...actionableEvidence].filter((e) => e.lifecycleState !== 'failed').sort((a, b) => (PRIORITY[b.lifecycleState] ?? 0) - (PRIORITY[a.lifecycleState] ?? 0) || (b.occurredAt ?? '').localeCompare(a.occurredAt ?? ''))[0];
  let lifecycleState: LifecycleState | undefined = evidence?.lifecycleState;
  let reasonCode: LifecycleReasonCode | undefined = evidence ? reasonForEvidence(evidence) : undefined;
  if (input.userStatus === 'shipped' && lifecycleState !== 'shipped') { lifecycleState = 'shipped'; reasonCode = 'explicit-shipped-status'; }
  if (input.userStatus === 'stale' || input.userStatus === 'superseded') { lifecycleState = 'none'; reasonCode = 'explicit-archive-status'; }
  if (!lifecycleState) {
    const activeTask = input.taskItems.find((t) => isActivePlanningTaskStatus(t.status));
    if (activeTask) { lifecycleState = 'active'; reasonCode = 'active-planning-task'; }
  }
  if (!lifecycleState) {
    const actionableSessionItems = input.sessionItems.filter((s) => !isTerminalSessionPlanStatus(s.status));
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
  const blockers = blockersFromLifecycleInput({ itemId: input.itemId ?? '', evidence: input.evidence, sessionItems: input.sessionItems, taskItems: input.taskItems, links: input.links });
  const eligibility = planEligibilityFromBlockers(input.itemId ?? '', blockers, input.hasUnresolvedDependency);
  const blocked = input.hasUnresolvedDependency || lifecycleState === 'failed' || lifecycleState === 'partial';
  const lane: KanbanLane = (input.userStatus === 'stale' || input.userStatus === 'superseded') && (reasonCode === 'explicit-archive-status') ? 'archive' : blocked ? 'blocked' : lifecycleState === 'shipped' || lifecycleState === 'merged' ? 'done' : lifecycleState === 'build' || lifecycleState === 'queued' || lifecycleState === 'submitted' || lifecycleState === 'pr-open' || lifecycleState === 'active' ? 'in-progress' : lifecycleState === 'planned' ? 'ready' : 'inbox';
  const selectedState = lifecycleState ?? 'none';
  const selectedReason = reasonCode ?? 'candidate-no-evidence';
  return { lifecycleState: publicLifecycleState(selectedState), reasonCode: selectedReason, reasons: [selectedReason], closed, lane, blocked, ready: lane === 'ready', reviewDue: false, evidence, ...eligibility };
}
