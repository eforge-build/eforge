/**
 * Handlers for the `planning:map-reduce:*` orchestration events emitted by the
 * bounded planner compiler on large-plan runs.
 *
 * Two snapshot events seed the structure (`:atoms`, `:reduce-tree`); two tiny
 * status events fold per-node lifecycle transitions in place. Per-node
 * cost/tokens/model/duration are NOT carried here — they live on the matching
 * `agentThreads` entry (joined by `planId === atomId / nodeId`).
 *
 * Folding these into `RunState.mapReduce` is what flips `isMapReduceRun` true,
 * which both mounts the dedicated orchestration view and suppresses the
 * per-atom/per-reducer lane explosion in the generic pipeline.
 */
import type { MapReduceOrchestration, MapReduceAtomNode, MapReduceReduceNode } from '../types';
import type { EventHandler } from './handler-types';

/** Reduce-tree fields default to empty until the `:reduce-tree` snapshot arrives. */
function emptyReduceSlice(): Pick<MapReduceOrchestration, 'maxDepth' | 'nodeCount' | 'reduceNodes' | 'reduceOrder'> {
  return { maxDepth: 0, nodeCount: 0, reduceNodes: {}, reduceOrder: [] };
}

export const handleMapReduceAtoms: EventHandler<'planning:map-reduce:atoms'> = (event, state) => {
  const atoms: Record<string, MapReduceAtomNode> = {};
  const atomOrder: string[] = [];
  const prev = state.mapReduce;
  for (const atom of event.atoms) {
    // Preserve any already-folded lifecycle status if this snapshot is
    // redelivered, so a duplicate frame does not reset progress to queued.
    const priorStatus = prev?.atoms[atom.atomId];
    atoms[atom.atomId] = {
      atomId: atom.atomId,
      title: atom.title,
      reason: atom.reason,
      criterionIds: atom.criterionIds,
      dependencyAtomIds: atom.dependencyAtomIds,
      status: priorStatus?.status ?? 'queued',
      ...(priorStatus?.statusReason !== undefined ? { statusReason: priorStatus.statusReason } : {}),
    };
    atomOrder.push(atom.atomId);
  }

  const reduceSlice = prev
    ? { maxDepth: prev.maxDepth, nodeCount: prev.nodeCount, reduceNodes: prev.reduceNodes, reduceOrder: prev.reduceOrder }
    : emptyReduceSlice();

  const mapReduce: MapReduceOrchestration = {
    graphId: event.graphId,
    atomCount: event.atomCount,
    edgeCount: event.edgeCount,
    edges: event.edges,
    atoms,
    atomOrder,
    ...(prev?.rootNodeId !== undefined ? { rootNodeId: prev.rootNodeId } : {}),
    ...reduceSlice,
  };
  return { mapReduce };
};

export const handleMapReduceReduceTree: EventHandler<'planning:map-reduce:reduce-tree'> = (event, state) => {
  const reduceNodes: Record<string, MapReduceReduceNode> = {};
  const reduceOrder: string[] = [];
  const prev = state.mapReduce;
  for (const node of event.nodes) {
    // Preserve any already-folded lifecycle status if this snapshot is
    // redelivered, so a duplicate frame does not reset progress to queued.
    const priorStatus = prev?.reduceNodes[node.nodeId];
    reduceNodes[node.nodeId] = {
      nodeId: node.nodeId,
      depth: node.depth,
      inputAtomIds: node.inputAtomIds,
      inputNodeIds: node.inputNodeIds,
      status: priorStatus?.status ?? 'queued',
      ...(priorStatus?.statusReason !== undefined ? { statusReason: priorStatus.statusReason } : {}),
    };
    reduceOrder.push(node.nodeId);
  }

  const mapReduce: MapReduceOrchestration = {
    graphId: event.graphId,
    atomCount: prev?.atomCount ?? 0,
    edgeCount: prev?.edgeCount ?? 0,
    edges: prev?.edges ?? [],
    atoms: prev?.atoms ?? {},
    atomOrder: prev?.atomOrder ?? [],
    ...(event.rootNodeId !== undefined ? { rootNodeId: event.rootNodeId } : {}),
    maxDepth: event.maxDepth,
    nodeCount: event.nodeCount,
    reduceNodes,
    reduceOrder,
  };
  return { mapReduce };
};

export const handleMapReduceAtomStatus: EventHandler<'planning:map-reduce:atom:status'> = (event, state) => {
  const mr = state.mapReduce;
  const existing = mr?.atoms[event.atomId];
  if (!mr || !existing) return undefined;
  return {
    mapReduce: {
      ...mr,
      atoms: {
        ...mr.atoms,
        [event.atomId]: {
          ...existing,
          status: event.status,
          // `statusReason` is owned by the current status: set it from the event
          // (clearing any stale reason from a prior status, e.g. failed -> running retry).
          statusReason: event.reason,
        },
      },
    },
  };
};

export const handleMapReduceReduceStatus: EventHandler<'planning:map-reduce:reduce:status'> = (event, state) => {
  const mr = state.mapReduce;
  const existing = mr?.reduceNodes[event.nodeId];
  if (!mr || !existing) return undefined;
  return {
    mapReduce: {
      ...mr,
      reduceNodes: {
        ...mr.reduceNodes,
        [event.nodeId]: {
          ...existing,
          status: event.status,
          // `statusReason` is owned by the current status: set it from the event
          // (clearing any stale reason from a prior status).
          statusReason: event.reason,
        },
      },
    },
  };
};
