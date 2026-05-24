import { describe, expect, it } from 'vitest';

import { initialRunState, type RunState } from '@/lib/reducer';
import { selectStackLayersForRun } from '@/lib/stack-layers';
import type { EforgeEvent, StackLayerWire } from '@/lib/types';

function makeRunState(overrides: Partial<RunState> = {}): RunState {
  return {
    ...initialRunState,
    fileChanges: new Map(),
    reviewIssues: {},
    agentThreads: [],
    expeditionModules: [],
    moduleStatuses: {},
    earlyOrchestration: null,
    mergeCommits: {},
    liveAgentUsage: {},
    validationCommands: [],
    perspectiveErrors: {},
    reviewIssuesByPerspective: {},
    decisions: {},
    ...overrides,
  };
}

function makeStoredEvent(event: unknown, eventId = 'evt-1'): { event: EforgeEvent; eventId: string } {
  return { event: event as EforgeEvent, eventId };
}

function makeLayer(overrides: Partial<StackLayerWire> = {}): StackLayerWire {
  return {
    prdId: 'current-plan',
    stackId: 'stack-current',
    provider: 'git-spice',
    branch: 'eforge/current-plan',
    baseBranch: 'main',
    status: 'built',
    recordedAt: '2026-05-24T10:00:00.000Z',
    updatedAt: '2026-05-24T10:05:00.000Z',
    ...overrides,
  } as StackLayerWire;
}

describe('selectStackLayersForRun', () => {
  it('only returns daemon stack layers referenced by the selected run plans', () => {
    const layers = [
      makeLayer({
        prdId: 'harden-eforge-build-validation-gates',
        stackId: 'harden-eforge-build-validation-gates',
        status: 'failed',
        landing: {
          action: 'pr',
          status: 'failed',
          reason: 'git-spice command failed',
          startedAt: '2026-05-24T10:00:00.000Z',
        },
      }),
      makeLayer({ prdId: 'close-stacked-pr-followup', stackId: 'close-stacked-pr-followup' }),
    ];
    const runState = makeRunState({
      events: [
        makeStoredEvent({
          type: 'planning:complete',
          timestamp: '2026-05-24T10:00:00.000Z',
          plans: [{ id: 'close-stacked-pr-followup', name: 'Close stacked PR followup', body: '...' }],
        }),
      ],
    });

    expect(selectStackLayersForRun(layers, runState)).toEqual([layers[1]]);
  });

  it('uses stack events in the selected run when orchestration has not been projected yet', () => {
    const layers = [
      makeLayer({ prdId: 'older-build', stackId: 'older-build', status: 'failed' }),
      makeLayer({ prdId: 'current-plan', stackId: 'current-stack' }),
    ];
    const runState = makeRunState({
      events: [
        makeStoredEvent({
          type: 'stack:layer:recorded',
          timestamp: '2026-05-24T10:00:00.000Z',
          prdId: 'current-plan',
          stackId: 'current-stack',
          provider: 'git-spice',
          branch: 'eforge/current-plan',
          status: 'built',
        }),
      ],
    });

    expect(selectStackLayersForRun(layers, runState)).toEqual([layers[1]]);
  });

  it('returns no daemon stack layers when the selected run has no known plan IDs', () => {
    const layers = [makeLayer({ prdId: 'older-build', stackId: 'older-build', status: 'failed' })];

    expect(selectStackLayersForRun(layers, makeRunState())).toEqual([]);
  });
});
