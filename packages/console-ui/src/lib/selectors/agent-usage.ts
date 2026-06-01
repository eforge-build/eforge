/**
 * Per-agent token usage selector for the active-build "tokens by agent" chart.
 *
 * Aggregates by friendly role name (e.g. "builder", "evaluator") across ALL
 * agents that have run, not just the live one: `agentThreads` retains finalized
 * totals for completed agents, while `liveAgentUsage` (which the reducer
 * deletes on agent stop/result) supplies fresher numbers for any still-running
 * agent.
 */
import type { RunState } from '@/lib/run-state';

export interface AgentUsageEntry {
  agent: string;
  tokens: number;
}

export function selectAgentUsageByRole(rs: RunState): AgentUsageEntry[] {
  const tokensByRole = new Map<string, number>();
  const seenAgentIds = new Set<string>();

  for (const thread of rs.agentThreads) {
    seenAgentIds.add(thread.agentId);
    const live = rs.liveAgentUsage[thread.agentId];
    const tokens = live
      ? live.input + live.output
      : thread.totalTokens ?? (thread.inputTokens ?? 0) + (thread.outputTokens ?? 0);
    tokensByRole.set(thread.agent, (tokensByRole.get(thread.agent) ?? 0) + tokens);
  }

  // Include any live agent that has no thread entry yet (keyed by id).
  for (const [agentId, u] of Object.entries(rs.liveAgentUsage)) {
    if (seenAgentIds.has(agentId)) continue;
    tokensByRole.set(agentId, (tokensByRole.get(agentId) ?? 0) + u.input + u.output);
  }

  return [...tokensByRole.entries()]
    .map(([agent, tokens]) => ({ agent, tokens }))
    .filter((entry) => entry.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens);
}
