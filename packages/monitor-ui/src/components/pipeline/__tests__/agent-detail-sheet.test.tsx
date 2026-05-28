// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { AgentDetailSheet } from '../agent-detail-sheet';
import type { AgentThread, StoredEvent } from '@/lib/reducer';

afterEach(cleanup);

function makeThread(overrides: Partial<AgentThread> = {}): AgentThread {
  return {
    agentId: 'agent-abc-123',
    agent: 'builder',
    planId: 'plan-01',
    startedAt: '2024-01-15T10:00:00.000Z',
    endedAt: '2024-01-15T10:05:00.000Z',
    durationMs: 300000,
    inputTokens: 1000,
    outputTokens: 500,
    totalTokens: 1500,
    cacheRead: 200,
    cacheCreation: null,
    costUsd: 0.015,
    numTurns: 3,
    model: 'claude-sonnet-4-5',
    ...overrides,
  };
}

describe('AgentDetailSheet smoke', () => {
  it('renders title containing agent role and plan id', () => {
    const thread = makeThread({ agent: 'builder', planId: 'plan-01' });
    render(<AgentDetailSheet thread={thread} events={[]} open={true} onClose={() => {}} />);
    expect(screen.getByText('builder · plan-01')).toBeTruthy();
  });

  it('activity totals render when activity is present', () => {
    const thread = makeThread({
      activity: {
        attribution: 'exact',
        files: [{ path: 'src/index.ts', additions: 10, deletions: 2 }],
        totals: { filesChanged: 3, additions: 20, deletions: 5 },
      },
    });
    render(<AgentDetailSheet thread={thread} events={[]} open={true} onClose={() => {}} />);
    expect(document.body.textContent).toContain('3 files');
    expect(document.body.textContent).toContain('+20');
  });

  it('renders matching warning event for the agentId and omits non-matching', () => {
    const thread = makeThread({ agentId: 'agent-abc-123' });
    const events: StoredEvent[] = [
      {
        eventId: 'ev1',
        event: {
          type: 'agent:warning',
          timestamp: '2024-01-15T10:01:00.000Z',
          sessionId: 's1',
          agentId: 'agent-abc-123',
          agent: 'builder',
          code: 'CONTEXT_LIMIT',
          message: 'Context approaching limit.',
        },
      },
      {
        eventId: 'ev2',
        event: {
          type: 'agent:warning',
          timestamp: '2024-01-15T10:02:00.000Z',
          sessionId: 's1',
          agentId: 'agent-xyz-999',
          agent: 'reviewer',
          code: 'OTHER_WARNING',
          message: 'Some other agent warning.',
        },
      },
    ];
    render(<AgentDetailSheet thread={thread} events={events} open={true} onClose={() => {}} />);
    expect(screen.getByText(/CONTEXT_LIMIT/)).toBeTruthy();
    expect(document.body.textContent).not.toContain('OTHER_WARNING');
  });
});
