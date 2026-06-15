import { loadQueue, type QueuedPrd } from '../prd-queue.js';
import { loadStackState } from '../stacking/state.js';
import type { StackLayer } from '../stacking/types.js';

export interface StackParentInferenceOptions {
  cwd: string;
  queueDir: string;
  dependsOn: string[];
}

export interface StackParentInferenceResult {
  stackParent?: string;
  ambiguous: boolean;
  reason?: string;
}

interface TopologyNode {
  id: string;
  parentId?: string;
}

/**
 * Infer the direct stack parent from a dependency set using deterministic
 * queue and stack metadata.
 *
 * `depends_on` can include every prerequisite in a historical chain, while
 * `stack_parent` must identify the immediate parent layer. When the selected
 * dependencies form one chain, the topmost dependency is the direct parent.
 */
export async function inferStackParentFromDependencies(
  options: StackParentInferenceOptions,
): Promise<StackParentInferenceResult> {
  const dependsOn = unique(options.dependsOn);
  if (dependsOn.length === 0) return { ambiguous: false };
  if (dependsOn.length === 1) return { ambiguous: false, stackParent: dependsOn[0] };

  const nodes = await loadTopologyNodes(options.cwd, options.queueDir);
  const topmost = findTopmostDependencies(dependsOn, nodes);

  if (topmost.length === 1) {
    return { ambiguous: false, stackParent: topmost[0] };
  }

  return {
    ambiguous: true,
    reason: formatAmbiguousReason(dependsOn, topmost),
  };
}

export function findTopmostDependencies(
  dependsOn: string[],
  nodes: Map<string, TopologyNode>,
): string[] {
  const selected = new Set(unique(dependsOn));
  const ancestorsWithinSelection = new Set<string>();

  for (const id of selected) {
    for (const ancestorId of walkAncestors(id, nodes)) {
      if (selected.has(ancestorId)) ancestorsWithinSelection.add(ancestorId);
    }
  }

  return [...selected].filter((id) => !ancestorsWithinSelection.has(id));
}

async function loadTopologyNodes(cwd: string, queueDir: string): Promise<Map<string, TopologyNode>> {
  const [rootQueue, waitingQueue, stackState] = await Promise.all([
    loadQueue(queueDir, cwd),
    loadQueue(`${queueDir}/waiting`, cwd),
    loadStackState(cwd),
  ]);

  const nodes = new Map<string, TopologyNode>();
  for (const layer of stackState.layers) addLayerNode(nodes, layer);
  for (const prd of [...rootQueue, ...waitingQueue]) addQueuedPrdNode(nodes, prd);
  return nodes;
}

function addLayerNode(nodes: Map<string, TopologyNode>, layer: StackLayer): void {
  const existing = nodes.get(layer.prdId);
  nodes.set(layer.prdId, {
    id: layer.prdId,
    parentId: existing?.parentId ?? layer.parentPrdId,
  });
}

function addQueuedPrdNode(nodes: Map<string, TopologyNode>, prd: QueuedPrd): void {
  const existing = nodes.get(prd.id);
  // Queue frontmatter is the freshest operator intent, so it can override
  // older stack-layer state when a pending/waiting PRD is re-enqueued or edited.
  const parentId = prd.frontmatter.stack_parent ?? inferSingleDependencyParent(prd);
  nodes.set(prd.id, {
    id: prd.id,
    parentId: parentId ?? existing?.parentId,
  });
}

function inferSingleDependencyParent(prd: QueuedPrd): string | undefined {
  const dependsOn = prd.frontmatter.depends_on ?? [];
  return dependsOn.length === 1 ? dependsOn[0] : undefined;
}

function* walkAncestors(id: string, nodes: Map<string, TopologyNode>): Generator<string> {
  const seen = new Set<string>();
  let current = nodes.get(id)?.parentId;

  while (current && !seen.has(current)) {
    seen.add(current);
    yield current;
    current = nodes.get(current)?.parentId;
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function formatAmbiguousReason(dependsOn: string[], topmost: string[]): string {
  const topmostLabel = topmost.length > 0 ? topmost.join(', ') : 'none';
  return `Cannot infer stack_parent for multiple dependencies [${dependsOn.join(', ')}]. ` +
    `Dependencies do not form a single known stack chain; topmost candidates: ${topmostLabel}. ` +
    'Pass an explicit stack_parent to disambiguate the parent layer.';
}
