/**
 * Derived selectors for the map/reduce orchestration model.
 *
 * The reduced `RunState.mapReduce` carries structure + per-node status; per-node
 * cost/tokens live on `agentThreads` (keyed by `planId === atomId / nodeId`).
 * `buildMapReduceSummary` joins the two into the compact summary the Phase 2
 * card renders, and is pure so Storybook can fixture its output directly.
 */
import type { AgentThread, MapReduceOrchestration } from '../types';

export interface MapReduceAtomCounts {
  total: number;
  queued: number;
  running: number;
  completed: number;
  skipped: number;
  failed: number;
}

export interface MapReduceReduceCounts {
  total: number;
  queued: number;
  running: number;
  completed: number;
  failed: number;
  incomplete: number;
}

export interface MapReduceSummary {
  graphId: string;
  atomCounts: MapReduceAtomCounts;
  reduceCounts: MapReduceReduceCounts;
  maxDepth: number;
  /**
   * Lowest reduce depth that still has a queued or running node, i.e. the wave
   * currently in flight. Null once every reduce node is terminal (or there are
   * no reduce nodes yet).
   */
  currentWave: number | null;
  tokensIn: number;
  tokensOut: number;
  totalTokens: number;
  costUsd: number;
}

function emptyAtomCounts(): MapReduceAtomCounts {
  return { total: 0, queued: 0, running: 0, completed: 0, skipped: 0, failed: 0 };
}

function emptyReduceCounts(): MapReduceReduceCounts {
  return { total: 0, queued: 0, running: 0, completed: 0, failed: 0, incomplete: 0 };
}

export function buildMapReduceSummary(
  mapReduce: MapReduceOrchestration,
  agentThreads: AgentThread[],
): MapReduceSummary {
  const atomCounts = emptyAtomCounts();
  for (const atomId of mapReduce.atomOrder) {
    const atom = mapReduce.atoms[atomId];
    if (!atom) continue;
    atomCounts.total += 1;
    atomCounts[atom.status] += 1;
  }

  const reduceCounts = emptyReduceCounts();
  let currentWave: number | null = null;
  for (const nodeId of mapReduce.reduceOrder) {
    const node = mapReduce.reduceNodes[nodeId];
    if (!node) continue;
    reduceCounts.total += 1;
    reduceCounts[node.status] += 1;
    if ((node.status === 'queued' || node.status === 'running') && (currentWave === null || node.depth < currentWave)) {
      currentWave = node.depth;
    }
  }

  // Join cost/tokens from the agent threads whose planId is one of our nodes.
  const memberIds = new Set<string>([...mapReduce.atomOrder, ...mapReduce.reduceOrder]);
  let tokensIn = 0;
  let tokensOut = 0;
  let costUsd = 0;
  for (const thread of agentThreads) {
    if (thread.planId === undefined || !memberIds.has(thread.planId)) continue;
    tokensIn += thread.inputTokens ?? 0;
    tokensOut += thread.outputTokens ?? 0;
    costUsd += thread.costUsd ?? 0;
  }

  return {
    graphId: mapReduce.graphId,
    atomCounts,
    reduceCounts,
    maxDepth: mapReduce.maxDepth,
    currentWave,
    tokensIn,
    tokensOut,
    totalTokens: tokensIn + tokensOut,
    costUsd,
  };
}
