/**
 * Summary statistics selector for the run-state subsystem.
 *
 * Provides aggregated statistics (duration, token counts, cost, plan counts,
 * file changes, review issues) for display in SummaryCards from Console run state.
 */
import type { RunState } from '../types';
import { formatDuration } from '../format';

export function getSummaryStats(state: RunState): {
  duration: string;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheCreation: number;
  totalCost: number;
  plansCompleted: number;
  plansFailed: number;
  plansTotal: number;
  totalTurns: number;
  filesChanged: number;
  reviewCritical: number;
  reviewWarning: number;
} {
  const end = state.endTime ?? Date.now();
  const duration = state.startTime
    ? formatDuration(end - state.startTime)
    : '--';

  const statuses = Object.values(state.planStatuses);

  // Sum turns across finalized agent threads only (live agents tracked via liveAgentUsage overlay)
  const liveAgentIds = new Set(Object.keys(state.liveAgentUsage));
  const totalTurns = state.agentThreads.reduce((sum, t) => liveAgentIds.has(t.agentId) ? sum : sum + (t.numTurns ?? 0), 0);

  // Deduplicate file paths across plans using a Set
  const uniqueFiles = new Set<string>();
  for (const files of state.fileChanges.values()) {
    for (const f of files) {
      uniqueFiles.add(f);
    }
  }
  const filesChanged = uniqueFiles.size;

  // Count review issues by severity across all plans
  let reviewCritical = 0;
  let reviewWarning = 0;
  for (const issues of Object.values(state.reviewIssues)) {
    for (const issue of issues) {
      if (issue.severity === 'critical') reviewCritical++;
      else if (issue.severity === 'warning') reviewWarning++;
    }
  }

  // Overlay live agent usage (in-flight agents not yet finalized via agent:result)
  const liveValues = Object.values(state.liveAgentUsage);
  const liveExtra = liveValues.reduce(
    (acc, v) => {
      acc.input += v.input;
      acc.output += v.output;
      acc.cacheRead += v.cacheRead;
      acc.cacheCreation += v.cacheCreation;
      acc.cost += v.cost;
      acc.turns += v.turns;
      return acc;
    },
    { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, cost: 0, turns: 0 },
  );

  return {
    duration,
    tokensIn: state.tokensIn + liveExtra.input,
    tokensOut: state.tokensOut + liveExtra.output,
    cacheRead: state.cacheRead + liveExtra.cacheRead,
    cacheCreation: state.cacheCreation + liveExtra.cacheCreation,
    totalCost: state.totalCost + liveExtra.cost,
    plansCompleted: statuses.filter((s) => s === 'complete').length,
    plansFailed: statuses.filter((s) => s === 'failed').length,
    plansTotal: statuses.length,
    totalTurns: totalTurns + liveExtra.turns,
    filesChanged,
    reviewCritical,
    reviewWarning,
  };
}
