import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { BacklogSelection } from '@/hooks/use-backlog-selection';
import type { RecommendationActionabilityProjection, RecommendationModel } from '@/types';
import { RecommendationsRail } from './recommendations-rail';

function selection(overrides: Partial<BacklogSelection> = {}): BacklogSelection {
  return {
    selected: new Set(),
    selectedIds: [],
    selectedReadyIds: [],
    titles: new Map([['item-one', 'Item One'], ['item-two', 'Item Two'], ['item-three', 'Item Three']]),
    readyIds: new Set(['item-one', 'item-two', 'item-three']),
    toggle: vi.fn(),
    toggleItem: vi.fn(),
    clear: vi.fn(),
    pickItem: vi.fn(),
    pickItems: vi.fn(),
    planLane: vi.fn(async () => undefined),
    promote: vi.fn(async () => undefined),
    ...overrides,
  };
}

const recommendations: RecommendationModel = {
  schemaVersion: 1,
  activeWork: [],
  readyCandidates: [],
  recommendedNextSequence: [{ ref: 'next-1', itemId: 'item-one' }],
  safeParallelizableGroups: [{ ref: 'lane-1', title: 'Lane One', itemIds: ['item-one', 'item-two', 'item-three'] }],
};

const mixedActionability: RecommendationActionabilityProjection = {
  schemaVersion: 1,
  activeWork: [],
  readyCandidates: [],
  recommendedNextSequence: [{
    lane: 'recommendedNextSequence',
    ref: 'next-1',
    itemId: 'item-one',
    actionability: {
      itemId: 'item-one',
      state: 'non-actionable',
      lifecycleState: 'planned',
      reasonCode: 'planned-session-plan',
      reasonMessage: 'An editable session plan already covers item-one.',
      associatedLinks: [{ kind: 'session-plan', label: 'Session plan one', itemIds: ['item-one'], session: 'session-one', status: 'planning', path: '.eforge/session-plans/session-one.md' }],
    },
  }],
  safeParallelizableGroups: [{
    ref: 'lane-1',
    state: 'partially-actionable',
    itemIds: ['item-one', 'item-two', 'item-three'],
    actionableItemIds: ['item-two'],
    suppressedItemIds: ['item-one', 'item-three'],
    items: [
      { itemId: 'item-one', state: 'non-actionable', lifecycleState: 'planned', reasonCode: 'planned-session-plan', reasonMessage: 'Item one is already planned.', associatedLinks: [{ kind: 'session-plan', label: 'Session plan one', itemIds: ['item-one'], session: 'session-one', status: 'planning' }] },
      { itemId: 'item-two', state: 'actionable', lifecycleState: 'none', associatedLinks: [] },
      { itemId: 'item-three', state: 'non-actionable', lifecycleState: 'pr-open', reasonCode: 'open-pr-trace', reasonMessage: 'Item three already has an open PR.', associatedLinks: [{ kind: 'pr', label: 'Open PR for Item Three', itemIds: ['item-three'], status: 'pr-open', prUrl: 'https://example.test/pr/3', featureBranch: 'feature/item-three' }] },
    ],
  }],
};

function renderRail(props: { actionability?: RecommendationActionabilityProjection | null; selection?: BacklogSelection; recommendations?: RecommendationModel; onForkLane?: (recommendationRef: string) => Promise<void> } = {}) {
  return render(
    <RecommendationsRail
      recommendations={props.recommendations ?? recommendations}
      actionability={props.actionability === undefined ? mixedActionability : props.actionability}
      status={null}
      freshness={null}
      selection={props.selection ?? selection()}
      busy={false}
      analyzing={false}
      onAnalyze={vi.fn(async () => undefined)}
      onForkLane={props.onForkLane ?? vi.fn(async () => undefined)}
    />,
  );
}

