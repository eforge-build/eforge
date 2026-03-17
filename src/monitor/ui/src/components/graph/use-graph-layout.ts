import { useMemo } from 'react';
import dagre from '@dagrejs/dagre';
import type { Node, Edge } from '@xyflow/react';
import type { OrchestrationConfig } from '@/lib/types';

const NODE_WIDTH = 200;
const NODE_HEIGHT = 60;

export interface GraphLayoutResult {
  nodes: Node[];
  edges: Edge[];
  isLayoutReady: boolean;
}

export function computeGraphLayout(
  plans: OrchestrationConfig['plans'],
): { nodes: Node[]; edges: Edge[] } {
  if (plans.length === 0) {
    return { nodes: [], edges: [] };
  }

  // Create dagre graph
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: 'TB',
    nodesep: 60,
    ranksep: 120,
    marginx: 20,
    marginy: 20,
  });
  g.setDefaultEdgeLabel(() => ({}));

  // Add plan nodes
  for (const plan of plans) {
    g.setNode(plan.id, {
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    });
  }

  // Add edges
  for (const plan of plans) {
    for (const dep of plan.dependsOn) {
      g.setEdge(dep, plan.id);
    }
  }

  // Run layout
  dagre.layout(g);

  // Build ReactFlow nodes
  const rfNodes: Node[] = [];
  const rfEdges: Edge[] = [];

  // Create plan nodes
  for (const plan of plans) {
    const nodeData = g.node(plan.id);
    if (!nodeData) continue;

    rfNodes.push({
      id: plan.id,
      type: 'dagNode',
      position: {
        x: nodeData.x - NODE_WIDTH / 2,
        y: nodeData.y - NODE_HEIGHT / 2,
      },
      data: {
        planId: plan.id,
        planName: plan.name,
        status: 'pending',
        highlighted: null, // null = normal, true = highlighted, false = dimmed
      },
    });
  }

  // Create edges
  for (const plan of plans) {
    for (const dep of plan.dependsOn) {
      rfEdges.push({
        id: `edge-${dep}-${plan.id}`,
        source: dep,
        target: plan.id,
        type: 'dagEdge',
        data: {
          sourceStatus: 'pending',
          targetStatus: 'pending',
        },
      });
    }
  }

  return { nodes: rfNodes, edges: rfEdges };
}

export function useGraphLayout(
  orchestration: OrchestrationConfig | null,
): GraphLayoutResult {
  return useMemo(() => {
    if (!orchestration) {
      return { nodes: [], edges: [], isLayoutReady: false };
    }

    const { nodes, edges } = computeGraphLayout(orchestration.plans);
    return { nodes, edges, isLayoutReady: true };
  }, [orchestration]);
}
