/**
 * Builders for the `planning:map-reduce:*` orchestration events.
 *
 * The bounded planner compiler emits two structural snapshots (atom graph,
 * reduce tree) plus per-node lifecycle status events so consumers can render a
 * dedicated map/reduce orchestration view instead of one Gantt row per atom and
 * reducer. Wire shapes are owned by `@eforge-build/client`; these builders map
 * the engine-native graph/tree types onto those shapes and apply the same
 * bounded caps the client schema enforces (so emitted events always validate).
 */
import {
  PLANNING_MAP_REDUCE_MAX_ATOMS,
  PLANNING_MAP_REDUCE_MAX_EDGES,
  PLANNING_MAP_REDUCE_MAX_IDS,
  PLANNING_MAP_REDUCE_MAX_NODES,
  PLANNING_MAP_REDUCE_MAX_STRING_LENGTH,
  type PlanningMapReduceAtomStatus,
  type PlanningMapReduceReduceStatus,
} from '@eforge-build/client';
import type { EforgeEvent } from '../events.js';
import type { PlanningAtomGraph } from './atom-graph.js';
import type { PlanningReduceTree } from './reduce-contracts.js';

function cap(value: string): string {
  return value.length <= PLANNING_MAP_REDUCE_MAX_STRING_LENGTH
    ? value
    : `${value.slice(0, PLANNING_MAP_REDUCE_MAX_STRING_LENGTH - 1)}…`;
}

function capIds(ids: string[]): string[] {
  return ids.slice(0, PLANNING_MAP_REDUCE_MAX_IDS).map(cap);
}

/** Snapshot of the atom graph. Emitted once before the map phase runs. */
export function buildMapReduceAtomsEvent(graph: PlanningAtomGraph): EforgeEvent {
  const dependenciesByAtom = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const list = dependenciesByAtom.get(edge.toAtomId) ?? [];
    list.push(edge.fromAtomId);
    dependenciesByAtom.set(edge.toAtomId, list);
  }
  return {
    timestamp: new Date().toISOString(),
    type: 'planning:map-reduce:atoms',
    graphId: cap(graph.graphId),
    atomCount: graph.atoms.length,
    edgeCount: graph.edges.length,
    atoms: graph.atoms.slice(0, PLANNING_MAP_REDUCE_MAX_ATOMS).map((atom) => ({
      atomId: cap(atom.atomId),
      title: cap(atom.title),
      reason: atom.reason,
      criterionIds: capIds(atom.criterionIds),
      dependencyAtomIds: capIds(dependenciesByAtom.get(atom.atomId) ?? []),
    })),
    edges: graph.edges.slice(0, PLANNING_MAP_REDUCE_MAX_EDGES).map((edge) => ({
      fromAtomId: cap(edge.fromAtomId),
      toAtomId: cap(edge.toAtomId),
      reason: cap(edge.reason),
    })),
  };
}

/** A single atom lifecycle transition. */
export function buildMapReduceAtomStatusEvent(atomId: string, status: PlanningMapReduceAtomStatus, reason?: string): EforgeEvent {
  return {
    timestamp: new Date().toISOString(),
    type: 'planning:map-reduce:atom:status',
    atomId: cap(atomId),
    status,
    ...(reason ? { reason: cap(reason) } : {}),
  };
}

/** Snapshot of the reduce tree. Emitted once after the tree is built, before reducers run. */
export function buildMapReduceReduceTreeEvent(tree: PlanningReduceTree): EforgeEvent {
  const maxDepth = tree.nodes.reduce((max, node) => Math.max(max, node.depth), 0);
  return {
    timestamp: new Date().toISOString(),
    type: 'planning:map-reduce:reduce-tree',
    graphId: cap(tree.graphId),
    ...(tree.rootNodeId ? { rootNodeId: cap(tree.rootNodeId) } : {}),
    maxDepth,
    nodeCount: tree.nodes.length,
    nodes: tree.nodes.slice(0, PLANNING_MAP_REDUCE_MAX_NODES).map((node) => ({
      nodeId: cap(node.nodeId),
      depth: node.depth,
      inputAtomIds: capIds(node.inputAtomIds),
      inputNodeIds: capIds(node.inputNodeIds),
    })),
  };
}

/** A single reduce-node lifecycle transition. */
export function buildMapReduceReduceStatusEvent(nodeId: string, status: PlanningMapReduceReduceStatus, reason?: string): EforgeEvent {
  return {
    timestamp: new Date().toISOString(),
    type: 'planning:map-reduce:reduce:status',
    nodeId: cap(nodeId),
    status,
    ...(reason ? { reason: cap(reason) } : {}),
  };
}
