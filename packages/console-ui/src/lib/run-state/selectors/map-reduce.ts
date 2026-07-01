/**
 * Derived selectors for the map/reduce orchestration model.
 *
 * The reduced `RunState.mapReduce` carries structure + per-node status; per-node
 * cost/tokens live on `agentThreads` (keyed by `planId === atomId / nodeId`).
 * `buildMapReduceSummary` joins the two into the compact summary the Phase 2
 * card renders, and is pure so Storybook can fixture its output directly.
 */
import type {
  AgentThread,
  MapReduceOrchestration,
  PlanningMapReduceAtomReason,
  PlanningMapReduceAtomStatus,
  PlanningMapReduceReduceStatus,
} from '../types';

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
  /** Highest reduce level for presentation (1-indexed from the wire maxDepth). */
  maxLevel: number;
  /**
   * Lowest reduce level that still has a queued or running node (1-indexed for
   * display). Null once every reduce node is terminal (or there are no reduce
   * nodes yet).
   */
  currentLevel: number | null;
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
  let currentDepth: number | null = null;
  for (const nodeId of mapReduce.reduceOrder) {
    const node = mapReduce.reduceNodes[nodeId];
    if (!node) continue;
    reduceCounts.total += 1;
    reduceCounts[node.status] += 1;
    if ((node.status === 'queued' || node.status === 'running') && (currentDepth === null || node.depth < currentDepth)) {
      currentDepth = node.depth;
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
    maxLevel: mapReduce.maxDepth + 1,
    currentLevel: currentDepth === null ? null : currentDepth + 1,
    tokensIn,
    tokensOut,
    totalTokens: tokensIn + tokensOut,
    costUsd,
  };
}

// --- eforge:region board ---

/**
 * Per-node enrichment joined from the matching `agentThreads` entry
 * (`planId === atomId / nodeId`). Null on a node whose agent has not started
 * yet (e.g. queued atoms, or skipped atoms that never spawn an agent).
 */
export interface MapReduceBoardThread {
  model: string;
  totalTokens: number | null;
  durationMs: number | null;
  numTurns: number | null;
}

/** One node cell on the board: structure + status + the joined agent thread. */
export interface MapReduceBoardNode {
  /** atomId or nodeId — equal to the agent thread's `planId`. */
  id: string;
  kind: 'atom' | 'reduce';
  title: string;
  status: PlanningMapReduceAtomStatus | PlanningMapReduceReduceStatus;
  statusReason?: string;
  /** Atom decomposition reason; present only on `kind: 'atom'`. */
  reason?: PlanningMapReduceAtomReason;
  /** Reduce fan-in; present only on `kind: 'reduce'`. */
  inputAtomIds?: string[];
  inputNodeIds?: string[];
  /** Reduce depth from the wire event; present only on `kind: 'reduce'`. */
  depth?: number;
  thread: MapReduceBoardThread | null;
}

/**
 * A collapsible board section: the map-atoms group, or one reduce level.
 * Stacked top-to-bottom in the board (decision #5 — vertical sections, not columns).
 */
export interface MapReduceBoardSection {
  /** Stable key: `atoms` or `reduce-level-<depth>`. */
  key: string;
  title: string;
  kind: 'atoms' | 'reduce';
  /** Reduce depth from the wire event (0-indexed); null for the atoms section. */
  depth: number | null;
  nodes: MapReduceBoardNode[];
  /** True when any node in this section is queued or running — the active level. */
  active: boolean;
}

export interface MapReduceBoard {
  graphId: string;
  sections: MapReduceBoardSection[];
}

function joinThread(planId: string, byPlanId: Map<string, AgentThread>): MapReduceBoardThread | null {
  const thread = byPlanId.get(planId);
  if (!thread) return null;
  return {
    model: thread.model,
    totalTokens: thread.totalTokens,
    durationMs: thread.durationMs,
    numTurns: thread.numTurns,
  };
}

const ATOM_ACTIVE: ReadonlySet<PlanningMapReduceAtomStatus> = new Set(['queued', 'running']);
const REDUCE_ACTIVE: ReadonlySet<PlanningMapReduceReduceStatus> = new Set(['queued', 'running']);

/**
 * Builds the stage board: a `Map atoms` section followed by one `Reduce level N`
 * section per reduce depth (ascending), with each node enriched by its agent
 * thread. Pure, so Storybook fixtures the output directly. Per-node cost/tokens
 * come from `agentThreads`; structure and status come from `mapReduce`.
 */
export function buildMapReduceBoard(
  mapReduce: MapReduceOrchestration,
  agentThreads: AgentThread[],
): MapReduceBoard {
  const byPlanId = new Map<string, AgentThread>();
  for (const thread of agentThreads) {
    if (thread.planId !== undefined && !byPlanId.has(thread.planId)) {
      byPlanId.set(thread.planId, thread);
    }
  }

  const atomNodes: MapReduceBoardNode[] = [];
  let atomsActive = false;
  for (const atomId of mapReduce.atomOrder) {
    const atom = mapReduce.atoms[atomId];
    if (!atom) continue;
    if (ATOM_ACTIVE.has(atom.status)) atomsActive = true;
    atomNodes.push({
      id: atom.atomId,
      kind: 'atom',
      title: atom.title,
      status: atom.status,
      ...(atom.statusReason !== undefined ? { statusReason: atom.statusReason } : {}),
      reason: atom.reason,
      thread: joinThread(atom.atomId, byPlanId),
    });
  }

  const sections: MapReduceBoardSection[] = [
    { key: 'atoms', title: `Map atoms (${atomNodes.length})`, kind: 'atoms', depth: null, nodes: atomNodes, active: atomsActive },
  ];

  // Group reduce nodes by wire depth (ascending) into one section per display level.
  const byDepth = new Map<number, MapReduceBoardNode[]>();
  const activeByDepth = new Map<number, boolean>();
  for (const nodeId of mapReduce.reduceOrder) {
    const node = mapReduce.reduceNodes[nodeId];
    if (!node) continue;
    const bucket = byDepth.get(node.depth) ?? [];
    bucket.push({
      id: node.nodeId,
      kind: 'reduce',
      title: node.nodeId,
      status: node.status,
      ...(node.statusReason !== undefined ? { statusReason: node.statusReason } : {}),
      inputAtomIds: node.inputAtomIds,
      inputNodeIds: node.inputNodeIds,
      depth: node.depth,
      thread: joinThread(node.nodeId, byPlanId),
    });
    byDepth.set(node.depth, bucket);
    if (REDUCE_ACTIVE.has(node.status)) activeByDepth.set(node.depth, true);
  }

  for (const depth of [...byDepth.keys()].sort((a, b) => a - b)) {
    sections.push({
      key: `reduce-level-${depth}`,
      // 1-indexed display ("level 1" reads as the first level, not "0").
      title: `Reduce level ${depth + 1}`,
      kind: 'reduce',
      depth,
      nodes: byDepth.get(depth)!,
      active: activeByDepth.get(depth) === true,
    });
  }

  return { graphId: mapReduce.graphId, sections };
}

// --- eforge:endregion board ---
