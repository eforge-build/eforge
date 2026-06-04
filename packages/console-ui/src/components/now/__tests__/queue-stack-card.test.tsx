import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { QueueStacks } from '../queue-stack-card';
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

describe('QueueStacks', () => {
  it('renders nothing when there are no dependency-linked stacks', () => {
    const { container } = render(<QueueStacks stacks={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders all stack layers in unlock order', () => {
    render(<QueueStacks stacks={[makeStack()]} />);

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

describe('QueueStacks - row actions', () => {
  it('renders Set priority and Remove controls for waiting rows but not running rows', () => {
    render(<QueueStacks stacks={[makeStack()]} onSetPriority={vi.fn()} onRemove={vi.fn()} />);

    // The two waiting layers expose controls.
    expect(screen.getByLabelText('Priority for API Build')).toBeDefined();
    expect(screen.getByLabelText('Priority for Handoff Build')).toBeDefined();
    expect(screen.getAllByRole('button', { name: 'Set priority' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(2);

    // The running base layer keeps its status-only presentation.
    expect(screen.queryByLabelText('Priority for Base Build')).toBeNull();
  });

  it('renders controls for pending stack rows', () => {
    const base = makeStack();
    const stack: NowQueueStack = {
      ...base,
      items: base.items.map((item) =>
        item.id === 'base' ? { ...item, status: 'pending' } : item,
      ),
    };
    render(<QueueStacks stacks={[stack]} onSetPriority={vi.fn()} onRemove={vi.fn()} />);

    expect(screen.getByLabelText('Priority for Base Build')).toBeDefined();
    expect(screen.getAllByRole('button', { name: 'Set priority' })).toHaveLength(3);
  });

  it('renders no controls when no callbacks are provided', () => {
    render(<QueueStacks stacks={[makeStack()]} />);
    expect(screen.queryByRole('button', { name: 'Set priority' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  });
});
