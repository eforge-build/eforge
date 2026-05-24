import type { RunState } from '@/lib/reducer';
import type { StackLayerWire } from '@/lib/types';

const RUN_LEVEL_DECISION_KEY = '__run__';

function addId(ids: Set<string>, value: unknown): void {
  if (typeof value === 'string' && value.trim().length > 0) {
    ids.add(value);
  }
}

function collectRunPlanIds(runState: RunState): Set<string> {
  const ids = new Set<string>();

  for (const id of Object.keys(runState.planStatuses)) addId(ids, id);
  for (const id of Object.keys(runState.reviewIssues)) addId(ids, id);
  for (const id of Object.keys(runState.reviewIssuesByPerspective)) addId(ids, id);
  for (const id of Object.keys(runState.perspectiveErrors)) addId(ids, id);
  for (const id of Object.keys(runState.mergeCommits)) addId(ids, id);
  for (const id of Object.keys(runState.decisions)) {
    if (id !== RUN_LEVEL_DECISION_KEY) addId(ids, id);
  }

  for (const thread of runState.agentThreads) addId(ids, thread.planId);

  for (const plan of runState.earlyOrchestration?.plans ?? []) {
    addId(ids, plan.id);
  }

  for (const { event } of runState.events) {
    if ('planId' in event) addId(ids, event.planId);

    if (event.type === 'planning:complete') {
      for (const plan of event.plans) addId(ids, plan.id);
    } else if (event.type === 'stack:layer:recorded') {
      addId(ids, event.prdId);
      addId(ids, event.parentPrdId);
    } else if (event.type === 'stack:landing:update') {
      addId(ids, event.prdId);
    }
  }

  return ids;
}

/**
 * Stack layer state is daemon-wide, while the monitor detail pane shows one
 * selected build session. Only render layers that are referenced by the current
 * session's plan IDs so a failed landing for an older build does not appear on
 * every build detail view.
 */
export function selectStackLayersForRun(
  layers: StackLayerWire[],
  runState: RunState,
): StackLayerWire[] {
  const runPlanIds = collectRunPlanIds(runState);
  if (runPlanIds.size === 0) return [];

  return layers.filter(
    (layer) => runPlanIds.has(layer.prdId) || (layer.parentPrdId ? runPlanIds.has(layer.parentPrdId) : false),
  );
}
