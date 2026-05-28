/**
 * Pure view selectors for the Plans workspace.
 */
import type { SessionPlanListEntryWire, SessionPlanDataWire } from '@eforge-build/client/browser';

/** Human-readable readiness label. */
export function readinessLabel(ready: boolean): string {
  return ready ? 'ready' : 'not ready';
}

/**
 * Select the default session to show when the list loads.
 * Returns the first plan's session ID, or null for an empty list.
 */
export function selectDefaultSession(plans: SessionPlanListEntryWire[]): string | null {
  return plans.length > 0 ? plans[0].session : null;
}

/** Count required, optional, and skipped dimensions for a plan. */
export interface DimensionCounts {
  required: number;
  optional: number;
  skipped: number;
}

export function selectDimensionCounts(plan: SessionPlanDataWire): DimensionCounts {
  return {
    required: plan.required_dimensions.length,
    optional: plan.optional_dimensions.length,
    skipped: plan.skipped_dimensions.length,
  };
}

/**
 * Returns whether a session is still present in the new plan list.
 * Used when re-fetching to decide whether to preserve the current selection.
 */
export function isSessionInList(
  session: string | null,
  plans: SessionPlanListEntryWire[],
): boolean {
  if (!session) return false;
  return plans.some((p) => p.session === session);
}
