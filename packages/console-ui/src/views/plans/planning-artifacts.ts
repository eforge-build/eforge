/**
 * Local list model for the Planning Workspace.
 *
 * The sidebar mixes two read-only artifact kinds: flat session plans and grouped
 * session plan sets. They are modeled as a discriminated union keyed by a stable
 * selection key so flat-plan sessions and plan-set directory ids cannot collide.
 */
import type {
  SessionPlanListEntryWire,
  SessionPlanSetListEntryWire,
} from '@eforge-build/client/browser';

export type PlanningArtifactKind = 'plan' | 'plan-set';

export interface FlatPlanArtifact {
  kind: 'plan';
  /** Stable selection key, e.g. `plan:<session>`. */
  key: string;
  entry: SessionPlanListEntryWire;
}

export interface PlanSetArtifact {
  kind: 'plan-set';
  /** Stable selection key, e.g. `plan-set:<planSetId>`. */
  key: string;
  entry: SessionPlanSetListEntryWire;
}

export type PlanningArtifactListItem = FlatPlanArtifact | PlanSetArtifact;

/** Build the selection key for a flat session plan. */
export function flatPlanKey(session: string): string {
  return `plan:${session}`;
}

/** Build the selection key for a session plan set. */
export function planSetKey(planSetId: string): string {
  return `plan-set:${planSetId}`;
}

/** Derive the artifact kind from a selection key, or null if unrecognized. */
export function artifactKindFromKey(key: string | null): PlanningArtifactKind | null {
  if (!key) return null;
  if (key.startsWith('plan-set:')) return 'plan-set';
  if (key.startsWith('plan:')) return 'plan';
  return null;
}

/** Extract the raw id (session or planSetId) encoded in a selection key. */
export function artifactIdFromKey(key: string | null): string | null {
  if (!key) return null;
  if (key.startsWith('plan-set:')) return key.slice('plan-set:'.length);
  if (key.startsWith('plan:')) return key.slice('plan:'.length);
  return null;
}

/** Wrap a flat session plan list entry as an artifact list item. */
export function toFlatPlanArtifact(entry: SessionPlanListEntryWire): FlatPlanArtifact {
  return { kind: 'plan', key: flatPlanKey(entry.session), entry };
}

/** Wrap a session plan set list entry as an artifact list item. */
export function toPlanSetArtifact(entry: SessionPlanSetListEntryWire): PlanSetArtifact {
  return { kind: 'plan-set', key: planSetKey(entry.planSetId), entry };
}

/**
 * Combine flat session plans and session plan sets into a single ordered list.
 * Flat plans are listed first to preserve the existing default selection.
 */
export function combineArtifacts(
  plans: SessionPlanListEntryWire[],
  planSets: SessionPlanSetListEntryWire[],
): PlanningArtifactListItem[] {
  return [...plans.map(toFlatPlanArtifact), ...planSets.map(toPlanSetArtifact)];
}

/** Select the default artifact key when the list loads, or null when empty. */
export function selectDefaultArtifactKey(items: PlanningArtifactListItem[]): string | null {
  return items.length > 0 ? items[0].key : null;
}

/** Whether the given key is still present in the artifact list. */
export function isArtifactKeyInList(
  key: string | null,
  items: PlanningArtifactListItem[],
): boolean {
  if (!key) return false;
  return items.some((item) => item.key === key);
}

/** Find the artifact list item matching a selection key. */
export function findArtifact(
  key: string | null,
  items: PlanningArtifactListItem[],
): PlanningArtifactListItem | undefined {
  if (!key) return undefined;
  return items.find((item) => item.key === key);
}
