import { describe, expect, it } from 'vitest';
import type { PlanningAgentTaskRecord, RoadmapStateResponse } from '@/types';
import { getMockRoadmapState } from '@/fixtures/mock-roadmap';
import { localFocusEditState, refreshDisabledReason, sourceKindLabel, sourceSummary, utf8ByteCount } from './roadmap-view-model';

describe('roadmap view model', () => {
  it('counts UTF-8 bytes for multibyte local focus content', () => {
    expect(utf8ByteCount('abc')).toBe(3);
    expect(utf8ByteCount('🚀')).toBe(4);
    expect(localFocusEditState({ draft: '🚀🚀', saved: '', maxBytes: 7 }).overLimit).toBe(true);
  });

  it('derives dirty and save state from draft content and limits', () => {
    expect(localFocusEditState({ draft: 'same', saved: 'same', maxBytes: 10 }).canSave).toBe(false);
    expect(localFocusEditState({ draft: 'changed', saved: 'same', maxBytes: 10 }).canSave).toBe(true);
    expect(localFocusEditState({ draft: 'changed', saved: 'same', maxBytes: 3 }).canSave).toBe(false);
  });

  it('distinguishes refresh disabled reasons', () => {
    const task: PlanningAgentTaskRecord = { taskId: 'task', kind: 'x', status: 'running', createdAt: '', updatedAt: '' };
    expect(refreshDisabledReason({ dirty: true, saving: false, refreshing: false })).toMatch(/Save the local focus/i);
    expect(refreshDisabledReason({ dirty: false, saving: true, refreshing: false })).toMatch(/save to finish/i);
    expect(refreshDisabledReason({ dirty: false, saving: false, refreshing: false, activeTask: task })).toMatch(/already queued or running/i);
    expect(refreshDisabledReason({ dirty: false, saving: false, refreshing: false })).toBeNull();
  });

  it('counts configured shared sources separately from discovered conventional sources', () => {
    const state = getMockRoadmapState();
    expect(sourceSummary(state)).toMatchObject({ local: 1, configuredShared: 1, discovered: 1, conflicts: 1, assumptions: 1 });
  });

  it('labels source kinds without making docs/roadmap.md canonical', () => {
    expect(sourceKindLabel('local-focus')).toBe('Local focus');
    expect(sourceKindLabel('configured-shared')).toBe('Configured shared context');
    expect(sourceKindLabel('discovered-conventional')).toBe('Discovered context');
    const state: RoadmapStateResponse = getMockRoadmapState();
    expect(sourceKindLabel(state.context.discoveredContextSources[0]!.kind)).not.toContain('docs/roadmap.md');
  });
});
