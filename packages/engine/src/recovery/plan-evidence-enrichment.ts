import { DatabaseSync } from 'node:sqlite';
import type { PlanStatusMaps } from './terminal-failure-history.js';

interface SelectedRunForEvidence {
  id: string;
  startedAt: string;
}

interface PriorMergeRow {
  planId: string;
  data: string;
  timestamp: string;
}

function parseData(data: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(data);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

/**
 * Carry forward durable merged-plan evidence from older attempts for the same
 * set when the selected terminal run only contains validation/landing failure
 * evidence. This lets continue-repair seed already-merged dependencies instead
 * of restarting from plan 01 after a final acceptance/PRD validation failure.
 */
export function enrichPlanMapsWithPriorMergedEvidence(
  db: DatabaseSync,
  setName: string,
  selectedRun: SelectedRunForEvidence,
  maps: PlanStatusMaps,
): void {
  const selectedRunStatusByPlan = new Map(maps.planStatusMap);
  const selectedRunMergePlanIds = new Set(maps.mergeCompleteMap.keys());
  const rows = db.prepare(
    `SELECT e.plan_id AS planId, e.data, e.timestamp
     FROM events e
     JOIN runs r ON r.id = e.run_id
     WHERE r.plan_set = ?
       AND r.command IN ('build', 'resume', 'continue-repair')
       AND r.started_at <= ?
       AND r.id <> ?
       AND e.type = 'plan:merge:complete'
       AND e.plan_id IS NOT NULL
     ORDER BY r.started_at ASC, e.id ASC`,
  ).all(setName, selectedRun.startedAt, selectedRun.id) as unknown as PriorMergeRow[];

  for (const row of rows) {
    const selectedStatus = selectedRunStatusByPlan.get(row.planId);
    if (selectedStatus !== undefined && selectedStatus !== 'merged') continue;
    if (selectedRunMergePlanIds.has(row.planId)) continue;

    const parsed = parseData(row.data);
    maps.mergeCompleteMap.set(row.planId, {
      mergedAt: row.timestamp,
      ...(typeof parsed.commitSha === 'string' ? { commitSha: parsed.commitSha } : {}),
    });
    maps.planStatusMap.set(row.planId, 'merged');
    maps.planStatusTimestampMap.set(row.planId, row.timestamp);
  }
}
