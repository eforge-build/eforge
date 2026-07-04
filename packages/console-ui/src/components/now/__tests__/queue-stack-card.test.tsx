import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import * as React from 'react';
import { QueueStacks } from '../queue-stack-card';
import type { NowQueueStack } from '@/lib/selectors/now';
import { makeQueueCapabilities } from '@/test-support/factories';
import { openQueueRowMenu as openRowMenu } from '@/test-support/radix';

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
        capabilities: makeQueueCapabilities(),
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
        capabilities: makeQueueCapabilities(),
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
        capabilities: makeQueueCapabilities(),
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
  it('offers Set priority and Remove in the menu for waiting rows; running rows only get Cancel PRD', async () => {
    render(<QueueStacks stacks={[makeStack()]} onSetPriority={vi.fn()} onPreviewCascade={vi.fn()} onApplyCascade={vi.fn()} />);

    // Every row gets a kebab: two waiting layers plus the running reference row.
    expect(screen.getByRole('button', { name: 'Queue actions for API Build' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Queue actions for Handoff Build' })).toBeDefined();

    openRowMenu('API Build');
    expect(await screen.findByRole('menuitem', { name: 'Set priority…' })).toBeDefined();
    expect(screen.getByRole('menuitem', { name: 'Remove…' })).toBeDefined();

    // Close the first menu before opening another — Radix aria-hides the rest
    // of the page while a menu is open, so the other trigger is unqueryable.
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());

    // The running base layer exposes only the cascade cancel action.
    openRowMenu('Base Build');
    expect(await screen.findByRole('menuitem', { name: 'Cancel PRD…' })).toBeDefined();
    expect(screen.queryByRole('menuitem', { name: 'Set priority…' })).toBeNull();
  });

  it('offers Set priority in the menu for pending stack rows', async () => {
    const base = makeStack();
    const stack: NowQueueStack = {
      ...base,
      items: base.items.map((item) =>
        item.id === 'base' ? { ...item, status: 'pending' } : item,
      ),
    };
    render(<QueueStacks stacks={[stack]} onSetPriority={vi.fn()} onPreviewCascade={vi.fn()} onApplyCascade={vi.fn()} />);

    openRowMenu('Base Build');
    expect(await screen.findByRole('menuitem', { name: 'Set priority…' })).toBeDefined();
  });

  it('renders no menus when no callbacks are provided', () => {
    render(<QueueStacks stacks={[makeStack()]} />);
    expect(screen.queryByRole('button', { name: /Queue actions for/ })).toBeNull();
  });

  it('offers Override dependency in the menu for waiting stack rows with dependencies', async () => {
    render(<QueueStacks stacks={[makeStack()]} onOverrideDependency={vi.fn()} />);
    openRowMenu('API Build');
    expect(await screen.findByRole('menuitem', { name: 'Override dependency…' })).toBeDefined();
  });

  it('offers Override dependency in the menu for pending stack rows with dependencies', async () => {
    const base = makeStack();
    const stack: NowQueueStack = {
      ...base,
      items: base.items.map((item) =>
        item.id === 'api' ? { ...item, status: 'pending' } : item,
      ),
    };
    render(<QueueStacks stacks={[stack]} onOverrideDependency={vi.fn()} />);
    openRowMenu('API Build');
    expect(await screen.findByRole('menuitem', { name: 'Override dependency…' })).toBeDefined();
  });

  it('does not offer any actions for running stack rows even with dependencies (no cascade callbacks)', () => {
    const base = makeStack();
    const stack: NowQueueStack = {
      ...base,
      items: base.items.map((item) =>
        item.id === 'base' ? { ...item, dependsOn: ['root'] } : item,
      ),
    };
    render(<QueueStacks stacks={[stack]} onOverrideDependency={vi.fn()} />);

    // Running rows only ever expose the cascade cancel action; without cascade
    // callbacks the running row has no kebab at all.
    expect(screen.queryByRole('button', { name: 'Queue actions for Base Build' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Queue actions for API Build' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Queue actions for Handoff Build' })).toBeDefined();
  });

  it('confirms Override dependency for the selected stack row dependency', async () => {
    const onOverrideDependency = vi.fn();
    render(<QueueStacks stacks={[makeStack()]} onOverrideDependency={onOverrideDependency} />);

    openRowMenu('Handoff Build');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Override dependency…' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.change(within(dialog).getByLabelText('Reason for overriding Handoff Build'), {
      target: { value: 'handoff approved' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Override dependency' }));

    await waitFor(() => expect(onOverrideDependency).toHaveBeenCalledTimes(1));
    expect(onOverrideDependency).toHaveBeenCalledWith('handoff', 'api', 'handoff approved');
  });

  it('shows a P: badge for prioritized stack rows', () => {
    const base = makeStack();
    const stack: NowQueueStack = {
      ...base,
      items: base.items.map((item) =>
        item.id === 'api' ? { ...item, priority: 3 } : item,
      ),
    };
    render(<QueueStacks stacks={[stack]} />);
    expect(screen.getByText('P: 3')).toBeDefined();
  });
});
