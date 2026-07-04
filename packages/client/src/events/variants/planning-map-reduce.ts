/**
 * Map/reduce orchestration event variants.
 *
 * Emitted only by the bounded planner compiler when a large input plan is
 * compiled via the map/reduce strategy. Two snapshot events carry the
 * orchestration structure (known up front): `planning:map-reduce:atoms` (the
 * atom graph) and `planning:map-reduce:reduce-tree` (the hierarchical reduce
 * tree). Two tiny status events carry live per-node lifecycle transitions.
 *
 * Per-node cost/tokens/model/duration are NOT duplicated here — consumers join
 * each atom/node to its existing `agent:*` thread by `planId` (which equals the
 * atomId or reduce nodeId). See docs scratch PRD "Map/Reduce Orchestration View".
 */
import { Type, type Static } from '@sinclair/typebox';

export const PLANNING_MAP_REDUCE_MAX_STRING_LENGTH = 2_000;
export const PLANNING_MAP_REDUCE_MAX_ATOMS = 1_024;
export const PLANNING_MAP_REDUCE_MAX_EDGES = 2_048;
export const PLANNING_MAP_REDUCE_MAX_NODES = 1_024;
export const PLANNING_MAP_REDUCE_MAX_IDS = 128;

const BoundedStringSchema = Type.String({ maxLength: PLANNING_MAP_REDUCE_MAX_STRING_LENGTH });
const BoundedIdListSchema = Type.Array(BoundedStringSchema, { maxItems: PLANNING_MAP_REDUCE_MAX_IDS });
const NonNegativeIntegerSchema = Type.Integer({ minimum: 0 });

export const PLANNING_MAP_REDUCE_EVENT_TYPES = [
  'planning:map-reduce:atoms',
  'planning:map-reduce:atom:status',
  'planning:map-reduce:reduce-tree',
  'planning:map-reduce:reduce:status',
] as const;

export const PlanningMapReduceAtomReasonSchema = Type.Union([
  Type.Literal('foundation-contract'),
  Type.Literal('subsystem'),
  Type.Literal('oversized-criterion'),
  Type.Literal('general'),
  Type.Literal('rescope-split'),
]);

export const PlanningMapReduceAtomSchema = Type.Object({
  atomId: BoundedStringSchema,
  title: BoundedStringSchema,
  reason: PlanningMapReduceAtomReasonSchema,
  criterionIds: BoundedIdListSchema,
  dependencyAtomIds: BoundedIdListSchema,
}, { additionalProperties: false });

export const PlanningMapReduceAtomEdgeSchema = Type.Object({
  fromAtomId: BoundedStringSchema,
  toAtomId: BoundedStringSchema,
  reason: BoundedStringSchema,
}, { additionalProperties: false });

export const PlanningMapReduceAtomStatusSchema = Type.Union([
  Type.Literal('queued'),
  Type.Literal('running'),
  Type.Literal('completed'),
  Type.Literal('skipped'),
  Type.Literal('failed'),
]);

export const PlanningMapReduceReduceNodeSchema = Type.Object({
  nodeId: BoundedStringSchema,
  depth: NonNegativeIntegerSchema,
  inputAtomIds: BoundedIdListSchema,
  inputNodeIds: BoundedIdListSchema,
}, { additionalProperties: false });

export const PlanningMapReduceReduceStatusSchema = Type.Union([
  Type.Literal('queued'),
  Type.Literal('running'),
  Type.Literal('completed'),
  Type.Literal('failed'),
  Type.Literal('incomplete'),
]);

export const planningMapReduceEventVariants = [
  // Atom-graph snapshot: emitted once before the map phase runs.
  Type.Object({
    type: Type.Literal('planning:map-reduce:atoms'),
    graphId: BoundedStringSchema,
    atomCount: NonNegativeIntegerSchema,
    edgeCount: NonNegativeIntegerSchema,
    atoms: Type.Array(PlanningMapReduceAtomSchema, { maxItems: PLANNING_MAP_REDUCE_MAX_ATOMS }),
    edges: Type.Array(PlanningMapReduceAtomEdgeSchema, { maxItems: PLANNING_MAP_REDUCE_MAX_EDGES }),
  }),
  // Per-atom lifecycle transition.
  Type.Object({
    type: Type.Literal('planning:map-reduce:atom:status'),
    atomId: BoundedStringSchema,
    status: PlanningMapReduceAtomStatusSchema,
    reason: Type.Optional(BoundedStringSchema),
  }),
  // Reduce-tree snapshot: emitted once after the tree is built, before reducers run.
  Type.Object({
    type: Type.Literal('planning:map-reduce:reduce-tree'),
    graphId: BoundedStringSchema,
    rootNodeId: Type.Optional(BoundedStringSchema),
    maxDepth: NonNegativeIntegerSchema,
    nodeCount: NonNegativeIntegerSchema,
    nodes: Type.Array(PlanningMapReduceReduceNodeSchema, { maxItems: PLANNING_MAP_REDUCE_MAX_NODES }),
  }),
  // Per-reduce-node lifecycle transition.
  Type.Object({
    type: Type.Literal('planning:map-reduce:reduce:status'),
    nodeId: BoundedStringSchema,
    status: PlanningMapReduceReduceStatusSchema,
    reason: Type.Optional(BoundedStringSchema),
  }),
] as const;

export type PlanningMapReduceEventType = typeof PLANNING_MAP_REDUCE_EVENT_TYPES[number];
export type PlanningMapReduceAtomReason = Static<typeof PlanningMapReduceAtomReasonSchema>;
export type PlanningMapReduceAtom = Static<typeof PlanningMapReduceAtomSchema>;
export type PlanningMapReduceAtomEdge = Static<typeof PlanningMapReduceAtomEdgeSchema>;
export type PlanningMapReduceAtomStatus = Static<typeof PlanningMapReduceAtomStatusSchema>;
export type PlanningMapReduceReduceNode = Static<typeof PlanningMapReduceReduceNodeSchema>;
export type PlanningMapReduceReduceStatus = Static<typeof PlanningMapReduceReduceStatusSchema>;
