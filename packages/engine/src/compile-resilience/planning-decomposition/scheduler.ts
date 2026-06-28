import { PLANNING_DECOMPOSITION_MAX_BLOCKED_PAIRS, PLANNING_DECOMPOSITION_MAX_UNITS, type PlanningScheduleDecision } from '@eforge-build/client';
import type { SelectReadyPlanningBatchInput, PlanningDecompositionUnit } from '../planning-decomposition.js';

export function selectBatch(input: SelectReadyPlanningBatchInput): PlanningScheduleDecision {
  const completed = lifecycleSet(input.graph.units, 'completed', input.completedUnitIds);
  const failed = lifecycleSet(input.graph.units, 'failed', input.failedUnitIds, completed);
  const running = lifecycleSet(input.graph.units, 'running', input.runningUnitIds, completed, failed);
  const skipped = lifecycleSet(input.graph.units, 'skipped', input.skippedUnitIds, completed, failed, running);
  const requestedParallelism = input.parallelism ?? input.graph.parallelism;
  const resolvedParallelism = Math.max(1, Math.min(Math.max(1, requestedParallelism), Math.max(1, input.graph.parallelism)));
  const parallelism = Math.max(resolvedParallelism, running.size);
  const capacity = Math.max(0, parallelism - running.size);
  const selected: string[] = [];
  const waiting = new Set<string>();
  const ready: string[] = [];
  const blockedPairs: Array<{ unitId: string; blockedByUnitId: string; reason?: string }> = [];
  const waitingReasons = new Map<string, string[]>();
  const units = input.graph.units.filter((u) => !completed.has(u.unitId) && !running.has(u.unitId) && !failed.has(u.unitId) && !skipped.has(u.unitId)).sort((a, b) => a.unitId.localeCompare(b.unitId));
  const byId = new Map(input.graph.units.map((u) => [u.unitId, u]));

  for (const unit of units) {
    const depReason = dependencyReason(unit, completed, failed, skipped);
    if (depReason) { addWaiting(unit.unitId, depReason, waiting, waitingReasons); continue; }
    ready.push(unit.unitId);
    const blocker = findConstraintBlocker(unit, [...running, ...selected], byId);
    if (blocker) {
      addWaiting(unit.unitId, blocker.reason, waiting, waitingReasons);
      blockedPairs.push({ unitId: unit.unitId, blockedByUnitId: blocker.blockedByUnitId, reason: blocker.reason });
      continue;
    }
    if (selected.length >= capacity) {
      addWaiting(unit.unitId, `capacity:parallelism-${parallelism}`, waiting, waitingReasons);
      continue;
    }
    selected.push(unit.unitId);
  }

  return {
    readyUnitIds: capList(ready),
    runningUnitIds: capList([...running].sort()),
    waitingUnitIds: capList([...waiting].sort()),
    waitingReasons: capList([...waitingReasons.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([unitId, reasons]) => ({ unitId, reasons: capList(reasons) }))),
    selectedBatchUnitIds: capList(selected),
    parallelism,
    blockedPairs: capList(blockedPairs.sort((a, b) => `${a.unitId}:${a.blockedByUnitId}`.localeCompare(`${b.unitId}:${b.blockedByUnitId}`)), PLANNING_DECOMPOSITION_MAX_BLOCKED_PAIRS),
  };
}

function lifecycleSet(units: PlanningDecompositionUnit[], status: PlanningDecompositionUnit['status'], override?: Iterable<string>, ...remove: Array<Set<string>>): Set<string> {
  const ids = new Set(override ? [...override] : units.filter((u) => u.status === status).map((u) => u.unitId));
  for (const set of remove) for (const id of set) ids.delete(id);
  return ids;
}

function capList<T>(items: T[], max = PLANNING_DECOMPOSITION_MAX_UNITS): T[] {
  return items.slice(0, max);
}

function dependencyReason(unit: PlanningDecompositionUnit, completed: Set<string>, failed: Set<string>, skipped: Set<string>): string | undefined {
  for (const dep of unit.dependsOn) {
    if (failed.has(dep)) return `dependency-failed:${dep}`;
    if (skipped.has(dep)) return `dependency-skipped:${dep}`;
    if (!completed.has(dep)) return `dependency:${dep}`;
  }
  return undefined;
}

function findConstraintBlocker(unit: PlanningDecompositionUnit, blockerIds: string[], byId: Map<string, PlanningDecompositionUnit>): { blockedByUnitId: string; reason: string } | undefined {
  for (const id of blockerIds.sort()) {
    const blocker = byId.get(id);
    if (!blocker) continue;
    const iface = unit.interfaceConstraints.find((key) => blocker.interfaceConstraints.includes(key));
    if (iface) return { blockedByUnitId: id, reason: `interface-contract:${iface}` };
    const shared = unit.sharedFileConstraints.find((key) => blocker.sharedFileConstraints.includes(key));
    if (shared) return { blockedByUnitId: id, reason: `shared-file:${shared}` };
  }
  return undefined;
}

function addWaiting(id: string, reason: string, waiting: Set<string>, reasons: Map<string, string[]>): void {
  waiting.add(id);
  reasons.set(id, [...(reasons.get(id) ?? []), reason].sort());
}

