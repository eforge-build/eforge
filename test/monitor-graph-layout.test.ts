import { describe, it, expect } from 'vitest';
import { computeGraphLayout } from '../src/monitor/ui/src/components/graph/use-graph-layout';
import type { OrchestrationConfig } from '../src/engine/events';

type PlanEntry = OrchestrationConfig['plans'][number];

function makePlan(id: string, name: string, dependsOn: string[] = []): PlanEntry {
  return { id, name, dependsOn, branch: `branch-${id}` };
}

describe('computeGraphLayout', () => {
  it('returns empty layout for no plans', () => {
    const { nodes, edges } = computeGraphLayout([]);
    expect(nodes).toEqual([]);
    expect(edges).toEqual([]);
  });

  it('single plan (errand): 1 plan node, 0 edges', () => {
    const plans = [makePlan('p1', 'Plan One')];
    const { nodes, edges } = computeGraphLayout(plans);

    const planNodes = nodes.filter((n) => n.type === 'dagNode');

    expect(planNodes).toHaveLength(1);
    expect(planNodes[0].id).toBe('p1');
    expect(edges).toHaveLength(0);
  });

  it('three independent plans (excursion): 3 nodes, 0 edges', () => {
    const plans = [
      makePlan('p1', 'Plan One'),
      makePlan('p2', 'Plan Two'),
      makePlan('p3', 'Plan Three'),
    ];
    const { nodes, edges } = computeGraphLayout(plans);

    const planNodes = nodes.filter((n) => n.type === 'dagNode');

    expect(planNodes).toHaveLength(3);
    expect(edges).toHaveLength(0);
  });

  it('linear dependency chain (A -> B -> C): 3 nodes, 2 edges', () => {
    const plans = [
      makePlan('a', 'Plan A'),
      makePlan('b', 'Plan B', ['a']),
      makePlan('c', 'Plan C', ['b']),
    ];
    const { nodes, edges } = computeGraphLayout(plans);

    const planNodes = nodes.filter((n) => n.type === 'dagNode');

    expect(planNodes).toHaveLength(3);
    expect(edges).toHaveLength(2);

    // Verify edges
    expect(edges.find((e) => e.source === 'a' && e.target === 'b')).toBeDefined();
    expect(edges.find((e) => e.source === 'b' && e.target === 'c')).toBeDefined();
  });

  it('diamond pattern (A -> B, A -> C, B -> D, C -> D): 4 nodes, 4 edges', () => {
    const plans = [
      makePlan('a', 'Plan A'),
      makePlan('b', 'Plan B', ['a']),
      makePlan('c', 'Plan C', ['a']),
      makePlan('d', 'Plan D', ['b', 'c']),
    ];
    const { nodes, edges } = computeGraphLayout(plans);

    const planNodes = nodes.filter((n) => n.type === 'dagNode');

    expect(planNodes).toHaveLength(4);
    expect(edges).toHaveLength(4);
  });

  it('nodes have positions', () => {
    const plans = [
      makePlan('a', 'Plan A'),
      makePlan('b', 'Plan B', ['a']),
    ];
    const { nodes } = computeGraphLayout(plans);
    const planNodes = nodes.filter((n) => n.type === 'dagNode');

    for (const node of planNodes) {
      expect(node.position.x).toBeDefined();
      expect(node.position.y).toBeDefined();
    }
  });

  it('edges reference valid source/target node IDs', () => {
    const plans = [
      makePlan('a', 'Plan A'),
      makePlan('b', 'Plan B', ['a']),
      makePlan('c', 'Plan C', ['a', 'b']),
    ];
    const { nodes, edges } = computeGraphLayout(plans);
    const planNodeIds = new Set(nodes.filter((n) => n.type === 'dagNode').map((n) => n.id));

    for (const edge of edges) {
      expect(planNodeIds.has(edge.source)).toBe(true);
      expect(planNodeIds.has(edge.target)).toBe(true);
    }
  });

  it('plan node data includes correct plan name', () => {
    const plans = [
      makePlan('p1', 'My Plan'),
      makePlan('p2', 'Dep Plan', ['p1']),
    ];
    const { nodes } = computeGraphLayout(plans);

    const p1 = nodes.find((n) => n.id === 'p1')!;
    const p2 = nodes.find((n) => n.id === 'p2')!;

    expect(p1.data.planName).toBe('My Plan');
    expect(p2.data.planName).toBe('Dep Plan');
  });
});
