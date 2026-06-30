/**
 * Tests for the Timeline `filterPlanId` narrowing used by the map/reduce board's
 * node -> log linking. Clicking a board node sets the filter; the log then shows
 * only events carrying that `planId`, with a clearable banner.
 */
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PlanPreviewProvider } from '@/components/preview';
import { Timeline } from '../timeline';
import type { StoredEvent } from '@/lib/run-state';

function renderInProvider(ui: ReactElement) {
  return render(<PlanPreviewProvider>{ui}</PlanPreviewProvider>);
}

function evt(event: StoredEvent['event'], eventId: string): StoredEvent {
  return { event, eventId };
}

const EVENTS: StoredEvent[] = [
  evt({ type: 'agent:start', sessionId: 's', planId: 'atom-001', agentId: 'a1', agent: 'planner', model: 'm' } as StoredEvent['event'], 'e1'),
  evt({ type: 'agent:start', sessionId: 's', planId: 'atom-002', agentId: 'a2', agent: 'planner', model: 'm' } as StoredEvent['event'], 'e2'),
  evt({ type: 'agent:stop', sessionId: 's', planId: 'atom-001', agentId: 'a1', agent: 'planner' } as StoredEvent['event'], 'e3'),
  evt({ type: 'session:start', sessionId: 's' } as StoredEvent['event'], 'e4'),
];

describe('Timeline filterPlanId', () => {
  it('renders all events when no filter is set', () => {
    const { container } = renderInProvider(<Timeline events={EVENTS} startTime={null} showVerbose={false} />);
    expect(screen.queryByText(/Filtered to/)).toBeNull();
    // Four event cards rendered (no filter banner).
    expect(container.textContent).not.toContain('Filtered to');
  });

  it('narrows to events for the given planId and shows a clearable banner', () => {
    const onClear = vi.fn();
    renderInProvider(
      <Timeline events={EVENTS} startTime={null} showVerbose={false} filterPlanId="atom-001" onClearFilter={onClear} />,
    );
    // Banner shows the filtered planId and the count (2 events carry atom-001).
    expect(screen.getByText('atom-001')).toBeTruthy();
    expect(screen.getByText('(2)')).toBeTruthy();
    screen.getByText(/clear/).click();
    expect(onClear).toHaveBeenCalledOnce();
  });

  it('shows an empty-state when the filtered node has no events yet', () => {
    renderInProvider(
      <Timeline events={EVENTS} startTime={null} showVerbose={false} filterPlanId="atom-999" onClearFilter={vi.fn()} />,
    );
    expect(screen.getByText(/No log events for this node yet/)).toBeTruthy();
  });
});
