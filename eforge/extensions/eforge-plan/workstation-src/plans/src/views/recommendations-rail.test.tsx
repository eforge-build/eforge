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
  recommendedNextSequence: [{ ref: 'next-1', itemId: 'item-one' }],
  safeParallelizableGroups: [{ ref: 'lane-1', title: 'Lane One', itemIds: ['item-one', 'item-two', 'item-three'] }],
};

const actionability: RecommendationActionabilityProjection = {
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
      associatedLinks: [],
    },
  }],
  safeParallelizableGroups: [{
    ref: 'lane-1',
    state: 'partially-actionable',
    itemIds: ['item-one', 'item-two', 'item-three'],
    actionableItemIds: ['item-two'],
    suppressedItemIds: ['item-one', 'item-three'],
    items: [
      { itemId: 'item-one', state: 'non-actionable', lifecycleState: 'planned', reasonMessage: 'Item one is already planned.', associatedLinks: [] },
      { itemId: 'item-two', state: 'actionable', lifecycleState: 'none', associatedLinks: [] },
      { itemId: 'item-three', state: 'non-actionable', lifecycleState: 'active', reasonMessage: 'Item three is already in process.', associatedLinks: [] },
    ],
  }],
};

describe('RecommendationsRail actionability', () => {
  it('disables non-actionable next work and plans only actionable ready lane items', () => {
    const planLane = vi.fn(async () => undefined);
    render(
      <RecommendationsRail
        recommendations={recommendations}
        actionability={actionability}
        status={null}
        freshness={null}
        selection={selection({ planLane })}
        busy={false}
        analyzing={false}
        onAnalyze={vi.fn(async () => undefined)}
        onForkLane={vi.fn(async () => undefined)}
      />,
    );

    const nextButton = screen.getByRole('button', { name: /Item One/ });
    expect(nextButton).toHaveProperty('disabled', true);
    expect(nextButton.getAttribute('title')).toBe('An editable session plan already covers item-one.');

    fireEvent.click(screen.getByRole('button', { name: 'Plan (1)' }));

    expect(planLane).toHaveBeenCalledWith(['item-two'], 'lane-1');
  });
});
