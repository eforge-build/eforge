import type { LifecycleState } from './sqlite/types.js';
import type { AssociatedPlanBuildLink, LifecycleReasonCode } from './projections/types.js';

export interface PlanningBlocker {
  reasonCode: LifecycleReasonCode | string;
  lifecycleState: LifecycleState;
  associatedLinks: AssociatedPlanBuildLink[];
  terminal: boolean;
}

export interface PlanEligibilityProjection {
  planEligible: boolean;
  planEligibilityReasonCode?: LifecycleReasonCode | string;
  planEligibilityReasonMessage?: string;
  planEligibilityLinks?: AssociatedPlanBuildLink[];
}

export const TERMINAL_SESSION_STATUSES = ['abandoned', 'canceled', 'cancelled', 'complete', 'completed', 'deleted', 'done', 'merged', 'shipped', 'superseded'] as const;
const TERMINAL_SESSION_STATUS_SET = new Set<string>(TERMINAL_SESSION_STATUSES);
const TERMINAL_PLANNING_TASK_STATUSES = new Set(['applied', 'dismissed', 'failed', 'cancelled', 'canceled', 'completed', 'done']);
const TERMINAL_BUILD_STATUSES = new Set(['completed', 'cancelled', 'canceled', 'skipped']);
const CURRENT_RESULT_STATES = new Set(['failed', 'partial', 'shipped', 'merged']);
const ACTIVE_PLANNING_TASK_STATUSES = new Set(['queued', 'running', 'active', 'in-progress']);

export function normalizePlanningStatus(status: string | undefined | null): string | undefined {
  const normalized = status?.trim().toLowerCase();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

export function isTerminalSessionPlanStatus(status: string | undefined | null): boolean {
  const normalized = normalizePlanningStatus(status);
  return normalized !== undefined && TERMINAL_SESSION_STATUS_SET.has(normalized);
}

export function isLiveSessionPlanStatus(status: string | undefined | null): boolean {
  return !isTerminalSessionPlanStatus(status);
}

export function isTerminalPlanningTaskStatus(status: string | undefined | null): boolean {
  const normalized = normalizePlanningStatus(status);
  return normalized !== undefined && TERMINAL_PLANNING_TASK_STATUSES.has(normalized);
}

export function isActivePlanningTaskStatus(status: string | undefined | null): boolean {
  const normalized = normalizePlanningStatus(status);
  return normalized !== undefined && ACTIVE_PLANNING_TASK_STATUSES.has(normalized) && !isTerminalPlanningTaskStatus(normalized);
}

export function isTerminalBuildStatus(status: string | undefined | null): boolean {
  const normalized = normalizePlanningStatus(status);
  return normalized !== undefined && TERMINAL_BUILD_STATUSES.has(normalized);
}

export function isCurrentResultLifecycleState(state: string | undefined | null): state is 'failed' | 'partial' | 'shipped' | 'merged' {
  return typeof state === 'string' && CURRENT_RESULT_STATES.has(state);
}

export function resultReasonCode(state: string): LifecycleReasonCode {
  if (state === 'failed') return 'failed-result';
  if (state === 'partial') return 'partial-plan';
  if (state === 'merged') return 'merged-result';
  return 'shipped-result';
}

export function liveSessionPlanReasonCode(status: string | undefined | null): LifecycleReasonCode {
  return normalizePlanningStatus(status) === 'submitted' ? 'submitted-session-plan' : 'planned-session-plan';
}

export function liveSessionPlanLifecycleState(status: string | undefined | null): LifecycleState {
  return normalizePlanningStatus(status) === 'submitted' ? 'submitted' : 'planned';
}

export function isStalePlannedSessionPlanEvidence(input: { lifecycleState?: string; reasonCode?: string; evidenceKind?: string; session?: string }): boolean {
  return input.lifecycleState === 'planned' && (input.reasonCode === 'planned-session-plan' || input.evidenceKind === 'session-plan' || input.session !== undefined);
}

export function planEligibilityFromBlockers(itemId: string, blockers: readonly PlanningBlocker[], hasUnresolvedDependency = false): PlanEligibilityProjection {
  if (hasUnresolvedDependency) {
    return {
      planEligible: false,
      planEligibilityReasonCode: 'unresolved-dependency',
      planEligibilityReasonMessage: `Item ${itemId} has unresolved dependencies.`,
      planEligibilityLinks: [],
    };
  }
  const blocker = blockers[0];
  if (blocker === undefined) return { planEligible: true };
  return {
    planEligible: false,
    planEligibilityReasonCode: blocker.reasonCode,
    planEligibilityReasonMessage: `Item ${itemId} is covered by ${blocker.reasonCode}.`,
    planEligibilityLinks: blocker.associatedLinks,
  };
}
