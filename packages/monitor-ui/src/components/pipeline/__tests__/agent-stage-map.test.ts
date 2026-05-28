import { describe, it, expect } from 'vitest';
import {
  resolveBuildStage,
  getBuildStageStatuses,
  buildStageName,
} from '../agent-stage-map';
import type { BuildStageSpec } from '@/lib/types';
import type { AgentThread } from '@/lib/reducer';

function makeThread(overrides: Partial<AgentThread> = {}): AgentThread {
  return {
    agentId: 'a1',
    agent: 'builder',
    planId: 'plan-01',
    startedAt: '2024-01-15T10:00:00.000Z',
    endedAt: null,
    durationMs: null,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    cacheRead: null,
    costUsd: null,
    numTurns: null,
    model: 'claude-sonnet',
    ...overrides,
  };
}

describe('agent-stage-map smoke', () => {
  it('buildStageName returns string as-is and joins array stages with "+"', () => {
    expect(buildStageName('implement')).toBe('implement');
    expect(buildStageName(['review', 'evaluate'] as BuildStageSpec)).toBe('review+evaluate');
  });

  it('resolveBuildStage resolves "review" to "review-cycle" when review-cycle is in buildStages', () => {
    expect(resolveBuildStage('review', ['implement', 'review-cycle'])).toBe('review-cycle');
    expect(resolveBuildStage('review', ['implement', 'review'])).toBe('review');
  });

  it('getBuildStageStatuses marks stages before current as completed and current as active', () => {
    const stages: BuildStageSpec[] = ['implement', 'review-cycle', 'validate'];
    const statuses = getBuildStageStatuses(stages, 'review');
    expect(statuses[0]).toBe('completed');
    expect(statuses[1]).toBe('active');
    expect(statuses[2]).toBe('pending');
  });

  it('getBuildStageStatuses marks furthest-reached stage as failed using thread data', () => {
    const stages: BuildStageSpec[] = ['implement', 'review-cycle', 'validate'];
    const threads = [makeThread({ agent: 'reviewer' })];
    const statuses = getBuildStageStatuses(stages, 'failed', threads);
    expect(statuses[0]).toBe('completed');
    expect(statuses[1]).toBe('failed');
    expect(statuses[2]).toBe('pending');
  });
});
