/**
 * Single ordered lane registry for the console-ui pipeline swimlanes.
 *
 * The agent-event `planId` IS the lane key. Phase lanes (`planning`,
 * `validation`, `gap-close`, `final-validation`) are orchestrator-assigned
 * phases that do not appear in earlyOrchestration.plans. Plan lanes
 * (`plan-NN-*`) are the per-PRD build lanes declared by the orchestrator.
 *
 * This module is the single source of truth for lane display labels and
 * ordering. Consumers (plan-progress selectors, pipeline-colors, thread-pipeline)
 * delegate to `laneLabel()` and `laneOrder()` instead of maintaining local
 * label/order tables.
 */

export interface LaneEntry {
  /** The lane key (matches agent-event `planId`). */
  id: string;
  /** Human-readable display label. */
  label: string;
  /** Sort order. Lower values render first. Plan lanes share order 1 and are sub-sorted by plan position. */
  order: number;
  /** 'phase' for orchestrator lifecycle lanes, 'plan' for per-PRD build lanes. */
  kind: 'phase' | 'plan';
}

/**
 * Ordered registry of known phase lanes. Plan lanes (kind 'plan') are dynamic
 * and handled by the `plan-NN` fallback in `laneLabel` / `laneOrder`.
 */
export const LANE_REGISTRY: readonly LaneEntry[] = [
  { id: 'planning',          label: 'Planning',          order: 0, kind: 'phase' },
  // plan lanes occupy order 1 (dynamic, not listed here)
  { id: 'validation',        label: 'Validation',        order: 2, kind: 'phase' },
  { id: 'gap-close',         label: 'Gap Close',         order: 3, kind: 'phase' },
  { id: 'final-validation',  label: 'Final Validation',  order: 4, kind: 'phase' },
] as const;

const registryById = new Map<string, LaneEntry>(
  LANE_REGISTRY.map((entry) => [entry.id, entry]),
);

export function isRegisteredPhaseLane(id: string): boolean {
  return registryById.get(id)?.kind === 'phase';
}

/**
 * Returns the human-readable display label for a lane key.
 *
 * Known phase lanes return their registered label. `plan-NN-*` ids return
 * "Plan NN". All other ids are returned verbatim.
 */
export function laneLabel(id: string): string {
  const entry = registryById.get(id);
  if (entry) return entry.label;
  const match = id.match(/^plan-(\d+)/);
  if (match) return `Plan ${match[1]}`;
  return id;
}

/**
 * Returns the sort order for a lane key.
 *
 * Known phase lanes return their registered order. `plan-NN-*` ids return 1
 * (the plan tier). All other unrecognised ids return 1 (plan tier) as well,
 * so unknown lanes sort alongside plans rather than at the extremes.
 */
export function laneOrder(id: string): number {
  const entry = registryById.get(id);
  if (entry) return entry.order;
  return 1; // plan-NN and unknown lanes
}