describe('RecommendationsRail actionability', () => {
  it('renders non-actionable next work as read-only reason rows with links and no selection button', () => {
    renderRail();

    expect(screen.queryByRole('button', { name: /Item One/ })).toBeNull();
    expect(screen.getByText('An editable session plan already covers item-one.')).toBeTruthy();
    expect(screen.getAllByText('Session plan one').length).toBeGreaterThan(0);
  });

  it('matches non-actionable next work by item id when recommendation refs differ', () => {
    const byItemId: RecommendationActionabilityProjection = {
      ...mixedActionability,
      recommendedNextSequence: [{
        ...mixedActionability.recommendedNextSequence[0]!,
        ref: 'server-ref-for-different-projection',
      }],
    };
    renderRail({
      actionability: byItemId,
      recommendations: {
        ...recommendations,
        recommendedNextSequence: [{ ref: 'client-ref-mismatch', itemId: 'item-one' }],
      },
    });

    expect(screen.queryByRole('button', { name: /Item One/ })).toBeNull();
    expect(screen.getByText('An editable session plan already covers item-one.')).toBeTruthy();
  });

  it('plans only the server-reported actionable subset for mixed safe-parallel lanes', () => {
    const planLane = vi.fn(async () => undefined);
    const onForkLane = vi.fn(async () => undefined);
    renderRail({ selection: selection({ planLane }), onForkLane });

    fireEvent.click(screen.getByRole('button', { name: 'Plan (1)' }));

    expect(planLane).toHaveBeenCalledWith(['item-two'], 'lane-1');
    expect(screen.queryByRole('button', { name: /Fork to draft/ })).toBeNull();
    expect(onForkLane).not.toHaveBeenCalled();
    expect(screen.getByText('Item one is already planned.')).toBeTruthy();
    expect(screen.getByText('Item three already has an open PR.')).toBeTruthy();
  });

  it('renders associated PR links for suppressed entries', () => {
    renderRail();

    const link = screen.getByRole('link', { name: 'Open PR for Item Three' });
    expect(link.getAttribute('href')).toBe('https://example.test/pr/3');
  });

  it('omits planning controls for fully non-actionable safe-parallel lanes', () => {
    const nonActionable: RecommendationActionabilityProjection = {
      ...mixedActionability,
      safeParallelizableGroups: [{
        ...mixedActionability.safeParallelizableGroups[0]!,
        state: 'non-actionable',
        actionableItemIds: [],
        suppressedItemIds: ['item-one', 'item-two', 'item-three'],
        items: mixedActionability.safeParallelizableGroups[0]!.items.map((item) => item.state === 'actionable'
          ? { itemId: item.itemId, state: 'non-actionable', lifecycleState: 'active', reasonCode: 'active-planning-task', reasonMessage: 'Item two is already in a planning task.', associatedLinks: [{ kind: 'planning-task', label: 'Planning task two', itemIds: ['item-two'], taskId: 'task-two', status: 'running' }] }
          : item),
      }],
    };
    const onForkLane = vi.fn(async () => undefined);
    renderRail({ actionability: nonActionable, onForkLane });

    expect(screen.queryByRole('button', { name: /^Plan/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Select' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Select actionable' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Fork to draft/ })).toBeNull();
    expect(screen.getByText('No actionable items remain in this lane.')).toBeTruthy();
    expect(screen.getByText('Item two is already in a planning task.')).toBeTruthy();
    expect(onForkLane).not.toHaveBeenCalled();
  });

  it('fails closed when a present actionability projection omits recommendations', () => {
    const planLane = vi.fn(async () => undefined);
    const pickItem = vi.fn();
    const onForkLane = vi.fn(async () => undefined);
    renderRail({
      actionability: {
        schemaVersion: 1,
        activeWork: [],
        readyCandidates: [],
        recommendedNextSequence: [],
        safeParallelizableGroups: [],
      },
      selection: selection({ planLane, pickItem }),
      onForkLane,
    });

    expect(screen.queryByRole('button', { name: /Item One/ })).toBeNull();
    expect(screen.getByText('This recommendation is not currently available for planning.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Plan/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Select' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Select actionable' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Fork to draft/ })).toBeNull();
    expect(screen.getByText('No actionable items remain in this lane.')).toBeTruthy();
    expect(pickItem).not.toHaveBeenCalled();
    expect(planLane).not.toHaveBeenCalled();
    expect(onForkLane).not.toHaveBeenCalled();
  });

  it('falls back to legacy recommendation rendering only when actionability is absent', () => {
    const planLane = vi.fn(async () => undefined);
    const pickItem = vi.fn();
    renderRail({ actionability: null, selection: selection({ planLane, pickItem }) });

    fireEvent.click(screen.getByRole('button', { name: /Item One/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Plan' }));

    expect(pickItem).toHaveBeenCalledWith('item-one');
    expect(planLane).toHaveBeenCalledWith(['item-one', 'item-two', 'item-three'], 'lane-1');
  });
});
