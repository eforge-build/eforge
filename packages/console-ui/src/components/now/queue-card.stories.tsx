import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { QueueCard } from './queue-card';
import { selectNowQueueSummary } from '@/lib/selectors/queue-summary';
import { selectNowQueueStacks } from '@/lib/selectors/queue-stacks';
import { makeQueue, makeQueueCapabilities } from '@/test-support/factories';
import type { QueueItem } from '@eforge-build/client/browser';

/**
 * Stories build wire-level QueueItem[] and route them through the *real*
 * selectors (selectNowQueueSummary / selectNowQueueStacks), so the card always
 * reflects the live view-model shape. Row actions live behind the per-row ⋯
 * menu; open it to see Set priority…, Hold…, Override dependency…, Remove….
 */

function cardProps(queue: QueueItem[]) {
  return {
    summary: selectNowQueueSummary(queue),
    stacks: selectNowQueueStacks(queue),
    onSetPriority: fn(),
    onOverrideDependency: fn(),
    onHold: fn(),
    onUnhold: fn(),
    onPreviewCascade: fn().mockResolvedValue({
      operation: 'remove',
      target: { prdId: 'preview', title: 'Preview', status: 'pending', effect: 'remove', depth: 0, blockers: [] },
      dependents: [],
      expectedAffected: { prdIds: ['preview'] },
      warnings: [],
      blockers: [],
    }),
    onApplyCascade: fn().mockResolvedValue({
      applied: true,
      operation: 'remove',
      strategy: 'target-only',
      affected: { prdIds: ['preview'] },
      warnings: [],
      blockers: [],
    }),
  };
}

const meta = {
  title: 'Now/QueueCard',
  component: QueueCard,
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 720 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof QueueCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Loose forward items with mixed priorities — priority shows as a P: badge. */
export const MixedPriorities: Story = {
  args: cardProps([
    makeQueue({ id: 'q-alpha', title: 'Alpha refactor', status: 'pending', priority: 1, created: '2026-07-01T09:00:00.000Z', capabilities: makeQueueCapabilities() }),
    makeQueue({ id: 'q-beta', title: 'Beta docs sync', status: 'pending', priority: 5, created: '2026-07-01T10:00:00.000Z', capabilities: makeQueueCapabilities() }),
    makeQueue({ id: 'q-gamma', title: 'Gamma cleanup (no priority)', status: 'pending', created: '2026-07-01T11:00:00.000Z', capabilities: makeQueueCapabilities() }),
  ]),
};

/** A held item — the Held badge stays visible on the row; release lives in the ⋯ menu. */
export const HeldItem: Story = {
  args: cardProps([
    makeQueue({
      id: 'q-held',
      title: 'Held migration',
      status: 'pending',
      priority: 2,
      hold: { held: true, reason: 'Waiting for schema review' },
      capabilities: makeQueueCapabilities(),
    }),
    makeQueue({ id: 'q-next', title: 'Next in line', status: 'pending', capabilities: makeQueueCapabilities() }),
  ]),
};

/** Capability-denied actions render disabled in the menu with the daemon's reason. */
export const CapabilityDenied: Story = {
  args: cardProps([
    makeQueue({
      id: 'q-denied',
      title: 'Dispatching item',
      status: 'pending',
      capabilities: makeQueueCapabilities({
        priority: { allowed: false, reason: 'Item is being dispatched.' },
        remove: { allowed: false, reason: 'Item is being dispatched.' },
        cascadeRemove: { allowed: false, reason: 'Item is being dispatched.' },
      }),
    }),
  ]),
};

/** A dependency-linked stack: running reference row plus blocked pending layers. */
export const DependencyStack: Story = {
  args: cardProps([
    makeQueue({ id: 'stack-base', title: 'Base recovery policy', status: 'running', created: '2026-07-01T08:00:00.000Z', capabilities: makeQueueCapabilities() }),
    makeQueue({
      id: 'stack-ux',
      title: 'Recovery UX',
      status: 'waiting',
      dependsOn: ['stack-base'],
      created: '2026-07-01T08:10:00.000Z',
      capabilities: makeQueueCapabilities(),
    }),
    makeQueue({
      id: 'stack-adoption',
      title: 'Orphaned build adoption',
      status: 'waiting',
      priority: 3,
      dependsOn: ['stack-base'],
      created: '2026-07-01T08:20:00.000Z',
      capabilities: makeQueueCapabilities(),
    }),
  ]),
};
