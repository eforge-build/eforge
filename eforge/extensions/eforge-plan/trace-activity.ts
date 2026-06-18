import { createSessionPlanningWorkflowAdapter } from '@eforge-build/input';
import type { TraceSummary } from './backlog-domain.js';
import type { TraceSidecar } from './schema.js';
import type { TraceActivityContext } from './lifecycle-projection.js';
import { listTraceSidecars, summarizeTrace } from './trace-store.js';

const INACTIVE_SESSION_PLAN_STATUSES = new Set(['submitted', 'abandoned']);

export async function loadTraceActivityContext(cwd: string): Promise<TraceActivityContext> {
  try {
    const plans = await createSessionPlanningWorkflowAdapter().flat.list({ cwd, includeSubmitted: false });
    const liveEditableSessionIds = new Set<string>();
    for (const plan of plans) {
      if (typeof plan.session !== 'string' || plan.session.length === 0) continue;
      if (typeof plan.status === 'string' && INACTIVE_SESSION_PLAN_STATUSES.has(plan.status)) continue;
      liveEditableSessionIds.add(plan.session);
    }
    return { liveEditableSessionIds };
  } catch {
    return { liveEditableSessionIds: new Set() };
  }
}

export async function summarizeProjectTraces(cwd: string, traces?: readonly TraceSidecar[]): Promise<TraceSummary[]> {
  const [context, loadedTraces] = await Promise.all([
    loadTraceActivityContext(cwd),
    traces === undefined ? listTraceSidecars(cwd) : Promise.resolve([...traces]),
  ]);
  return loadedTraces
    .flatMap((trace) => summarizeTrace(trace, context) ?? [])
    .sort((left, right) => left.itemId.localeCompare(right.itemId));
}
