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

// --- eforge:region timeline ---

/** Lane key hosting all map-atom agent threads on the pipeline timeline. */
export const MAP_ATOMS_LANE_ID = 'map-atoms';

/** Lane key for one reduce level (0-indexed wire depth). */
export function reduceLaneId(depth: number): string {
  return `reduce-level-${depth}`;
}

/**
 * One synthetic pipeline lane grouping the map/reduce member threads: the
 * map-atoms lane, or one lane per reduce level. Threads inside a lane keep
 * their true start/end times; the pipeline's interval packing fans genuinely
 * concurrent members into stacked sub-rows within the single lane.
 */
export interface MapReduceTimelineLane {
  id: string;
  label: string;
  /** Status breakdown + skip/fail reasons, shown on the lane label tooltip. */
  tooltip: string[];
}

/** Per-agent bar presentation for a map/reduce member thread. */
export interface MapReduceThreadDisplay {
  /** Inline bar label (the member id) shown instead of the generic agent role. */
  barLabel: string;
  /** Headline tooltip lines: member title, then status/reason when notable. */
  tooltipLines: string[];
}

/**
 * The pipeline-timeline projection of a map/reduce run: which lane each member
 * (atomId / nodeId == agent `planId`) belongs to, the lane metadata, and the
 * per-agent bar display joined from `agentThreads`.
 */
export interface MapReduceTimelineModel {
  laneIdByMember: Record<string, string>;
  /** Grouped lanes in execution order: map atoms first, then reduce levels ascending. */
  lanes: MapReduceTimelineLane[];
  laneIds: ReadonlySet<string>;
  displayByAgentId: Record<string, MapReduceThreadDisplay>;
}

interface StatusTally {
  counts: Map<string, number>;
  reasons: string[];
}

function tallyStatus(tally: StatusTally, id: string, status: string, statusReason: string | undefined): void {
  tally.counts.set(status, (tally.counts.get(status) ?? 0) + 1);
  if (statusReason && (status === 'skipped' || status === 'failed' || status === 'incomplete')) {
    tally.reasons.push(`${id} ${status}: ${statusReason}`);
  }
}

const MAX_TOOLTIP_REASONS = 5;

function tallyTooltip(noun: string, total: number, tally: StatusTally): string[] {
  const parts: string[] = [];
  for (const status of ['running', 'completed', 'skipped', 'failed', 'incomplete', 'queued']) {
    const count = tally.counts.get(status) ?? 0;
    if (count > 0) parts.push(`${count} ${status === 'completed' ? 'done' : status}`);
  }
  const lines = [`${total} ${noun}${total === 1 ? '' : 's'}${parts.length > 0 ? `: ${parts.join(', ')}` : ''}`];
  lines.push(...tally.reasons.slice(0, MAX_TOOLTIP_REASONS));
  if (tally.reasons.length > MAX_TOOLTIP_REASONS) {
    lines.push(`…and ${tally.reasons.length - MAX_TOOLTIP_REASONS} more`);
  }
  return lines;
}

/**
 * Builds the timeline grouping for a map/reduce run: atoms collapse into one
 * `Map atoms` lane and reduce nodes into one lane per level, so the generic
 * pipeline renders the whole orchestration without a row per atom (the wall).
 * Pure; structure/status come from `mapReduce`, bar labels join `agentThreads`
 * by `planId`.
 */
export function buildMapReduceTimeline(
  mapReduce: MapReduceOrchestration,
  agentThreads: AgentThread[],
): MapReduceTimelineModel {
  const laneIdByMember: Record<string, string> = {};
  const lanes: MapReduceTimelineLane[] = [];

  const atomTally: StatusTally = { counts: new Map(), reasons: [] };
  const titleByMember = new Map<string, { title: string; status: string; statusReason?: string }>();
  for (const atomId of mapReduce.atomOrder) {
    const atom = mapReduce.atoms[atomId];
    if (!atom) continue;
    laneIdByMember[atomId] = MAP_ATOMS_LANE_ID;
    titleByMember.set(atomId, { title: atom.title, status: atom.status, statusReason: atom.statusReason });
    tallyStatus(atomTally, atomId, atom.status, atom.statusReason);
  }
  const atomTotal = Object.keys(laneIdByMember).length;
  if (atomTotal > 0) {
    lanes.push({
      id: MAP_ATOMS_LANE_ID,
      label: `Map atoms (${atomTotal})`,
      tooltip: tallyTooltip('map atom', atomTotal, atomTally),
    });
  }

  // One lane per reduce level, ascending. Wire depth is 0-indexed; display is
  // 1-indexed ("Reduce L1" reads as the first level).
  const depthTallies = new Map<number, { tally: StatusTally; total: number }>();
  for (const nodeId of mapReduce.reduceOrder) {
    const node = mapReduce.reduceNodes[nodeId];
    if (!node) continue;
    laneIdByMember[nodeId] = reduceLaneId(node.depth);
    titleByMember.set(nodeId, { title: nodeId, status: node.status, statusReason: node.statusReason });
    const entry = depthTallies.get(node.depth) ?? { tally: { counts: new Map(), reasons: [] }, total: 0 };
    entry.total += 1;
    tallyStatus(entry.tally, nodeId, node.status, node.statusReason);
    depthTallies.set(node.depth, entry);
  }
  const depths = [...depthTallies.keys()].sort((a, b) => a - b);
  for (const depth of depths) {
    const { tally, total } = depthTallies.get(depth)!;
    lanes.push({
      id: reduceLaneId(depth),
      label: depths.length === 1 ? `Reduce (${total})` : `Reduce L${depth + 1} (${total})`,
      tooltip: tallyTooltip('reduce node', total, tally),
    });
  }

  const displayByAgentId: Record<string, MapReduceThreadDisplay> = {};
  for (const thread of agentThreads) {
    if (thread.planId === undefined) continue;
    const member = titleByMember.get(thread.planId);
    if (!member) continue;
    const tooltipLines = [member.title === thread.planId ? member.title : `${thread.planId} — ${member.title}`];
    if (member.status !== 'completed' && member.status !== 'running') {
      tooltipLines.push(member.statusReason ? `${member.status}: ${member.statusReason}` : member.status);
    }
    displayByAgentId[thread.agentId] = { barLabel: thread.planId, tooltipLines };
  }

  return {
    laneIdByMember,
    lanes,
    laneIds: new Set(lanes.map((lane) => lane.id)),
    displayByAgentId,
  };
}

// --- eforge:endregion timeline ---
