import * as React from 'react';
import { useOptionalRouter } from '@/router';
import type { Artifact } from '@/types';
import { planDisplayTitle } from './plan-title';

// A backlog item and a plan are linked through the plan's source refs
// (`sourceItemIds`). The plan detail already shows that linkage one-way; these
// helpers make it bidirectional and navigable so a plan's source chips jump to
// the board card, and a board card knows which plan(s) converged on it.

// Selection keys in the `plan` query param are prefixed by kind: `plan:<session>`
// for a promoted/session plan artifact and `draft:<unitId>` for an in-memory
// draft plan unit. Centralize the prefixes so the convention has one source.
const DRAFT_PREFIX = 'draft:';
const PLAN_PREFIX = 'plan:';

/** Selection key for a draft plan unit, e.g. `draft:<unitId>`. */
export function draftKey(unitId: string): string {
  return `${DRAFT_PREFIX}${unitId}`;
}

/** Selection key for a session plan, e.g. `plan:<session>`. */
export function planKey(session: string): string {
  return `${PLAN_PREFIX}${session}`;
}

/** Returns the draft unit id when `key` is a draft selection, otherwise null. */
export function parseDraftKey(key: string): string | null {
  return key.startsWith(DRAFT_PREFIX) ? key.slice(DRAFT_PREFIX.length) : null;
}

/** Lightweight reference to a plan that covers a backlog item. */
export interface PlanLink {
  /** Artifact key, e.g. `plan:2026-06-19-recovery-console-control`. */
  key: string;
  title: string;
  status?: string;
  lifecycleState?: string;
}

function planLink(artifact: Artifact): PlanLink {
  return {
    key: artifact.key,
    title: planDisplayTitle(artifact.title, artifact.session ?? artifact.key),
    status: artifact.status,
    lifecycleState: artifact.lifecycleState,
  };
}

/** Backlog item ids a plan names as its source, tolerating both ref shapes. */
export function sourceItemIds(artifact: Artifact): string[] {
  return artifact.sourceRefs?.sourceItemIds ?? artifact.sourceRefs?.itemIds ?? [];
}

/** Source epic ids for a plan, tolerating both ref shapes. */
export function sourceEpicIds(artifact: Artifact): string[] {
  return artifact.sourceRefs?.sourceEpicIds ?? artifact.sourceRefs?.epicIds ?? [];
}

/** A plan's build/lifecycle state, preferring the lifecycle projection. */
export function planBuildState(artifact: Artifact): string | undefined {
  return artifact.lifecycleState ?? artifact.status;
}

/**
 * Index every backlog item id to the plans that name it as a source. One plan
 * covers many items and (in principle) one item can be carried by more than one
 * plan, so the value is a list.
 */
export function buildItemPlanIndex(artifacts: Artifact[]): Map<string, PlanLink[]> {
  const index = new Map<string, PlanLink[]>();
  for (const artifact of artifacts) {
    if (artifact.kind !== 'plan') continue;
    const link = planLink(artifact);
    for (const itemId of sourceItemIds(artifact)) {
      const existing = index.get(itemId);
      if (existing) existing.push(link);
      else index.set(itemId, [link]);
    }
  }
  return index;
}

/**
 * Cross-navigation between the two ends of a plan/item link, expressed as URL
 * query mutations so the destination is shareable and survives reload. Opening
 * an item drops focus back to the board (its default) and points the item
 * drawer at it; opening a plan switches to the Plans focus and selects it.
 */
export function usePlanNavigation() {
  const router = useOptionalRouter();
  return React.useMemo(
    () => ({
      openItem: (itemId: string) =>
        router?.setQuery((params) => {
          params.delete('focus');
          params.set('item', itemId);
        }),
      openPlan: (key: string) =>
        router?.setQuery((params) => {
          params.set('focus', 'plans');
          params.set('plan', key);
        }),
    }),
    [router],
  );
}
