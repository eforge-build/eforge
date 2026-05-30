import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { QueueStackCard } from '../queue-stack-card';
import type { NowQueueStack } from '@/lib/selectors/now';

function makeStack(): NowQueueStack {
  return {
    id: 'base>api>handoff',
    totalItems: 3,
    activeCount: 1,
    waitingCount: 2,
    pendingCount: 0,
    layers: 3,
    items: [
      {
        id: 'base',
        title: 'Base Build',
        status: 'running',
        priority: undefined,
        created: undefined,
        dependsOn: [],
        blockedBy: [],
        unlocksCount: 1,
        layer: 1,
        totalLayers: 3,
      },
      {
        id: 'api',
        title: 'API Build',
        status: 'waiting',
        priority: undefined,
        created: undefined,
        dependsOn: ['base'],
        blockedBy: ['Base Build'],
        unlocksCount: 1,
        layer: 2,
        totalLayers: 3,
      },
      {
        id: 'handoff',
        title: 'Handoff Build',
        status: 'waiting',
        priority: undefined,
        created: undefined,
        dependsOn: ['api'],
        blockedBy: ['API Build'],
        unlocksCount: 0,
        layer: 3,
        totalLayers: 3,
      },
    ],
  };
}

describe('QueueStackCard', () => {
  it('renders nothing when there are no dependency-linked stacks', () => {
    const { container } = render(<QueueStackCard stacks={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders all stack layers in unlock order', () => {
    render(<QueueStackCard stacks={[makeStack()]} />);

    expect(screen.getByText('Build stack')).toBeDefined();
    expect(screen.getByText('Base Build')).toBeDefined();
    expect(screen.getByText('API Build')).toBeDefined();
    expect(screen.getByText('Handoff Build')).toBeDefined();
    expect(screen.getByText('Layer 1 / 3')).toBeDefined();
    expect(screen.getByText('Layer 2 / 3')).toBeDefined();
    expect(screen.getByText('Layer 3 / 3')).toBeDefined();
    expect(screen.getByText('blocked by Base Build')).toBeDefined();
    expect(screen.getByText('blocked by API Build')).toBeDefined();
  });
});
